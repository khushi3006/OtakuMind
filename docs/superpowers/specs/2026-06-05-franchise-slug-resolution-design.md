# Franchise-aware slug resolution

**Status:** Design approved — pending spec review
**Date:** 2026-06-05
**Repo:** `OtakuMind` (Next.js web backend; the mobile app consumes this API)

## Problem

The "slug" of an anime is the `Anime.normalizedName` column. Today it is computed
**purely from the title string** by `lib/normalize.ts#normalizeAnimeName` and applied
in `app/api/anime/route.ts` (POST) and `app/api/anime/[id]/route.ts` (PUT). Seasons
are grouped into one "franchise" only when their normalized strings happen to be
byte-for-byte equal.

That makes the slug brittle. The moment a sequel's title does not reduce to exactly
the same string — a different subtitle, English vs. romaji, a pattern the regex does
not strip — the sequel becomes a *separate* franchise with its own slug. Example
reported by the user: adding "Classroom of the Elite" season 1 and season 2 produces
two different slugs, so the app treats them as unrelated shows instead of one
franchise.

We want the slug to robustly identify the **franchise**, so every season/entry of one
franchise shares a single, clean slug.

## Decisions (locked in during brainstorming)

1. **Source of truth — hybrid.** When `malId` is present, use MAL's authoritative
   relations (via the Jikan API) to group entries; fall back to DB matching, then to
   string normalization. No schema change required.
2. **Slug value — canonical root.** The slug is derived from the franchise's MAL
   *root* title, so it is identical no matter which season is added first. When a
   newly resolved franchise contains existing rows with a different slug, those rows
   are **re-slugged** to converge (re-running season-number resolution so seasons
   stay unique).
3. **Grouping width — widest.** Follow the whole related web, excluding only the
   `Character` and `Other` relation types. Accepts that reboots / alternative
   versions may merge with originals.
4. **Existing data — new adds + one-time migration.** New writes use the resolver;
   a one-time, idempotent backfill script regroups and re-slugs historical rows.
5. **Scope — Add + Edit.** Runs on `POST /api/anime` and on `PUT /api/anime/[id]`
   when `name` or `malId` changes. (Plus the migration script.)

## Chosen approach: bounded widest-BFS with cache + budget + graceful fallback

On each write we walk the related web breadth-first, **bounded** by `maxNodes`,
`maxApiCalls`, and a wall-clock budget (~2.5s). Relation results are cached
process-globally (relations are effectively static), so repeat adds within a
franchise are nearly free. The migration runs the same walk with looser bounds.

**Cardinal rule:** a write must never fail because Jikan is slow, down, or
rate-limited. If the budget is exhausted or the API errors, the resolver degrades to
the DB-fuzzy / normalization fallback and the write still succeeds.

Rejected alternatives:
- **Full unbounded BFS on every write** — best per-write correctness, but worst
  latency and rate-limit exposure.
- **Cheap slug now + background canonicalization** — lowest latency, but needs a
  job/queue this app does not have (no eventual-consistency infra today).

## Architecture

Small, single-purpose, independently testable units. I/O is isolated from pure logic
so the graph/season logic is unit-testable without a network.

### `lib/mal-relations.ts` — Jikan relations client (I/O)
- `getRelations(malId: number): Promise<RelationEntry[]>` →
  `GET https://api.jikan.moe/v4/anime/{malId}/relations`, returning entries filtered
  to `entry.type === 'anime'` (relations can point at manga — excluded). Each entry
  carries `{ relation, mal_id, name }`.
- **Cache:** process-global `Map<number, { entries, ts }>`, long TTL (relations are
  static); mirrors the pattern in `app/api/search/route.ts`.
- **Throttle:** a single-flight queue enforcing ~350ms minimum spacing between live
  calls (Jikan allows ~3 req/s, 60/min) with exponential backoff on HTTP 429.
- **Timeout:** tight per-call `AbortSignal.timeout` (~2.5s) like the search route.
- **Injectable fetcher** so `lib/franchise.ts` can be tested with a mock graph.

### `lib/franchise.ts` — pure graph logic (no I/O)
Takes a `getRelations` function as a parameter (dependency injection).
- `buildComponent(seedMalId, seedName, getRelations, bounds)` — bounded BFS across the
  related web, excluding relation types `Character` and `Other`. Returns the connected
  component as nodes `{ malId, name }` plus the directed `Prequel` / `Parent story`
  edges discovered. Honors `maxNodes`, `maxApiCalls`, and a budget; on hitting a bound
  it returns the partial component (better than nothing) and flags `truncated: true`.
- `pickCanonicalRoot(component)` — deterministic, order-independent:
  1. Root candidates = nodes with **no incoming** `Prequel`/`Parent story` edge from
     within the component (the origins).
  2. Exactly one candidate → it is the root.
  3. Multiple candidates (reboots / alternative versions) → the one with the
     **smallest `mal_id`** (oldest on MAL ≈ the original work).
  4. Zero candidates (cyclic / odd data) → the **smallest `mal_id`** in the component.
- `canonicalSlugFor(component)` = `normalizeAnimeName(root.name)`.

### `lib/season-reassign.ts` — pure season planner
- Given the set of TV rows that will live under one slug after a merge, produces
  collision-free season numbers (reusing the `resolveSeason` semantics from
  `lib/season-resolve.ts`: explicit user numbers are preserved where free; otherwise
  auto-derived numbers bump past the highest sibling).
- Emits a **two-phase apply plan** (see "Atomic re-slug" below).
- Non-TV rows (Movie/OVA/Special) are outside numbering — they only take the slug.

### `lib/franchise-resolve.ts` — orchestrator (used by both routes AND the migration)
`resolveFranchise({ userId, name, malId, db })` returns:
- `slug` — the canonical slug to store on the row being written;
- `siblingReslugs` — existing owned rows whose `normalizedName` must change to `slug`;
- `seasonPlan` — the two-phase season assignment for all affected TV rows.

Precedence (hybrid):
1. **MAL path** (malId present, relations reachable): build the component →
   `canonicalSlug` + `memberMalIds`. Find the user's owned rows with
   `malId ∈ memberMalIds`. Franchise slug = `canonicalSlug`; owned siblings with a
   different `normalizedName` go into `siblingReslugs`.
2. **DB-fuzzy fallback** (no malId, or relations unreachable/offline):
   - exact `normalizedName === normalizeAnimeName(name)` → join that franchise;
   - else a **conservative** token match: shared first token, each name ≥2 tokens, and
     one name's token set ⊆ the other's → adopt the existing (shorter/root-ish) slug;
   - else → `normalizeAnimeName(name)`.
3. **Pure normalization fallback** → `normalizeAnimeName(name)`.

> Note: the DB-fuzzy fallback cannot compute a true canonical root (no MAL data), so
> it *adopts an existing sibling's slug* rather than re-deriving from a root. This is
> the accepted degraded mode; the migration / a later online edit will canonicalize.

### Atomic re-slug + season safety (the tricky bit)

A merge can momentarily put two TV rows at the same `(userId, normalizedName, season)`
and trip the **partial unique index** (`type = 'TV'`, see
`scripts/migrate-partial-season.ts`). Inside the write transaction:

- **Phase A** — for every affected TV row, set `normalizedName = canonicalSlug` **and**
  `season = -id` (negative seasons are collision-free per row).
- **Phase B** — assign each row its computed final positive season (already
  collision-free by construction).

This guarantees no transient unique-index violation during the merge. Movies / OVAs /
Specials take the slug directly. The whole thing runs under `withDeadlockRetry` +
`WATCH_ORDER_TRANSACTION_OPTIONS`, matching the existing routes.

## Route integration

- **POST `app/api/anime/route.ts`:** replace the current
  `normalizedName = normalizeAnimeName(name)` + TV-sibling `resolveSeason` block with a
  call to `resolveFranchise(...)`, then apply `siblingReslugs` + `seasonPlan` + the new
  row's create inside the existing transaction. Preserve all current behavior:
  malId-duplicate checks (409), watch-order shifting, movie episode zeroing,
  schema-validation fallback, P2002 handling.
- **PUT `app/api/anime/[id]/route.ts`:** when `name` or `malId` changes, run
  `resolveFranchise(...)` for the edited row and apply the same merge. Keep the
  existing explicit-season collision behavior (a genuine explicit clash still returns
  409 via `resolveSeason`'s `collision` kind). Manual edits to the slug field stay
  possible (explicit `normalizedName` in the body bypasses re-derivation).

## Migration — `scripts/migrate-franchise-slugs.ts`

- Idempotent, throttled, with `--dry` (default-safe: prints the planned regroupings and
  writes nothing; an explicit flag/confirmation is required to actually write).
- Iterates users; for each, loads rows with `malId`, builds components (reusing the
  **process-global relations cache across all users** — large savings), groups by
  component, computes the canonical slug per group, and applies the two-phase re-slug +
  season reassignment per group.
- Rows **without** `malId` are left untouched and reported.
- Prints progress; re-running with a warm cache is fast and a no-op.
- Follows the conventions of `scripts/migrate-partial-season.ts` (standalone `tsx`
  script, clear logging, `process.exit` on completion/failure).

## Tests — `scripts/test-franchise-resolve.ts`

Uses the repo's existing `expect`-style harness (no test runner; mirrors
`scripts/test-season-resolve.ts`). Injects a mocked relations graph — **no network** —
covering:
- BFS bounding / truncation behavior;
- root selection: single origin; reboot/alt multi-origin → min `mal_id`; cycle → min
  `mal_id`;
- `canonicalSlugFor` output;
- the conservative DB-fuzzy matcher (positive and negative/false-merge cases);
- the two-phase season planner (e.g. merging two season-1 rows bumps one; explicit
  numbers preserved; movies untouched).

## Latency & resilience summary
- Process-global relations cache; bounded BFS (`maxNodes`/`maxApiCalls`/budget).
- Throttle (~350ms spacing) + 429 exponential backoff; tight per-call timeout.
- **Jikan failure → fallback, never a failed write.**

## Out of scope
- No schema/column change (franchise identity is computed, not stored). A persisted
  `rootMalId`/`franchiseKey` could be a future optimization but is not part of this
  work.
- Bulk import/seed scripts (`manual_seed.js`, etc.) are not rerouted through the
  resolver in this iteration; the migration covers existing data.

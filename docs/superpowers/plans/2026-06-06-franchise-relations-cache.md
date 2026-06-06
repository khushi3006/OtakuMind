# Franchise Relations Cache — Design & Plan

**Date:** 2026-06-06
**Status:** Approved (scope: persistence + coalescing only)
**Repo:** `OtakuMind` (web/backend), commits authored by khushi. No mobile changes.

## Problem

Franchise grouping on add/update walks the MAL relation graph via
`getRelations(malId)` (`lib/mal-relations.ts`) — up to 30 Jikan calls throttled at
350 ms each (`BUILD_BOUNDS = { maxNodes: 30, maxApiCalls: 30 }`), so up to ~10 s of
**blocking** work inside `POST /api/anime`. Results are cached only in a
module-level `Map` (24 h TTL) which is **per-instance and ephemeral on Vercel** —
so every cold instance re-walks the same franchises, and the "shared across users"
benefit the code assumes doesn't hold in production.

MAL relations are effectively static, and they're global per `malId` (not
user-specific). So they belong in shared, durable storage — exactly like the
airing cache ([[airing-cache-architecture]] pattern).

## Goal

Each franchise node's relations are fetched from Jikan **once, ever, globally** —
shared across all users and serverless instances. After the ecosystem warms, a
franchise walk is pure DB reads (fast); only the first-ever add of a genuinely-new
franchise pays the Jikan cost.

## Non-goals (explicitly out of scope)

- Deferring the cold-franchise walk to a background `after()` + re-merge. The slug
  and season assignment depend on the walk result synchronously, and re-running the
  intricate two-phase season-merge outside the POST transaction is materially
  riskier. Deferred to a possible future spec.
- Changing the graph-walk logic (`lib/franchise.ts`) or the merge logic
  (`lib/franchise-resolve.ts`) — both stay exactly as they are. Only the
  `getRelations` backing store changes.

## Design

### Data model — new `MalRelation` table

```prisma
model MalRelation {
  malId     Int      @id        // MAL id — global key
  relations Json                // RelationEntry[] = { relation, malId, name }[]
  syncedAt  DateTime @default(now())
}
```

No extra indexes (PK lookup only). Relations are static, so a long TTL (30 days)
governs refresh.

### `lib/mal-relations.ts` — layered, coalesced `getRelations`

`getRelations(malId)` becomes L1 (in-process map) → L2 (DB `MalRelation`) → live
Jikan, never throwing:

1. **L1**: existing in-process `relationsCache` map, 24 h TTL — fast path within a
   hot instance. (Kept as-is.)
2. **L2 (new)**: `db.malRelation.findUnique({ where: { malId } })`; if present and
   `syncedAt` within `DB_TTL` (30 d), parse `relations`, populate L1, return.
   Wrapped in try/catch — a DB hiccup falls through to live.
3. **Live (coalesced)**: throttled `fetchRelationsLive` (unchanged), then write **both**
   L1 and L2 (`db.malRelation.upsert`, write wrapped in try/catch). On failure return
   `[]` (cardinal rule preserved).
4. **Coalescing**: a module-level `inflight = new Map<number, Promise<RelationEntry[]>>()`
   ensures concurrent live fetches for the same `malId` share one Jikan call; the
   entry is deleted in a `finally`.

The existing `throttle`, `fetchRelationsLive`, `parseRelationsPayload`, and the
`GetRelations` type are unchanged. `buildComponent` / `resolveFranchise` are
untouched — they call `getRelations` exactly as before, just faster.

Prisma `Json` typing: writing `relations: entries as unknown as Prisma.InputJsonValue`
and reading `row.relations as unknown as RelationEntry[]` (with a brief comment) to
satisfy the `JsonValue` types.

## Tasks

### Task 1: `MalRelation` model + migration
- Add the model to `prisma/schema.prisma`.
- `prisma/migrations/<ts>_add_mal_relation/migration.sql` + idempotent mirror
  `scripts/migrate-add-mal-relation.ts` (relative `../lib/db` import, like the
  other scripts), `CREATE TABLE IF NOT EXISTS "MalRelation" ("malId" INTEGER PRIMARY KEY,
  "relations" JSONB NOT NULL, "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`.
- `npx prisma generate`; commit the regenerated client too.
- Apply to dev (mirror script + `migrate resolve --applied`); verify `db.malRelation`.

### Task 2: DB-back `getRelations` + coalescing
- Edit `lib/mal-relations.ts` per the design: import `db` from `@/lib/db` and the
  `Prisma` type; add `DB_TTL`, the `inflight` map, the L2 read, and the upsert
  write; refactor the live path into a coalesced helper. Keep `getRelations`'s
  signature (`GetRelations`) and never-throws contract.
- `npx tsc --noEmit` → PASS.

### Task 3: Verify + deploy
- Verification `tsx` script (or extend an existing one) that calls `getRelations`
  twice for a malId and asserts the second call hits the DB (no second Jikan call)
  + a `MalRelation` row exists.
- Apply migration to the production Neon branch (idempotent mirror + prod
  `DATABASE_URL`), verify the table.
- Push `main`; confirm Vercel deploy.

## Testing / verification

No test framework. Verify via:
- A `tsx` script that calls `getRelations(<malId>)`, confirms a `MalRelation` row is
  written, then calls it again and confirms it returns from cache (e.g. instrument
  with a log, or check timing / that a second standalone process reads it from DB).
- `npx tsc --noEmit` green.

## Rollout

Backend only. Migration applied to dev + prod Neon branches; push `main`; Vercel
auto-deploys. No client changes (the API contract is unchanged).

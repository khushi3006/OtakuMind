# Franchise-aware Slug Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an anime's slug (`Anime.normalizedName`) identify its whole *franchise* by grouping entries via MAL relations (canonical root slug) instead of brittle title-string matching, so e.g. every season of "Classroom of the Elite" shares one slug.

**Architecture:** A layered, hybrid resolver. Pure graph logic (`lib/franchise.ts`) walks the MAL related-web (fetched by `lib/mal-relations.ts`, the only networked unit) to pick a deterministic canonical root and slug. A pure season planner (`lib/season-reassign.ts`) keeps TV season numbers unique after a merge. `lib/franchise-resolve.ts` orchestrates and exposes DB merge helpers used by the POST route, the PUT route, and a one-time backfill migration. Merges run a two-phase (park-to-negative, then assign-final) update so they never trip the partial unique index. Network never blocks a write — any Jikan failure degrades to local string logic.

**Tech Stack:** Next.js 16 App Router (route handlers), Prisma 5 (Neon adapter), Jikan v4 REST API, TypeScript, `tsx` for standalone test/migration scripts (the repo has no test runner — tests are `tsx` scripts using a tiny `expect` harness, see `scripts/test-season-resolve.ts`).

---

## File Structure

**Create:**
- `lib/mal-relations.ts` — Jikan relations client: cache + throttle + timeout + payload parser. The ONLY networked unit.
- `lib/franchise.ts` — pure graph logic: bounded BFS over the related web, canonical-root selection, canonical slug. Takes `getRelations` as a parameter (no I/O).
- `lib/season-reassign.ts` — pure season planner: collision-free TV season assignment after a merge.
- `lib/franchise-resolve.ts` — orchestrator: `resolveFranchise` (pure-ish: relations + in-memory), the conservative fuzzy fallback, and the DB merge helpers (`findFranchiseRows`, `parkRows`, `applyFinalSeasons`).
- `scripts/test-franchise.ts` — standalone `tsx` test script for all pure logic above.
- `scripts/migrate-franchise-slugs.ts` — one-time, idempotent backfill (`--apply` to write; dry-run by default).

**Modify:**
- `app/api/anime/route.ts` — POST: replace the normalize + `resolveSeason` block with the franchise resolver + two-phase merge.
- `app/api/anime/[id]/route.ts` — PUT: when `name`/`malId` changes (and no explicit `normalizedName` override), run the resolver + merge.

**Conventions to follow (verified in repo):**
- `lib/` files use **relative** imports (e.g. `./normalize`, `../prisma/generated/client`) so `tsx` scripts can import them — matches `lib/db.ts`. Use `import type` for Prisma types (runtime-erased).
- Routes use `@/lib/...` aliases (matches existing route imports).
- DB writes wrap in `withDeadlockRetry(() => db.$transaction(async (tx) => {...}, WATCH_ORDER_TRANSACTION_OPTIONS))`.
- Tests: `npx tsx scripts/test-franchise.ts`.

---

## Task 1: Pure franchise graph logic (`lib/franchise.ts`)

**Files:**
- Create: `lib/franchise.ts`
- Create: `lib/mal-relations.ts` (types only in this task; full client in Task 3)
- Test: `scripts/test-franchise.ts`

- [ ] **Step 1: Add the shared relation types to `lib/mal-relations.ts`**

Create `lib/mal-relations.ts` with just the types for now (the networked client comes in Task 3, but `lib/franchise.ts` needs these types):

```typescript
/**
 * Jikan relations client for franchise grouping.
 *
 * This module is the ONLY place that talks to the network. The pure graph logic
 * in lib/franchise.ts receives a `getRelations` function so it can be tested
 * without any network access. (The networked implementation is added in Task 3.)
 */

export type RelationEntry = {
  /** MAL relation label, e.g. "Prequel", "Sequel", "Side story", "Parent story". */
  relation: string;
  /** mal_id of the related anime. */
  malId: number;
  /** Display name of the related anime (comes free from the relations payload). */
  name: string;
};

/** Returns the anime relation edges for a given malId. Never throws. */
export type GetRelations = (malId: number) => Promise<RelationEntry[]>;
```

- [ ] **Step 2: Write the failing test for the graph logic**

Create `scripts/test-franchise.ts`:

```typescript
/**
 * Standalone verification for the pure franchise logic (no network, no DB).
 * Run with:  npx tsx scripts/test-franchise.ts
 */
import { buildComponent, pickCanonicalRoot, canonicalSlugFor } from '../lib/franchise';
import type { GetRelations, RelationEntry } from '../lib/mal-relations';

let passed = 0;
let failed = 0;

function expect(label: string, ok: boolean, detail?: string) {
  if (ok) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.error(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
  }
}

/** Build a getRelations from a plain {malId: RelationEntry[]} map. */
function fakeRelations(graph: Record<number, RelationEntry[]>): GetRelations {
  return async (malId: number) => graph[malId] ?? [];
}

const BOUNDS = { maxNodes: 30, maxApiCalls: 30 };

// --- Classroom of the Elite: 100 (S1) -> 200 (S2) -> 300 (S3) ---
const coteGraph: Record<number, RelationEntry[]> = {
  100: [{ relation: 'Sequel', malId: 200, name: 'Classroom of the Elite II' }],
  200: [
    { relation: 'Prequel', malId: 100, name: 'Classroom of the Elite' },
    { relation: 'Sequel', malId: 300, name: 'Classroom of the Elite III' },
  ],
  300: [{ relation: 'Prequel', malId: 200, name: 'Classroom of the Elite II' }],
};

(async () => {
  const cote = await buildComponent(200, 'Classroom of the Elite II', fakeRelations(coteGraph), BOUNDS);
  expect('COTE component has 3 nodes', cote.nodes.length === 3, `got ${cote.nodes.length}`);
  expect(
    'COTE canonical root is the S1 (malId 100)',
    pickCanonicalRoot(cote).malId === 100,
    `got ${pickCanonicalRoot(cote).malId}`
  );
  expect(
    'COTE canonical slug is "classroom of the elite"',
    canonicalSlugFor(cote) === 'classroom of the elite',
    `got "${canonicalSlugFor(cote)}"`
  );

  // --- Reboot/alt with two origins: pick smallest malId ---
  const fmaGraph: Record<number, RelationEntry[]> = {
    10: [{ relation: 'Alternative version', malId: 20, name: 'Fullmetal Alchemist: Brotherhood' }],
    20: [{ relation: 'Alternative version', malId: 10, name: 'Fullmetal Alchemist' }],
  };
  const fma = await buildComponent(20, 'Fullmetal Alchemist: Brotherhood', fakeRelations(fmaGraph), BOUNDS);
  expect('FMA component has 2 nodes', fma.nodes.length === 2, `got ${fma.nodes.length}`);
  expect('FMA root is smallest malId (10)', pickCanonicalRoot(fma).malId === 10, `got ${pickCanonicalRoot(fma).malId}`);

  // --- Excluded relations (Character/Other) are not traversed ---
  const exclGraph: Record<number, RelationEntry[]> = {
    50: [
      { relation: 'Character', malId: 999, name: 'Some Character Anime' },
      { relation: 'Other', malId: 998, name: 'Some Other' },
      { relation: 'Sequel', malId: 60, name: 'Real Sequel' },
    ],
    60: [{ relation: 'Prequel', malId: 50, name: 'Seed' }],
  };
  const excl = await buildComponent(50, 'Seed', fakeRelations(exclGraph), BOUNDS);
  expect('excluded relations skipped: 2 nodes', excl.nodes.length === 2, `got ${excl.nodes.length}`);
  expect(
    'excluded targets absent',
    !excl.nodes.some((n) => n.malId === 999 || n.malId === 998)
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd /Users/ahmadfaraz/Codes/otakumind/OtakuMind && npx tsx scripts/test-franchise.ts`
Expected: FAIL — `Cannot find module '../lib/franchise'` (file not created yet).

- [ ] **Step 4: Implement `lib/franchise.ts`**

```typescript
/**
 * Pure franchise-graph logic. NO network and NO database access — the relation
 * fetcher is injected so this is fully unit-testable (see scripts/test-franchise.ts).
 *
 * "Widest" grouping (per design decision): we follow every relation type EXCEPT
 * `Character` and `Other`. The canonical root is chosen deterministically so the
 * franchise slug is identical regardless of which season was added first.
 */
import { normalizeAnimeName } from './normalize';
import type { GetRelations } from './mal-relations';

/** Relation types that do NOT connect a franchise. Everything else is followed. */
const EXCLUDED_RELATIONS = new Set(['character', 'other']);

/** Relation types meaning "current entry comes AFTER the target" (origin edges). */
const BACKWARD_RELATIONS = new Set(['prequel', 'parent story']);

export type FranchiseNode = { malId: number; name: string };

export type FranchiseComponent = {
  /** Every anime node in the connected franchise web. */
  nodes: FranchiseNode[];
  /** Directed origin edges: `from` has `to` as its prequel/parent. */
  backEdges: Array<{ from: number; to: number }>;
  /** True if a bound (maxNodes / maxApiCalls) cut the walk short. */
  truncated: boolean;
};

export type BuildBounds = { maxNodes: number; maxApiCalls: number };

export async function buildComponent(
  seedMalId: number,
  seedName: string,
  getRelations: GetRelations,
  bounds: BuildBounds
): Promise<FranchiseComponent> {
  const nodes = new Map<number, string>([[seedMalId, seedName]]);
  const backEdges: Array<{ from: number; to: number }> = [];
  const visited = new Set<number>();
  const frontier: number[] = [seedMalId];
  let apiCalls = 0;
  let truncated = false;

  while (frontier.length > 0) {
    const current = frontier.shift() as number;
    if (visited.has(current)) continue;
    if (apiCalls >= bounds.maxApiCalls) {
      truncated = true;
      break;
    }
    visited.add(current);

    const relations = await getRelations(current);
    apiCalls++;

    for (const rel of relations) {
      const type = rel.relation.toLowerCase();
      if (EXCLUDED_RELATIONS.has(type)) continue;

      if (!nodes.has(rel.malId)) {
        if (nodes.size >= bounds.maxNodes) {
          truncated = true;
          continue;
        }
        nodes.set(rel.malId, rel.name);
      }
      if (BACKWARD_RELATIONS.has(type)) {
        backEdges.push({ from: current, to: rel.malId });
      }
      if (!visited.has(rel.malId)) frontier.push(rel.malId);
    }
  }

  return {
    nodes: Array.from(nodes, ([malId, name]) => ({ malId, name })),
    backEdges,
    truncated,
  };
}

export function pickCanonicalRoot(component: FranchiseComponent): FranchiseNode {
  const { nodes, backEdges } = component;
  // A node with an outgoing origin edge (it HAS a prequel/parent) is not an origin.
  const hasOrigin = new Set(backEdges.map((e) => e.from));
  const origins = nodes.filter((n) => !hasOrigin.has(n.malId));
  const pool = origins.length > 0 ? origins : nodes;
  // Smallest malId = oldest on MAL ≈ the original work. Deterministic tiebreak.
  return pool.reduce((best, n) => (n.malId < best.malId ? n : best));
}

export function canonicalSlugFor(component: FranchiseComponent): string {
  return normalizeAnimeName(pickCanonicalRoot(component).name);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /Users/ahmadfaraz/Codes/otakumind/OtakuMind && npx tsx scripts/test-franchise.ts`
Expected: PASS — all graph assertions ok, `... passed, 0 failed`.

- [ ] **Step 6: Commit**

```bash
cd /Users/ahmadfaraz/Codes/otakumind/OtakuMind
git add lib/franchise.ts lib/mal-relations.ts scripts/test-franchise.ts
git commit -m "feat: pure franchise graph logic (bounded BFS + canonical root)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Pure season planner (`lib/season-reassign.ts`)

**Files:**
- Create: `lib/season-reassign.ts`
- Test: `scripts/test-franchise.ts` (extend)

- [ ] **Step 1: Add failing tests for `planSeasons`**

In `scripts/test-franchise.ts`, add this import at the top (with the other imports):

```typescript
import { planSeasons } from '../lib/season-reassign';
```

Then, inside the `(async () => { ... })()` block, just before the final `console.log(...)` summary line, add:

```typescript
  // --- planSeasons: merging two "Season 1" TV rows bumps the later id ---
  const merge = planSeasons([
    { id: 1, type: 'TV', season: 1 },
    { id: 2, type: 'TV', season: 1 },
  ]);
  expect(
    'two S1 rows -> id1=1, id2=2',
    merge.find((a) => a.id === 1)?.season === 1 && merge.find((a) => a.id === 2)?.season === 2,
    JSON.stringify(merge)
  );

  // --- explicit user season is preserved where free ---
  const expl = planSeasons([
    { id: 5, type: 'TV', season: 3, explicit: true },
    { id: 6, type: 'TV', season: 1 },
  ]);
  expect(
    'explicit S3 kept, auto S1 stays 1',
    expl.find((a) => a.id === 5)?.season === 3 && expl.find((a) => a.id === 6)?.season === 1,
    JSON.stringify(expl)
  );

  // --- movies are outside numbering: keep their season, never block a TV slot ---
  const mv = planSeasons([
    { id: 7, type: 'Movie', season: 1 },
    { id: 8, type: 'TV', season: 1 },
  ]);
  expect(
    'movie keeps S1 and TV keeps S1 independently',
    mv.find((a) => a.id === 7)?.season === 1 && mv.find((a) => a.id === 8)?.season === 1,
    JSON.stringify(mv)
  );

  // --- two explicit rows that collide: first id wins, second bumps ---
  const clash = planSeasons([
    { id: 1, type: 'TV', season: 1, explicit: true },
    { id: 2, type: 'TV', season: 1, explicit: true },
  ]);
  expect(
    'colliding explicit rows -> id1=1, id2=2',
    clash.find((a) => a.id === 1)?.season === 1 && clash.find((a) => a.id === 2)?.season === 2,
    JSON.stringify(clash)
  );
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/ahmadfaraz/Codes/otakumind/OtakuMind && npx tsx scripts/test-franchise.ts`
Expected: FAIL — `Cannot find module '../lib/season-reassign'`.

- [ ] **Step 3: Implement `lib/season-reassign.ts`**

```typescript
/**
 * Pure season planner for franchise merges.
 *
 * When several rows are pulled under one franchise slug, their TV season numbers
 * must stay unique (the partial unique index covers `type = 'TV'`; see
 * scripts/migrate-partial-season.ts). This computes a collision-free season for
 * every TV row, honouring the same policy as lib/season-resolve.ts: a row whose
 * season was set EXPLICITLY by the user keeps that number where it is free;
 * everything else is auto-packed into the lowest free slots, ordered by
 * (current season, id), so merging two "Season 1" rows bumps the later one
 * rather than failing.
 *
 * Non-TV rows (Movie/OVA/Special) are outside numbering and keep their season.
 */

export type FranchiseRow = {
  id: number;
  type: string;
  season: number;
  /** True if the user explicitly chose this season (vs. auto-derived). */
  explicit?: boolean;
};

export type SeasonAssignment = { id: number; season: number };

export function planSeasons(rows: FranchiseRow[]): SeasonAssignment[] {
  const assignments: SeasonAssignment[] = [];
  const taken = new Set<number>();

  const claim = (preferred: number): number => {
    let s = preferred < 1 ? 1 : preferred;
    while (taken.has(s)) s++;
    taken.add(s);
    return s;
  };

  const tv = rows.filter((r) => r.type === 'TV');

  // Explicit rows (by id order) claim first so their chosen number wins where free.
  for (const r of tv.filter((r) => r.explicit).sort((a, b) => a.id - b.id)) {
    assignments.push({ id: r.id, season: claim(r.season) });
  }
  // Auto rows fill remaining slots, ordered by current season then id.
  for (const r of tv
    .filter((r) => !r.explicit)
    .sort((a, b) => a.season - b.season || a.id - b.id)) {
    assignments.push({ id: r.id, season: claim(r.season) });
  }
  // Non-TV rows keep their current season.
  for (const r of rows.filter((r) => r.type !== 'TV')) {
    assignments.push({ id: r.id, season: r.season });
  }

  return assignments;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/ahmadfaraz/Codes/otakumind/OtakuMind && npx tsx scripts/test-franchise.ts`
Expected: PASS — all planSeasons assertions ok, `0 failed`.

- [ ] **Step 5: Commit**

```bash
cd /Users/ahmadfaraz/Codes/otakumind/OtakuMind
git add lib/season-reassign.ts scripts/test-franchise.ts
git commit -m "feat: pure season planner for franchise merges

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Jikan relations client (`lib/mal-relations.ts`)

**Files:**
- Modify: `lib/mal-relations.ts` (add the networked client + a pure payload parser)
- Test: `scripts/test-franchise.ts` (extend — test the pure parser only)

- [ ] **Step 1: Add a failing test for the pure payload parser**

In `scripts/test-franchise.ts`, add to the imports:

```typescript
import { parseRelationsPayload } from '../lib/mal-relations';
```

Then add inside the async block before the summary `console.log`:

```typescript
  // --- parseRelationsPayload: keep anime entries, drop manga & malformed ---
  const parsed = parseRelationsPayload({
    data: [
      { relation: 'Prequel', entry: [{ mal_id: 100, type: 'anime', name: 'S1' }] },
      { relation: 'Adaptation', entry: [{ mal_id: 7, type: 'manga', name: 'Manga' }] },
      { relation: 'Sequel', entry: [{ mal_id: 300, type: 'anime', name: 'S3' }] },
    ],
  });
  expect('parser keeps only the 2 anime entries', parsed.length === 2, JSON.stringify(parsed));
  expect(
    'parser maps fields correctly',
    parsed[0].malId === 100 && parsed[0].relation === 'Prequel' && parsed[0].name === 'S1'
  );
  expect('parser handles non-object input', parseRelationsPayload(null).length === 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/ahmadfaraz/Codes/otakumind/OtakuMind && npx tsx scripts/test-franchise.ts`
Expected: FAIL — `parseRelationsPayload` is not exported / not a function.

- [ ] **Step 3: Add the parser + networked client to `lib/mal-relations.ts`**

Replace the entire contents of `lib/mal-relations.ts` with (keeps the types from Task 1, adds the rest):

```typescript
/**
 * Jikan relations client for franchise grouping.
 *
 * The ONLY networked unit. Pure graph logic (lib/franchise.ts) receives a
 * `getRelations` function so it stays testable without a network. Relations are
 * effectively static, so results are cached process-globally with a long TTL.
 *
 * Cardinal rule: this never throws to its caller. On timeout / 429 / network
 * error it returns [] so the franchise resolver degrades to local string logic
 * and the user's write still succeeds.
 */

export type RelationEntry = {
  /** MAL relation label, e.g. "Prequel", "Sequel", "Side story", "Parent story". */
  relation: string;
  /** mal_id of the related anime. */
  malId: number;
  /** Display name of the related anime (comes free from the relations payload). */
  name: string;
};

/** Returns the anime relation edges for a given malId. Never throws. */
export type GetRelations = (malId: number) => Promise<RelationEntry[]>;

const CACHE_TTL = 1000 * 60 * 60 * 24; // 24h — relations are static
const MIN_SPACING_MS = 350; // stay under Jikan's ~3 req/s
const REQUEST_TIMEOUT_MS = 2500;
const MAX_RETRIES = 2;

type CacheEntry = { entries: RelationEntry[]; ts: number };
const relationsCache = new Map<number, CacheEntry>();

let lastCallAt = 0;
let queue: Promise<unknown> = Promise.resolve();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pure: turn a Jikan /relations JSON body into RelationEntry[] (anime only). */
export function parseRelationsPayload(json: unknown): RelationEntry[] {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const out: RelationEntry[] = [];
  for (const group of data as Array<{ relation?: unknown; entry?: unknown }>) {
    const relation = typeof group?.relation === 'string' ? group.relation : '';
    const entries = Array.isArray(group?.entry) ? group.entry : [];
    for (const e of entries as Array<{ mal_id?: unknown; type?: unknown; name?: unknown }>) {
      if (e?.type === 'anime' && typeof e?.mal_id === 'number') {
        out.push({ relation, malId: e.mal_id, name: typeof e?.name === 'string' ? e.name : '' });
      }
    }
  }
  return out;
}

/** Serialize live calls and enforce a minimum spacing between them. */
async function throttle<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    const wait = MIN_SPACING_MS - (Date.now() - lastCallAt);
    if (wait > 0) await sleep(wait);
    try {
      return await fn();
    } finally {
      lastCallAt = Date.now();
    }
  };
  const result = queue.then(run, run);
  queue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

async function fetchRelationsLive(malId: number): Promise<RelationEntry[]> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(`https://api.jikan.moe/v4/anime/${malId}/relations`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 429) {
      await sleep(500 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`Jikan relations ${malId} -> ${res.status}`);
    return parseRelationsPayload(await res.json());
  }
  throw new Error(`Jikan relations ${malId} -> rate limited after retries`);
}

/** Cached, throttled relations fetch. Returns [] on any failure (never throws). */
export const getRelations: GetRelations = async (malId: number) => {
  const cached = relationsCache.get(malId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.entries;
  try {
    const entries = await throttle(() => fetchRelationsLive(malId));
    relationsCache.set(malId, { entries, ts: Date.now() });
    return entries;
  } catch {
    // Degrade gracefully; cache only successes so a transient failure can recover.
    return [];
  }
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/ahmadfaraz/Codes/otakumind/OtakuMind && npx tsx scripts/test-franchise.ts`
Expected: PASS — parser assertions ok, `0 failed`.

- [ ] **Step 5: Commit**

```bash
cd /Users/ahmadfaraz/Codes/otakumind/OtakuMind
git add lib/mal-relations.ts scripts/test-franchise.ts
git commit -m "feat: Jikan relations client (cache, throttle, graceful fallback)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Orchestrator + fuzzy fallback + DB merge helpers (`lib/franchise-resolve.ts`)

**Files:**
- Create: `lib/franchise-resolve.ts`
- Test: `scripts/test-franchise.ts` (extend — test `resolveFranchise`, `localSlug`, `looseFranchiseMatch`; the DB helpers are integration-tested in Tasks 7–8)

- [ ] **Step 1: Add failing tests for the resolver + fuzzy matcher**

In `scripts/test-franchise.ts`, add to the imports:

```typescript
import { resolveFranchise, localSlug, looseFranchiseMatch } from '../lib/franchise-resolve';
```

Add inside the async block before the summary `console.log` (reuses `coteGraph`/`fakeRelations` defined earlier):

```typescript
  // --- resolveFranchise MAL path: groups via relations, canonical slug ---
  const r1 = await resolveFranchise({
    userId: 1,
    name: 'Classroom of the Elite II',
    malId: 200,
    existingSlugs: [],
    getRelations: fakeRelations(coteGraph),
  });
  expect('resolve MAL slug = canonical root', r1.slug === 'classroom of the elite', `got "${r1.slug}"`);
  expect(
    'resolve MAL memberMalIds = {100,200,300}',
    [100, 200, 300].every((id) => r1.memberMalIds.includes(id)) && r1.memberMalIds.length === 3,
    JSON.stringify(r1.memberMalIds)
  );

  // --- resolveFranchise no-malId path: conservative fuzzy adopts existing slug ---
  const r2 = await resolveFranchise({
    userId: 1,
    name: 'Classroom of the Elite II Extra',
    malId: null,
    existingSlugs: ['classroom of the elite'],
    getRelations: fakeRelations({}),
  });
  expect('resolve no-malId fuzzy adopts existing slug', r2.slug === 'classroom of the elite', `got "${r2.slug}"`);
  expect('resolve no-malId memberMalIds empty', r2.memberMalIds.length === 0);

  // --- looseFranchiseMatch: positive, and false-merge guards ---
  expect(
    'fuzzy: subset + shared first word matches',
    looseFranchiseMatch('classroom of the elite ii', ['classroom of the elite']) === 'classroom of the elite'
  );
  expect(
    'fuzzy: shared first word but not subset -> null (SAO vs Sword of the Stranger)',
    looseFranchiseMatch('sword art online', ['sword of the stranger']) === null
  );
  expect('fuzzy: single-token candidate -> null', looseFranchiseMatch('naruto', ['naruto shippuuden']) === null);

  // --- localSlug: exact match wins; otherwise base slug ---
  expect('localSlug exact', localSlug('naruto', ['naruto']) === 'naruto');
  expect('localSlug no match -> base', localSlug('bleach', ['naruto']) === 'bleach');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/ahmadfaraz/Codes/otakumind/OtakuMind && npx tsx scripts/test-franchise.ts`
Expected: FAIL — `Cannot find module '../lib/franchise-resolve'`.

- [ ] **Step 3: Implement `lib/franchise-resolve.ts`**

```typescript
/**
 * Franchise resolution + DB merge helpers, shared by the anime POST/PUT routes
 * and the backfill migration (scripts/migrate-franchise-slugs.ts).
 *
 * `resolveFranchise` decides the canonical slug for an anime being written:
 *   1. MAL path (malId present, relations reachable): build the related-web
 *      component and use its canonical-root slug.
 *   2. Local fallback (no malId / relations unavailable): exact slug match, else
 *      a conservative token-subset fuzzy match against the user's existing slugs,
 *      else the plain normalized title.
 *
 * The DB helpers run a two-phase merge (park TV rows to a unique negative season,
 * then assign final seasons) so a merge never trips the partial unique index.
 */
import { normalizeAnimeName } from './normalize';
import { buildComponent, canonicalSlugFor } from './franchise';
import { getRelations as defaultGetRelations, type GetRelations } from './mal-relations';
import { planSeasons, type SeasonAssignment } from './season-reassign';
import type { Prisma } from '../prisma/generated/client';

const BUILD_BOUNDS = { maxNodes: 30, maxApiCalls: 30 };

export type ResolveArgs = {
  userId: number;
  name: string;
  malId?: number | null;
  /** Distinct normalizedNames the user already owns (for the no-malId fallback). */
  existingSlugs: string[];
  /** Injectable for tests; defaults to the live Jikan client. */
  getRelations?: GetRelations;
};

export type ResolveResult = {
  slug: string;
  /** MAL ids of every entry in the franchise web (empty in the local fallback). */
  memberMalIds: number[];
  truncated: boolean;
};

export async function resolveFranchise(args: ResolveArgs): Promise<ResolveResult> {
  const { name, malId, existingSlugs } = args;
  const getRelations = args.getRelations ?? defaultGetRelations;
  const baseSlug = normalizeAnimeName(name);

  if (malId) {
    const component = await buildComponent(malId, name, getRelations, BUILD_BOUNDS);
    if (component.nodes.length > 1) {
      return {
        slug: canonicalSlugFor(component),
        memberMalIds: component.nodes.map((n) => n.malId),
        truncated: component.truncated,
      };
    }
    // Standalone or relations unavailable: fall back to local logic but we still
    // know our own malId is the only confirmed member.
    return { slug: localSlug(baseSlug, existingSlugs), memberMalIds: [malId], truncated: component.truncated };
  }

  return { slug: localSlug(baseSlug, existingSlugs), memberMalIds: [], truncated: false };
}

/** Exact match, else conservative fuzzy match, else the base slug. */
export function localSlug(baseSlug: string, existingSlugs: string[]): string {
  if (existingSlugs.includes(baseSlug)) return baseSlug;
  return looseFranchiseMatch(baseSlug, existingSlugs) ?? baseSlug;
}

/**
 * Conservative franchise match for the no-malId fallback. Returns an EXISTING
 * slug to adopt, or null. Requires a shared first word, both names ≥2 tokens, and
 * one name's token set ⊆ the other's — so "Sword Art Online" never merges into
 * "Sword of the Stranger". Picks the shortest matching existing slug.
 */
export function looseFranchiseMatch(candidate: string, existingSlugs: string[]): string | null {
  const cTokens = candidate.split(' ').filter(Boolean);
  if (cTokens.length < 2) return null;
  const cSet = new Set(cTokens);
  let best: string | null = null;
  for (const slug of existingSlugs) {
    const sTokens = slug.split(' ').filter(Boolean);
    if (sTokens.length < 2) continue;
    if (cTokens[0] !== sTokens[0]) continue;
    const sSet = new Set(sTokens);
    const subset = sTokens.every((t) => cSet.has(t)) || cTokens.every((t) => sSet.has(t));
    if (subset && (best === null || slug.length < best.length)) best = slug;
  }
  return best;
}

// --- DB merge helpers (two-phase, used inside a transaction) ---

type TxClient = Prisma.TransactionClient;

export type FranchiseDbRow = {
  id: number;
  type: string;
  season: number;
  normalizedName: string;
};

/** Existing rows that belong under `slug`: same slug OR malId in the franchise. */
export async function findFranchiseRows(
  tx: TxClient,
  userId: number,
  slug: string,
  memberMalIds: number[]
): Promise<FranchiseDbRow[]> {
  return tx.anime.findMany({
    where: {
      userId,
      OR: [
        { normalizedName: slug },
        ...(memberMalIds.length ? [{ malId: { in: memberMalIds } }] : []),
      ],
    },
    select: { id: true, type: true, season: true, normalizedName: true },
  });
}

/** Phase A: move every row under `slug`; park TV rows at a unique negative season. */
export async function parkRows(
  tx: TxClient,
  slug: string,
  rows: Array<{ id: number; type: string }>
): Promise<void> {
  for (const r of rows) {
    await tx.anime.update({
      where: { id: r.id },
      data: r.type === 'TV' ? { normalizedName: slug, season: -r.id } : { normalizedName: slug },
    });
  }
}

/** Phase B: assign final positive seasons (TV rows only; non-TV untouched). */
export async function applyFinalSeasons(
  tx: TxClient,
  assignments: SeasonAssignment[],
  tvIds: Set<number>
): Promise<void> {
  for (const a of assignments) {
    if (tvIds.has(a.id)) {
      await tx.anime.update({ where: { id: a.id }, data: { season: a.season } });
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/ahmadfaraz/Codes/otakumind/OtakuMind && npx tsx scripts/test-franchise.ts`
Expected: PASS — resolver + fuzzy assertions ok, `0 failed`.

- [ ] **Step 5: Verify the types compile (no lint errors in the new lib)**

Run: `cd /Users/ahmadfaraz/Codes/otakumind/OtakuMind && npx tsc --noEmit -p tsconfig.json`
Expected: no errors referencing `lib/franchise-resolve.ts`, `lib/franchise.ts`, `lib/season-reassign.ts`, `lib/mal-relations.ts`. (Pre-existing errors elsewhere, if any, are out of scope — confirm none are in the new files.)

- [ ] **Step 6: Commit**

```bash
cd /Users/ahmadfaraz/Codes/otakumind/OtakuMind
git add lib/franchise-resolve.ts scripts/test-franchise.ts
git commit -m "feat: franchise resolver, conservative fuzzy fallback, two-phase merge helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Integrate the resolver into POST `app/api/anime/route.ts`

**Files:**
- Modify: `app/api/anime/route.ts` (imports; replace the slug/season block and the create transaction)

- [ ] **Step 1: Update imports**

In `app/api/anime/route.ts`, replace this line:

```typescript
import { normalizeAnimeName, extractSeasonNumber } from '@/lib/normalize';
import { resolveSeason } from '@/lib/season-resolve';
```

with:

```typescript
import { extractSeasonNumber } from '@/lib/normalize';
import { resolveFranchise, findFranchiseRows, parkRows, applyFinalSeasons } from '@/lib/franchise-resolve';
import { planSeasons } from '@/lib/season-reassign';
```

(`resolveSeason` and `normalizeAnimeName` are no longer used directly in POST.)

- [ ] **Step 2: Replace the slug + season-resolution block**

In the POST handler, replace this block (currently around lines 152–208 — from `const normalizedName = normalizeAnimeName(name);` through the end of the `if (finalType === 'TV') { ... }` block):

```typescript
    const normalizedName = normalizeAnimeName(name);
    let season = extractSeasonNumber(name);

    // Determine the type up front: season numbering only applies to TV rows.
    let finalType = type || "TV";
    if (!type) {
      const isMovie = name.match(/\b(movie|film)\b/i) || (!name.match(/season/i) && !name.match(/episode/i) && !name.match(/s\d+/i) && !name.match(/part/i) && name.length > 0);
      if (isMovie) finalType = "Movie";
    }

    // 1. Check for exact duplicate by malId in ANY status for this user
    if (malId) {
      // ... (KEEP THIS WHOLE malId duplicate block unchanged) ...
    }

    // 2. Resolve the season number against same-franchise TV siblings.
    // ... (the whole comment block) ...
    if (finalType === 'TV') {
      const tvSiblings = await db.anime.findMany({
        where: { userId, normalizedName, type: 'TV' },
        select: { season: true },
      });
      const resolution = resolveSeason({
        type: 'TV',
        season,
        explicit: false, // POST always auto-derives the season from the title
        tvSiblingSeasons: tvSiblings.map((s) => s.season),
      });
      season = resolution.season;
    }
```

with (KEEP the `malId` duplicate-check block exactly as it is — only the normalize/season parts change; the franchise resolution and member lookup move here, BEFORE the transaction, because it may do network I/O):

```typescript
    const desiredSeason = extractSeasonNumber(name);

    // Determine the type up front: season numbering only applies to TV rows.
    let finalType = type || "TV";
    if (!type) {
      const isMovie = name.match(/\b(movie|film)\b/i) || (!name.match(/season/i) && !name.match(/episode/i) && !name.match(/s\d+/i) && !name.match(/part/i) && name.length > 0);
      if (isMovie) finalType = "Movie";
    }

    // 1. Check for exact duplicate by malId in ANY status for this user
    if (malId) {
      const duplicateByMalId = await db.anime.findFirst({
        where: {
          userId,
          malId: Number(malId)
        }
      });

      if (duplicateByMalId) {
        if (duplicateByMalId.status === 'incomplete') {
          return NextResponse.json(
            { error: "This anime is already in your watching list", type: "DUPLICATE_INCOMPLETE" },
            { status: 409 }
          );
        } else {
          return NextResponse.json(
            {
              error: `This anime is in your ${duplicateByMalId.status} list`,
              type: "DUPLICATE_OTHER_STATUS",
              existingAnime: duplicateByMalId
            },
            { status: 409 }
          );
        }
      }
    }

    // 2. Resolve the canonical franchise slug. This may hit Jikan, so it runs
    //    BEFORE the DB transaction (never hold a DB tx open across the network).
    //    Any Jikan failure degrades to local string logic inside resolveFranchise.
    const existingSlugRows = await db.anime.findMany({
      where: { userId },
      select: { normalizedName: true },
      distinct: ['normalizedName'],
    });
    const { slug } = await resolveFranchise({
      userId,
      name,
      malId: malId ? Number(malId) : null,
      existingSlugs: existingSlugRows.map((r) => r.normalizedName),
    });
    const { memberMalIds } = await resolveFranchise({
      userId,
      name,
      malId: malId ? Number(malId) : null,
      existingSlugs: existingSlugRows.map((r) => r.normalizedName),
    });
```

> NOTE: do not call `resolveFranchise` twice. Replace the two calls above with a single call:
>
> ```typescript
>     const { slug, memberMalIds } = await resolveFranchise({
>       userId,
>       name,
>       malId: malId ? Number(malId) : null,
>       existingSlugs: existingSlugRows.map((r) => r.normalizedName),
>     });
> ```

- [ ] **Step 3: Update `createData` to stop setting `normalizedName`/`season` there**

In the same handler, find the `createData` object (currently around lines 211–231) and remove its `normalizedName` and `season` properties (they are set explicitly in the create call now). Change:

```typescript
      const createData = {
        name,
        normalizedName,
        season,
        totalEpisodes: finalType === 'Movie' ? 0 : (totalEpisodes || 0),
```

to:

```typescript
      const createData = {
        name,
        totalEpisodes: finalType === 'Movie' ? 0 : (totalEpisodes || 0),
```

(Leave every other property of `createData` unchanged.)

- [ ] **Step 4: Replace the transaction body to do the two-phase merge**

Replace the transaction (currently `const newAnime = await withDeadlockRetry(() => db.$transaction(async (tx) => { ... }, WATCH_ORDER_TRANSACTION_OPTIONS));`) with:

```typescript
      const newAnime = await withDeadlockRetry(() =>
        db.$transaction(async (tx) => {
          if (targetStatus === 'incomplete') {
            await tx.anime.updateMany({
              where: { userId, status: 'incomplete' },
              data: { watchOrder: { increment: 1 } },
            });
          }

          // Phase A: pull existing franchise siblings under the canonical slug and
          // park their TV seasons at unique negatives so the new row can't collide.
          const siblings = await findFranchiseRows(tx, userId, slug, memberMalIds);
          await parkRows(tx, slug, siblings);

          // Create the new row under the canonical slug (positive desired season).
          let createdAnime;
          try {
            createdAnime = await tx.anime.create({
              data: { ...createData, normalizedName: slug, season: desiredSeason },
            });
          } catch (error) {
            if (!isSchemaValidationError(error)) throw error;
            createdAnime = await tx.anime.create({
              data: {
                ...createData,
                normalizedName: slug,
                season: desiredSeason,
                droppedAt: undefined,
                completedAt: undefined,
              },
            });
          }

          // Phase B: assign collision-free final seasons across the whole franchise.
          const rows = [
            ...siblings.map((s) => ({ id: s.id, type: s.type, season: s.season })),
            { id: createdAnime.id, type: finalType, season: desiredSeason },
          ];
          const tvIds = new Set(rows.filter((r) => r.type === 'TV').map((r) => r.id));
          const plan = planSeasons(rows);
          await applyFinalSeasons(tx, plan, tvIds);

          const finalSeason = plan.find((p) => p.id === createdAnime.id)?.season ?? desiredSeason;
          return { ...createdAnime, normalizedName: slug, season: finalSeason };
        }, WATCH_ORDER_TRANSACTION_OPTIONS)
      );
```

- [ ] **Step 5: Typecheck**

Run: `cd /Users/ahmadfaraz/Codes/otakumind/OtakuMind && npx tsc --noEmit -p tsconfig.json`
Expected: no errors in `app/api/anime/route.ts`.

- [ ] **Step 6: Commit**

```bash
cd /Users/ahmadfaraz/Codes/otakumind/OtakuMind
git add app/api/anime/route.ts
git commit -m "feat: POST /api/anime resolves canonical franchise slug + two-phase merge

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Integrate the resolver into PUT `app/api/anime/[id]/route.ts`

**Files:**
- Modify: `app/api/anime/[id]/route.ts` (imports; select `name`+`malId`; resolve+merge on name/malId change)

- [ ] **Step 1: Update imports**

Replace:

```typescript
import { normalizeAnimeName, extractSeasonNumber } from '@/lib/normalize';
import { resolveSeason } from '@/lib/season-resolve';
```

with:

```typescript
import { extractSeasonNumber } from '@/lib/normalize';
import { resolveFranchise, findFranchiseRows, parkRows, applyFinalSeasons } from '@/lib/franchise-resolve';
import { planSeasons } from '@/lib/season-reassign';
```

- [ ] **Step 2: Accept `malId` in the body and load `name`/`malId` of the current row**

Change the body destructure:

```typescript
    const { name, totalEpisodes, episodesWatched, status, watchOrder, season, normalizedName, type } = body;
```

to:

```typescript
    const { name, totalEpisodes, episodesWatched, status, watchOrder, season, normalizedName, type, malId } = body;
```

And extend the `currentAnime` select to include `name` and `malId`:

```typescript
    const currentAnime = await db.anime.findFirst({
      where: { id: animeId, userId },
      select: { status: true, watchOrder: true, type: true, episodesWatched: true, totalEpisodes: true, normalizedName: true, season: true, name: true, malId: true },
    });
```

- [ ] **Step 3: Replace the slug/season-resolution block with franchise resolution**

Replace this block (currently lines 80–131 — from `const seasonWasExplicit = season !== undefined;` through the end of the TV `if (...) { ... updatedSeason = resolution.season; }` block):

```typescript
    const seasonWasExplicit = season !== undefined;
    let updatedNormalizedName = normalizedName !== undefined ? normalizedName : undefined;
    let updatedSeason = season !== undefined ? season : undefined;
    if (name !== undefined) {
      if (updatedNormalizedName === undefined) {
        updatedNormalizedName = normalizeAnimeName(name);
      }
      if (updatedSeason === undefined) {
        updatedSeason = extractSeasonNumber(name);
      }
    }

    // Resolve (normalizedName, season) collisions, scoped to TV rows only.
    // ... (whole comment) ...
    if (
      targetType === 'TV' &&
      (updatedNormalizedName !== undefined || updatedSeason !== undefined || type !== undefined)
    ) {
      const effectiveNormalizedName = updatedNormalizedName ?? currentAnime.normalizedName;
      const effectiveSeason = updatedSeason ?? currentAnime.season;

      const tvSiblings = await db.anime.findMany({
        where: {
          userId,
          normalizedName: effectiveNormalizedName,
          type: 'TV',
          id: { not: animeId },
        },
        select: { season: true },
      });

      const resolution = resolveSeason({
        type: 'TV',
        season: effectiveSeason,
        explicit: seasonWasExplicit,
        tvSiblingSeasons: tvSiblings.map((s) => s.season),
      });

      if (resolution.kind === 'collision') {
        return NextResponse.json(
          { error: `Season ${resolution.season} already exists for this franchise.` },
          { status: 409 }
        );
      }

      updatedSeason = resolution.season;
    }
```

with:

```typescript
    const seasonWasExplicit = season !== undefined;
    const userGaveSlug = normalizedName !== undefined;
    const nameOrMalChanged = name !== undefined || malId !== undefined;

    // Decide the franchise slug + member set for this edit.
    //   - explicit slug edit: honour it verbatim (no relation lookup).
    //   - name/malId change: run the resolver (may hit Jikan, so do it here,
    //     before the transaction).
    //   - otherwise: keep the row's current slug.
    let targetSlug = currentAnime.normalizedName;
    let memberMalIds: number[] = [];
    if (userGaveSlug) {
      targetSlug = normalizedName;
    } else if (nameOrMalChanged) {
      const effectiveName = name !== undefined ? name : currentAnime.name;
      const effectiveMalId =
        malId !== undefined ? (malId ? Number(malId) : null) : currentAnime.malId;
      const existingSlugRows = await db.anime.findMany({
        where: { userId },
        select: { normalizedName: true },
        distinct: ['normalizedName'],
      });
      const resolved = await resolveFranchise({
        userId,
        name: effectiveName,
        malId: effectiveMalId,
        existingSlugs: existingSlugRows.map((r) => r.normalizedName),
      });
      targetSlug = resolved.slug;
      memberMalIds = resolved.memberMalIds;
    }

    // The new row's intended season (explicit wins, else derived from a new name,
    // else unchanged).
    const intendedSeason =
      season !== undefined
        ? season
        : name !== undefined
          ? extractSeasonNumber(name)
          : currentAnime.season;

    const slugChanged = targetSlug !== currentAnime.normalizedName;
    const willMerge = userGaveSlug || nameOrMalChanged;

    // Preserve the existing behaviour: an EXPLICIT user season that clashes with a
    // genuine TV sibling is reported, not silently renumbered.
    if (targetType === 'TV' && seasonWasExplicit && willMerge) {
      const clash = await db.anime.findFirst({
        where: {
          userId,
          normalizedName: targetSlug,
          type: 'TV',
          season: intendedSeason,
          id: { not: animeId },
        },
        select: { id: true },
      });
      if (clash) {
        return NextResponse.json(
          { error: `Season ${intendedSeason} already exists for this franchise.` },
          { status: 409 }
        );
      }
    }
```

- [ ] **Step 4: Update `updateData` to drop slug/season (handled by the merge) and keep other fields**

Replace the `updateData` object (currently lines 133–144):

```typescript
    const updateData = {
      name: name !== undefined ? name : undefined,
      normalizedName: updatedNormalizedName,
      season: updatedSeason,
      type: type !== undefined ? type : undefined,
      totalEpisodes: targetType === 'Movie' ? 0 : (totalEpisodes !== undefined ? totalEpisodes : undefined),
      episodesWatched: targetType === 'Movie' ? 0 : (episodesWatched !== undefined ? episodesWatched : undefined),
      status: status !== undefined ? status : undefined,
      watchOrder: resolvedWatchOrder !== undefined ? resolvedWatchOrder : undefined,
      droppedAt: nextDroppedAt,
      completedAt: nextCompletedAt,
    };
```

with (no `normalizedName`/`season` — the merge sets those):

```typescript
    const updateData = {
      name: name !== undefined ? name : undefined,
      type: type !== undefined ? type : undefined,
      malId: malId !== undefined ? (malId ? Number(malId) : null) : undefined,
      totalEpisodes: targetType === 'Movie' ? 0 : (totalEpisodes !== undefined ? totalEpisodes : undefined),
      episodesWatched: targetType === 'Movie' ? 0 : (episodesWatched !== undefined ? episodesWatched : undefined),
      status: status !== undefined ? status : undefined,
      watchOrder: resolvedWatchOrder !== undefined ? resolvedWatchOrder : undefined,
      droppedAt: nextDroppedAt,
      completedAt: nextCompletedAt,
    };
```

- [ ] **Step 5: Replace the transaction body to apply the field update + two-phase merge**

Replace the transaction body (the `db.$transaction(async (tx) => { ... })` block, currently lines 146–207). Keep the existing watch-order shift logic exactly; add the merge after the row update:

```typescript
    const updatedAnime = await withDeadlockRetry(() =>
      db.$transaction(async (tx) => {
        if (isStatusChanging) {
          if (currentAnime.status === 'incomplete' && currentAnime.watchOrder !== null) {
            await tx.anime.updateMany({
              where: { userId, status: 'incomplete', watchOrder: { gt: currentAnime.watchOrder } },
              data: { watchOrder: { decrement: 1 } },
            });
          }
          if (status === 'incomplete') {
            await tx.anime.updateMany({
              where: { userId, status: 'incomplete' },
              data: { watchOrder: { increment: 1 } },
            });
          }
        }

        // Apply the non-slug/non-season field updates first.
        let nextAnime;
        try {
          nextAnime = await tx.anime.update({ where: { id: animeId }, data: updateData });
        } catch (error) {
          if (!isSchemaValidationError(error)) throw error;
          nextAnime = await tx.anime.update({
            where: { id: animeId },
            data: { ...updateData, droppedAt: undefined, completedAt: undefined },
          });
        }

        if (willMerge) {
          // Two-phase merge: gather the franchise (always include this row), park
          // TV rows to negatives, then assign collision-free final seasons.
          const siblings = await findFranchiseRows(tx, userId, targetSlug, memberMalIds);
          const byId = new Map(siblings.map((s) => [s.id, s]));
          if (!byId.has(animeId)) {
            byId.set(animeId, {
              id: animeId,
              type: targetType,
              season: currentAnime.season,
              normalizedName: currentAnime.normalizedName,
            });
          }
          const rows = [...byId.values()];

          await parkRows(tx, targetSlug, rows.map((r) => ({ id: r.id, type: r.type })));

          const planRows = rows.map((r) =>
            r.id === animeId
              ? { id: r.id, type: targetType, season: intendedSeason, explicit: seasonWasExplicit }
              : { id: r.id, type: r.type, season: r.season }
          );
          const tvIds = new Set(planRows.filter((r) => r.type === 'TV').map((r) => r.id));
          const plan = planSeasons(planRows);
          await applyFinalSeasons(tx, plan, tvIds);

          const finalSeason = plan.find((p) => p.id === animeId)?.season ?? intendedSeason;
          return { ...nextAnime, normalizedName: targetSlug, season: targetType === 'TV' ? finalSeason : nextAnime.season };
        }

        return nextAnime;
      }, WATCH_ORDER_TRANSACTION_OPTIONS)
    );
```

> NOTE: `slugChanged` is computed in Step 3 for readability/logging but the merge is gated on `willMerge`; if your linter flags `slugChanged` as unused, delete its declaration.

- [ ] **Step 6: Typecheck**

Run: `cd /Users/ahmadfaraz/Codes/otakumind/OtakuMind && npx tsc --noEmit -p tsconfig.json`
Expected: no errors in `app/api/anime/[id]/route.ts`.

- [ ] **Step 7: Commit**

```bash
cd /Users/ahmadfaraz/Codes/otakumind/OtakuMind
git add "app/api/anime/[id]/route.ts"
git commit -m "feat: PUT /api/anime/[id] re-homes edits into the canonical franchise

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: One-time backfill migration (`scripts/migrate-franchise-slugs.ts`)

**Files:**
- Create: `scripts/migrate-franchise-slugs.ts`

- [ ] **Step 1: Implement the migration (dry-run by default; `--apply` to write)**

```typescript
/**
 * One-time backfill: regroup existing anime into MAL franchises and re-slug them
 * to the canonical root slug, re-running season resolution so TV seasons stay
 * unique. Idempotent: a warm second run (relations cache primed) is a no-op.
 *
 * Reuses the process-global relations cache in lib/mal-relations across all users,
 * so a franchise's relations are fetched at most once for the whole run.
 *
 * Dry run (default — prints the plan, writes nothing):
 *   npx tsx scripts/migrate-franchise-slugs.ts
 * Apply for real:
 *   npx tsx scripts/migrate-franchise-slugs.ts --apply
 */
import { db } from '../lib/db';
import { getRelations } from '../lib/mal-relations';
import { buildComponent, canonicalSlugFor } from '../lib/franchise';
import { planSeasons } from '../lib/season-reassign';

const APPLY = process.argv.includes('--apply');
const BOUNDS = { maxNodes: 60, maxApiCalls: 60 };

type Row = { id: number; name: string; normalizedName: string; malId: number | null; type: string; season: number };

async function main() {
  const users = await db.user.findMany({ select: { id: true, username: true } });
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${users.length} user(s)\n`);

  let groupsChanged = 0;

  for (const user of users) {
    const animes: Row[] = await db.anime.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, normalizedName: true, malId: true, type: true, season: true },
    });

    // 1. Compute a canonical slug for every row that has a malId, grouping members.
    const slugByAnimeId = new Map<number, string>();
    const components: Array<{ slug: string; members: Set<number> }> = [];

    for (const a of animes) {
      if (!a.malId) continue;
      let resolved = components.find((c) => c.members.has(a.malId as number));
      if (!resolved) {
        const component = await buildComponent(a.malId, a.name, getRelations, BOUNDS);
        resolved = { slug: canonicalSlugFor(component), members: new Set(component.nodes.map((n) => n.malId)) };
        components.push(resolved);
      }
      slugByAnimeId.set(a.id, resolved.slug);
    }

    // 2. Group rows by target slug (malId rows by computed slug; others keep theirs).
    const groups = new Map<string, Row[]>();
    for (const a of animes) {
      const slug = slugByAnimeId.get(a.id) ?? a.normalizedName;
      (groups.get(slug) ?? groups.set(slug, []).get(slug)!).push(a);
    }

    // 3. Per group, plan seasons; apply only if a slug or TV season would change.
    for (const [slug, rows] of groups) {
      const plan = planSeasons(rows.map((r) => ({ id: r.id, type: r.type, season: r.season })));
      const seasonById = new Map(plan.map((p) => [p.id, p.season]));
      const changed = rows.filter(
        (r) => r.normalizedName !== slug || (r.type === 'TV' && seasonById.get(r.id) !== r.season)
      );
      if (changed.length === 0) continue;
      groupsChanged++;

      console.log(`@${user.username}  slug="${slug}"  (${rows.length} entries, ${changed.length} change)`);
      for (const r of changed) {
        const toSeason = r.type === 'TV' ? seasonById.get(r.id) : r.season;
        console.log(`   #${r.id} "${r.name}"  ${r.normalizedName}/S${r.season} -> ${slug}/S${toSeason}`);
      }

      if (APPLY) {
        await db.$transaction(async (tx) => {
          // Phase A: park.
          for (const r of rows) {
            await tx.anime.update({
              where: { id: r.id },
              data: r.type === 'TV' ? { normalizedName: slug, season: -r.id } : { normalizedName: slug },
            });
          }
          // Phase B: finals (TV only).
          for (const r of rows) {
            if (r.type === 'TV') {
              await tx.anime.update({ where: { id: r.id }, data: { season: seasonById.get(r.id) as number } });
            }
          }
        });
      }
    }
  }

  console.log(`\n${APPLY ? 'Applied changes to' : 'Would change'} ${groupsChanged} group(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nMigration failed:', err);
    process.exit(1);
  });
```

- [ ] **Step 2: Run the dry run and read the plan**

Run: `cd /Users/ahmadfaraz/Codes/otakumind/OtakuMind && npx tsx scripts/migrate-franchise-slugs.ts`
Expected: prints `DRY RUN — N user(s)`, then per-group lines for any franchise whose entries would be re-slugged/re-seasoned, ending with `Would change X group(s).` No DB writes.

**STOP and review** the dry-run output before applying. Spot-check a few franchises (e.g. multi-season shows you know) to confirm groupings look right. If a grouping looks wrong, that's signal to revisit bounds or excluded relation types — do not `--apply` yet.

- [ ] **Step 3: Apply, then verify idempotency**

Only after the dry run looks correct:

Run: `cd /Users/ahmadfaraz/Codes/otakumind/OtakuMind && npx tsx scripts/migrate-franchise-slugs.ts --apply`
Expected: prints `APPLYING ...` and `Applied changes to X group(s).`

Then run the dry run again to confirm it is now a no-op:

Run: `cd /Users/ahmadfaraz/Codes/otakumind/OtakuMind && npx tsx scripts/migrate-franchise-slugs.ts`
Expected: `Would change 0 group(s).`

- [ ] **Step 4: Commit**

```bash
cd /Users/ahmadfaraz/Codes/otakumind/OtakuMind
git add scripts/migrate-franchise-slugs.ts
git commit -m "feat: one-time franchise-slug backfill migration (dry-run by default)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full pure-logic test suite**

Run: `cd /Users/ahmadfaraz/Codes/otakumind/OtakuMind && npx tsx scripts/test-franchise.ts`
Expected: `... passed, 0 failed`.

- [ ] **Step 2: Start the dev server**

Run: `cd /Users/ahmadfaraz/Codes/otakumind/OtakuMind && npm run dev`
Expected: Next.js dev server up (note the local URL).

- [ ] **Step 3: Verify the reported bug is fixed (add out-of-order)**

Using the web UI (search + add) or `curl` against `POST /api/anime` with a valid session cookie:
1. Add **"Classroom of the Elite II"** (the season-2 entry, with its real `malId`).
2. Add **"Classroom of the Elite"** (season 1, real `malId`).

Then `GET /api/anime` and confirm:
- Both rows share the SAME `normalizedName` (the canonical root slug, e.g. `classroom of the elite` or its romaji equivalent — whatever the MAL root title normalizes to).
- They have DISTINCT TV seasons (1 and 2), regardless of add order.

Expected: one franchise, one slug, two seasons. (Before this change they would have had two different slugs.)

- [ ] **Step 4: Verify graceful degradation (no malId)**

Add an anime manually with NO `malId` whose normalized title exactly matches an existing slug; confirm it joins that franchise (same `normalizedName`, next free season). Add one with an unrelated title; confirm it gets its own normalized slug. Expected: no crash, sensible slugs — proving the local fallback path works when MAL data is absent.

- [ ] **Step 5: Verify edit re-homing (PUT)**

Edit an existing standalone anime's name to a sequel title that belongs to a franchise you own (or set its `malId`); save. `GET /api/anime` and confirm it moved under the canonical slug with a non-colliding season. Expected: the edited row joins the franchise.

- [ ] **Step 6: Final commit (if any verification tweaks were needed)**

If steps 3–5 surfaced a fix, make it, re-run `npx tsx scripts/test-franchise.ts`, and commit. Otherwise nothing to do.

---

## Self-Review

**1. Spec coverage** (checked against `docs/superpowers/specs/2026-06-05-franchise-slug-resolution-design.md`):
- Hybrid source of truth → Task 4 `resolveFranchise` precedence (MAL → fuzzy → normalize). ✓
- Canonical root slug + re-slug siblings → Task 1 `pickCanonicalRoot`/`canonicalSlugFor`; merge in Tasks 5/6/7. ✓
- Widest grouping (exclude Character/Other) → Task 1 `EXCLUDED_RELATIONS`. ✓
- New adds + migration → Tasks 5/6 (live) + Task 7 (backfill). ✓
- Scope Add+Edit → Task 5 (POST) + Task 6 (PUT). ✓
- `lib/mal-relations` client (cache/throttle/timeout/graceful) → Task 3. ✓
- Two-phase atomic re-slug (negative parking) → Task 4 helpers, applied in 5/6/7. ✓
- `--dry` default migration → Task 7. ✓
- Tests via repo's `expect` harness, no network → Task 1–4 build `scripts/test-franchise.ts`. ✓
- Latency/resilience: never block a write → Task 3 returns `[]` on failure; resolution runs before the tx in Tasks 5/6. ✓
- Out of scope: no schema change (confirmed — no Prisma edits in any task); import scripts not rerouted (confirmed). ✓

**2. Placeholder scan:** No TBD/TODO; every code step has complete code. The one prose "NOTE" in Task 5 explicitly corrects a deliberate two-call illustration into a single call — engineer must apply the single-call form.

**3. Type consistency:** `RelationEntry`/`GetRelations` (Task 1, finalized Task 3) used by `franchise.ts` and `franchise-resolve.ts`. `FranchiseComponent`/`buildComponent`/`pickCanonicalRoot`/`canonicalSlugFor` (Task 1) consumed by Task 4 + Task 7. `SeasonAssignment`/`planSeasons` (Task 2) consumed by Tasks 4–7. `findFranchiseRows`/`parkRows`/`applyFinalSeasons` (Task 4) consumed by Tasks 5/6 (and the migration inlines the equivalent two-phase for simplicity). `resolveFranchise` signature `{ userId, name, malId, existingSlugs, getRelations? } -> { slug, memberMalIds, truncated }` is identical at every call site. ✓

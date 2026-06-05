/**
 * Standalone verification for lib/season-resolve.ts (the repo has no test runner).
 * Run with:  npx tsx scripts/test-season-resolve.ts
 *
 * Encodes the behaviour the season fix must guarantee, including the cases that
 * were broken before (manual edits getting silently renumbered; movies eating
 * TV season slots).
 */
import { resolveSeason, type SeasonResolution } from '../lib/season-resolve';

let passed = 0;
let failed = 0;

function expect(label: string, actual: SeasonResolution, expected: SeasonResolution) {
  const ok =
    actual.kind === expected.kind && actual.season === expected.season;
  if (ok) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.error(
      `  FAIL ${label}\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`
    );
  }
}

// 1. A movie passes through even if its number clashes with a TV sibling —
//    movies no longer consume / are blocked by TV season slots.
expect(
  'Movie passes through despite clash',
  resolveSeason({ type: 'Movie', season: 1, explicit: false, tvSiblingSeasons: [1, 2] }),
  { kind: 'ok', season: 1 }
);

// 2. OVA/Special are likewise outside numbering.
expect(
  'OVA passes through',
  resolveSeason({ type: 'OVA', season: 3, explicit: true, tvSiblingSeasons: [3] }),
  { kind: 'ok', season: 3 }
);

// 3. TV with a free season is unchanged.
expect(
  'TV free season',
  resolveSeason({ type: 'TV', season: 3, explicit: false, tvSiblingSeasons: [1, 2] }),
  { kind: 'ok', season: 3 }
);

// 4. THE FIX: explicit user edit to a free slot sticks (Alicization -> Season 3
//    with only TV siblings 1 & 2; the movies that used to occupy 3/4 are excluded).
expect(
  'Explicit edit to free TV slot sticks (SAO Alicization=3)',
  resolveSeason({ type: 'TV', season: 3, explicit: true, tvSiblingSeasons: [1, 2] }),
  { kind: 'ok', season: 3 }
);

// 5. Explicit edit onto a real TV clash is reported (NOT silently bumped to 7).
expect(
  'Explicit edit onto real TV clash -> collision',
  resolveSeason({ type: 'TV', season: 2, explicit: true, tvSiblingSeasons: [1, 2] }),
  { kind: 'collision', season: 2 }
);

// 6. Auto-derived clash still bumps past the highest TV sibling (imports survive).
expect(
  'Auto-derived clash bumps to max+1',
  resolveSeason({ type: 'TV', season: 1, explicit: false, tvSiblingSeasons: [1, 2, 3] }),
  { kind: 'ok', season: 4 }
);

// 7. First TV entry of a franchise (no siblings) keeps its season.
expect(
  'First TV entry, no siblings',
  resolveSeason({ type: 'TV', season: 1, explicit: false, tvSiblingSeasons: [] }),
  { kind: 'ok', season: 1 }
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

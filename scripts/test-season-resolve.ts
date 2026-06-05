/**
 * Standalone verification for lib/season-resolve.ts (the repo has no test runner).
 * Run with:  npx tsx scripts/test-season-resolve.ts
 */
import { resolveSeason, type SeasonResolution } from '../lib/season-resolve';

let passed = 0;
let failed = 0;

function expect(label: string, actual: SeasonResolution, expected: SeasonResolution) {
  const ok =
    actual.kind === expected.kind &&
    actual.season === expected.season &&
    (actual.part ?? null) === (expected.part ?? null);
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

// Non-TV rows pass through (outside the TV partial index).
expect(
  'Movie passes through despite clash',
  resolveSeason({ type: 'Movie', season: 1, part: null, explicit: false, tvSiblings: [{ season: 1, part: null }, { season: 2, part: null }] }),
  { kind: 'ok', season: 1, part: null }
);
expect(
  'OVA passes through',
  resolveSeason({ type: 'OVA', season: 3, part: null, explicit: true, tvSiblings: [{ season: 3, part: null }] }),
  { kind: 'ok', season: 3, part: null }
);

// TV, no part (existing behaviour preserved).
expect(
  'TV free season',
  resolveSeason({ type: 'TV', season: 3, part: null, explicit: false, tvSiblings: [{ season: 1, part: null }, { season: 2, part: null }] }),
  { kind: 'ok', season: 3, part: null }
);
expect(
  'Explicit edit to free TV slot sticks',
  resolveSeason({ type: 'TV', season: 3, part: null, explicit: true, tvSiblings: [{ season: 1, part: null }, { season: 2, part: null }] }),
  { kind: 'ok', season: 3, part: null }
);
expect(
  'Explicit edit onto real TV clash -> collision',
  resolveSeason({ type: 'TV', season: 2, part: null, explicit: true, tvSiblings: [{ season: 1, part: null }, { season: 2, part: null }] }),
  { kind: 'collision', season: 2, part: null }
);
expect(
  'Auto-derived clash bumps to max+1',
  resolveSeason({ type: 'TV', season: 1, part: null, explicit: false, tvSiblings: [{ season: 1, part: null }, { season: 2, part: null }, { season: 3, part: null }] }),
  { kind: 'ok', season: 4, part: null }
);
expect(
  'First TV entry, no siblings',
  resolveSeason({ type: 'TV', season: 1, part: null, explicit: false, tvSiblings: [] }),
  { kind: 'ok', season: 1, part: null }
);

// NEW: split-cour parts.
expect(
  'Explicit Season 4 Part 2 alongside Part 1 is allowed',
  resolveSeason({ type: 'TV', season: 4, part: 2, explicit: true, tvSiblings: [{ season: 4, part: 1 }] }),
  { kind: 'ok', season: 4, part: 2 }
);
expect(
  'Explicit Season 4 Part 2 onto an existing Part 2 -> collision',
  resolveSeason({ type: 'TV', season: 4, part: 2, explicit: true, tvSiblings: [{ season: 4, part: 2 }] }),
  { kind: 'collision', season: 4, part: 2 }
);
expect(
  'Null part is distinct from a numbered part (Season 4 vs Season 4 Part 1)',
  resolveSeason({ type: 'TV', season: 4, part: null, explicit: true, tvSiblings: [{ season: 4, part: 1 }] }),
  { kind: 'ok', season: 4, part: null }
);
expect(
  'Two null parts at the same season collide',
  resolveSeason({ type: 'TV', season: 4, part: null, explicit: true, tvSiblings: [{ season: 4, part: null }] }),
  { kind: 'collision', season: 4, part: null }
);
expect(
  'Auto-derived part clash bumps season, keeps the part',
  resolveSeason({ type: 'TV', season: 1, part: 2, explicit: false, tvSiblings: [{ season: 1, part: 2 }, { season: 2, part: null }] }),
  { kind: 'ok', season: 3, part: 2 }
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

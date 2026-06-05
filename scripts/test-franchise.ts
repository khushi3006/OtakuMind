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

  // --- truncation flags ---
  const truncCalls = await buildComponent(100, 'Classroom of the Elite', fakeRelations(coteGraph), { maxNodes: 30, maxApiCalls: 1 });
  expect('maxApiCalls=1 sets truncated', truncCalls.truncated === true);

  const truncNodes = await buildComponent(100, 'Classroom of the Elite', fakeRelations(coteGraph), { maxNodes: 2, maxApiCalls: 30 });
  expect('maxNodes=2 sets truncated', truncNodes.truncated === true);
  expect('maxNodes=2 keeps only 2 nodes', truncNodes.nodes.length === 2, `got ${truncNodes.nodes.length}`);

  // --- single-node (standalone) graph ---
  const solo = await buildComponent(500, 'Cowboy Bebop', fakeRelations({}), BOUNDS);
  expect('standalone: 1 node', solo.nodes.length === 1, `got ${solo.nodes.length}`);
  expect('standalone: root is the seed', pickCanonicalRoot(solo).malId === 500);
  expect('standalone: not truncated', solo.truncated === false);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();

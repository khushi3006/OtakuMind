/**
 * Standalone verification for the pure franchise logic (no network, no DB).
 * Run with:  npx tsx scripts/test-franchise.ts
 */
import { buildComponent, pickCanonicalRoot, canonicalSlugFor } from '../lib/franchise';
import type { GetRelations, RelationEntry } from '../lib/mal-relations';
import { parseRelationsPayload } from '../lib/mal-relations';
import { planSeasons } from '../lib/season-reassign';
import { resolveFranchise, localSlug, looseFranchiseMatch } from '../lib/franchise-resolve';

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

  // --- spine-first traversal reaches the true root even under a tight budget ---
  // Seeded from S3 whose side stories are listed BEFORE the prequel; a plain FIFO
  // walk would spend the budget on side stories and miss S1 (the real root).
  const spineGraph: Record<number, RelationEntry[]> = {
    300: [
      { relation: 'Side story', malId: 901, name: 'OVA A' },
      { relation: 'Side story', malId: 902, name: 'OVA B' },
      { relation: 'Side story', malId: 903, name: 'OVA C' },
      { relation: 'Prequel', malId: 200, name: 'S2' },
    ],
    200: [
      { relation: 'Sequel', malId: 300, name: 'S3' },
      { relation: 'Prequel', malId: 100, name: 'S1' },
    ],
    100: [{ relation: 'Sequel', malId: 200, name: 'S2' }],
    901: [],
    902: [],
    903: [],
  };
  const spineComp = await buildComponent(300, 'S3', fakeRelations(spineGraph), { maxNodes: 30, maxApiCalls: 2 });
  expect(
    'spine-first reaches the true root (100) under maxApiCalls=2',
    spineComp.nodes.some((n) => n.malId === 100),
    JSON.stringify(spineComp.nodes.map((n) => n.malId))
  );
  expect(
    'spine-first canonical root = S1 (100), not a side story',
    pickCanonicalRoot(spineComp).malId === 100,
    `got ${pickCanonicalRoot(spineComp).malId}`
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

  // --- (season, part): split-cour parts of the same season coexist (no bump) ---
  const cour = planSeasons([
    { id: 1, type: 'TV', season: 2, part: 1 },
    { id: 2, type: 'TV', season: 2, part: 2 },
  ]);
  expect(
    'S2P1 + S2P2 coexist at season 2',
    cour.find((a) => a.id === 1)?.season === 2 &&
      cour.find((a) => a.id === 1)?.part === 1 &&
      cour.find((a) => a.id === 2)?.season === 2 &&
      cour.find((a) => a.id === 2)?.part === 2,
    JSON.stringify(cour)
  );

  // --- (season, part): two rows at the SAME (season, part) collide -> bump season, keep part ---
  const dupPart = planSeasons([
    { id: 1, type: 'TV', season: 2, part: 1 },
    { id: 2, type: 'TV', season: 2, part: 1 },
  ]);
  expect(
    'duplicate S2P1 -> id1 (2,1), id2 bumps to (3,1)',
    dupPart.find((a) => a.id === 1)?.season === 2 &&
      dupPart.find((a) => a.id === 1)?.part === 1 &&
      dupPart.find((a) => a.id === 2)?.season === 3 &&
      dupPart.find((a) => a.id === 2)?.part === 1,
    JSON.stringify(dupPart)
  );

  // --- (season, part): a null-part row and a part-1 row at the same season coexist ---
  const nullVsPart = planSeasons([
    { id: 1, type: 'TV', season: 2, part: null },
    { id: 2, type: 'TV', season: 2, part: 1 },
  ]);
  expect(
    'S2(null) + S2P1 coexist (null != 1)',
    nullVsPart.find((a) => a.id === 1)?.season === 2 && nullVsPart.find((a) => a.id === 2)?.season === 2,
    JSON.stringify(nullVsPart)
  );

  // --- parseRelationsPayload: keep anime entries, drop manga, unmapped & malformed ---
  const parsed = parseRelationsPayload({
    Media: {
      relations: {
        edges: [
          { relationType: 'PREQUEL', node: { idMal: 100, type: 'ANIME', title: { english: 'S1', romaji: 'S1r' } } },
          { relationType: 'ADAPTATION', node: { idMal: 7, type: 'MANGA', title: { english: 'Manga' } } },
          { relationType: 'SEQUEL', node: { idMal: 300, type: 'ANIME', title: { romaji: 'S3' } } },
          { relationType: 'SIDE_STORY', node: { idMal: null, type: 'ANIME', title: { english: 'Unmapped' } } },
        ],
      },
    },
  });
  expect('parser keeps only the 2 mapped anime entries', parsed.length === 2, JSON.stringify(parsed));
  expect(
    'parser maps fields correctly',
    parsed[0].malId === 100 && parsed[0].relation === 'prequel' && parsed[0].name === 'S1'
  );
  expect('parser handles non-object input', parseRelationsPayload(null).length === 0);

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
  expect(
    'fuzzy: candidate is subset of existing matches (branch 2)',
    looseFranchiseMatch('sword art', ['sword art online']) === 'sword art online'
  );
  expect(
    'fuzzy: among matches, fewest-token slug wins',
    looseFranchiseMatch('classroom of the elite iii', [
      'classroom of the elite extra',
      'classroom of the elite',
    ]) === 'classroom of the elite'
  );

  // --- resolveFranchise single-node MAL path: standalone malId, no relations ---
  const r3 = await resolveFranchise({
    userId: 1,
    name: 'Some Standalone',
    malId: 999,
    existingSlugs: [],
    getRelations: fakeRelations({}),
  });
  expect(
    'resolve single-node MAL: localSlug + memberMalIds=[malId]',
    r3.slug === 'some standalone' && r3.memberMalIds.length === 1 && r3.memberMalIds[0] === 999,
    JSON.stringify(r3)
  );

  // --- localSlug: exact match wins; otherwise base slug ---
  expect('localSlug exact', localSlug('naruto', ['naruto']) === 'naruto');
  expect('localSlug no match -> base', localSlug('bleach', ['naruto']) === 'bleach');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();

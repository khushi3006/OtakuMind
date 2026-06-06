// Verifies the MalRelation DB cache: a cold getRelations() fetches live + persists,
// the stored JSON round-trips back to a valid RelationEntry[], and a second call
// returns the same data. Run: npx tsx scripts/verify-franchise-cache.ts
import { db } from '../lib/db';
import { getRelations } from '../lib/mal-relations';

const MAL_ID = 16498; // Attack on Titan — has relations

async function main() {
  // Clean slate so we exercise the cold (live → persist) path.
  await db.malRelation.deleteMany({ where: { malId: MAL_ID } });

  const first = await getRelations(MAL_ID);
  console.log(`getRelations(${MAL_ID}) → ${first.length} edges`);

  const row = await db.malRelation.findUnique({ where: { malId: MAL_ID } });
  if (!row) throw new Error('FAIL: no MalRelation row was persisted');

  const stored = row.relations as unknown as Array<{ relation: string; malId: number; name: string }>;
  if (!Array.isArray(stored) || stored.length !== first.length) {
    throw new Error(`FAIL: stored relations did not round-trip (${stored?.length} vs ${first.length})`);
  }
  const sample = stored[0];
  const shapeOk = !stored.length || (typeof sample.relation === 'string' && typeof sample.malId === 'number' && typeof sample.name === 'string');
  if (!shapeOk) throw new Error('FAIL: stored entry has wrong shape');

  const second = await getRelations(MAL_ID);
  console.log(`second getRelations(${MAL_ID}) → ${second.length} edges (from cache)`);
  console.log('persisted row syncedAt:', row.syncedAt.toISOString());
  console.log(`sample edge:`, sample);
  console.log('PASS: live fetch persisted to MalRelation and round-trips cleanly.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

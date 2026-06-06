import { db } from '../lib/db';
import { refreshAniList, refreshBroadcast, getAiringForMalIds } from '../lib/airing-cache';

// One Piece (21), Frieren (52991) — adjust as needed.
const SAMPLE = [21, 52991];

async function main() {
  console.log('refreshAniList…', await refreshAniList(SAMPLE), 'rows');
  console.log('refreshBroadcast…', await refreshBroadcast(SAMPLE), 'rows');
  const { rows, stale } = await getAiringForMalIds(SAMPLE);
  console.log('stale after refresh (expect []):', stale);
  for (const id of SAMPLE) console.log(id, rows.get(id));
  const all = await db.airingCache.findMany();
  console.log(`AiringCache now holds ${all.length} rows.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

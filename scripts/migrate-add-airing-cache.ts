import { db } from '../lib/db';

async function main() {
  console.log('Creating AiringCache table (idempotent)…');
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AiringCache" (
      "malId" INTEGER PRIMARY KEY,
      "nextEpisode" INTEGER,
      "nextEpisodeAt" INTEGER,
      "broadcastDay" TEXT,
      "broadcastTime" TEXT,
      "broadcastTimezone" TEXT,
      "broadcastString" TEXT,
      "airingStart" TEXT,
      "releaseStatus" TEXT NOT NULL DEFAULT 'unknown',
      "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "AiringCache_releaseStatus_nextEpisodeAt_idx" ON "AiringCache" ("releaseStatus", "nextEpisodeAt");`
  );
  await db.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "AiringCache_syncedAt_idx" ON "AiringCache" ("syncedAt");`
  );
  console.log('Done.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

// Idempotent mirror of prisma/migrations/20260606020000_add_anime_userid_malid_index.
// Run via: npx tsx scripts/migrate-add-userid-malid-index.ts
// Then: npx prisma migrate resolve --applied 20260606020000_add_anime_userid_malid_index
import { db } from '../lib/db';

async function main() {
  console.log('Creating Anime(userId, malId) index (idempotent)…');
  await db.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "Anime_userId_malId_idx" ON "Anime" ("userId", "malId");`
  );
  console.log('Done.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

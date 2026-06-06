// Idempotent mirror of prisma/migrations/20260606030000_add_mal_relation.
// Run via: npx tsx scripts/migrate-add-mal-relation.ts
// Then: npx prisma migrate resolve --applied 20260606030000_add_mal_relation
import { db } from '../lib/db';

async function main() {
  console.log('Creating MalRelation table (idempotent)…');
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "MalRelation" (
      "malId" INTEGER PRIMARY KEY,
      "relations" JSONB NOT NULL,
      "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('Done.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

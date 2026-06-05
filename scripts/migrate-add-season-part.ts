/**
 * Migration: add a nullable split-cour `part` column and make TV season
 * uniqueness part-aware. Idempotent. Run with:
 *   npx tsx scripts/migrate-add-season-part.ts
 *
 * Existing rows get part = NULL; each franchise currently has one TV row per
 * season, so the new unique index builds with no conflict and no backfill.
 *
 * After running, mirror Prisma's history:
 *   npx prisma migrate resolve --applied 20260605120000_add_season_part
 *   npx prisma generate
 */
import { db } from '../lib/db';

const OLD_KEY = 'Anime_userId_normalizedName_season_tv_key';
const NEW_KEY = 'Anime_userId_normalizedName_season_part_tv_key';

async function seasonIndexes() {
  return db.$queryRawUnsafe(
    `SELECT indexname::text AS indexname, indexdef::text AS indexdef FROM pg_indexes
     WHERE tablename = 'Anime'
       AND indexdef ILIKE '%normalizedName%' AND indexdef ILIKE '%season%';`
  );
}

async function main() {
  console.log('Adding Anime.part and a part-aware TV unique index...\n');
  console.log('Before:', await seasonIndexes());

  await db.$executeRawUnsafe(`ALTER TABLE "Anime" ADD COLUMN IF NOT EXISTS "part" INTEGER;`);
  await db.$executeRawUnsafe(`DROP INDEX IF EXISTS "${OLD_KEY}";`);
  await db.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "${NEW_KEY}"
       ON "Anime" ("userId", "normalizedName", "season", "part")
       NULLS NOT DISTINCT
       WHERE "type" = 'TV';`
  );
  console.log(`\nAdded "part" and created "${NEW_KEY}".`);
  console.log('\nAfter:', await seasonIndexes());
  console.log('\nDone.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('\nMigration failed:', err); process.exit(1); });

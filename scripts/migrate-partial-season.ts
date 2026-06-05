/**
 * Migration: make the per-user Anime season-uniqueness rule TV-only.
 *
 * Before: `@@unique([userId, normalizedName, season])` covered EVERY row, so a
 * movie/OVA/special filed under a franchise slug consumed a numeric season slot.
 * That inflated real TV seasons (e.g. SAO: Alicization landing on "Season 5")
 * and made manual season edits bounce to `maxSeason + 1`.
 *
 * After: a PARTIAL unique index that only covers `type = 'TV'` rows. Movies/
 * OVAs/specials are no longer numbered and never collide, so a TV entry can take
 * the season number it deserves even if a movie already "holds" it.
 *
 * Idempotent. Run with:  npx tsx scripts/migrate-partial-season.ts
 *
 * The existing data already satisfies TV-uniqueness (the old, stricter all-row
 * constraint guaranteed it), so CREATE UNIQUE INDEX cannot fail on current rows.
 *
 * After running, mirror Prisma's history:
 *   npx prisma migrate resolve --applied 20260605000000_partial_season_unique
 *   npx prisma generate
 */
import { db } from '../lib/db';

const FULL_KEY = 'Anime_userId_normalizedName_season_key';
const PARTIAL_KEY = 'Anime_userId_normalizedName_season_tv_key';

async function seasonIndexes() {
  // Cast the Postgres `name`-typed columns (indexname) to text — Prisma's raw
  // deserializer rejects the `name` type otherwise (P2010 "deserialize column
  // of type 'name'").
  return db.$queryRawUnsafe(
    `SELECT indexname::text AS indexname, indexdef::text AS indexdef FROM pg_indexes
     WHERE tablename = 'Anime'
       AND indexdef ILIKE '%normalizedName%' AND indexdef ILIKE '%season%';`
  );
}

async function main() {
  console.log('Migrating Anime season uniqueness to a TV-only partial index...\n');
  console.log('Before:', await seasonIndexes());

  // 1. Drop the all-row uniqueness. It was created as a table CONSTRAINT
  //    (scripts/migrate-db.ts), which owns its backing index, so DROP CONSTRAINT
  //    is required. The DROP INDEX is a fallback for any environment where it
  //    exists as a plain unique index instead of a constraint.
  await db.$executeRawUnsafe(`ALTER TABLE "Anime" DROP CONSTRAINT IF EXISTS "${FULL_KEY}";`);
  await db.$executeRawUnsafe(`DROP INDEX IF EXISTS "${FULL_KEY}";`);
  console.log(`\nDropped all-row uniqueness "${FULL_KEY}" (if present).`);

  // 2. Create the TV-only partial unique index. Non-TV rows stay unconstrained.
  await db.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "${PARTIAL_KEY}"
       ON "Anime" ("userId", "normalizedName", "season")
       WHERE "type" = 'TV';`
  );
  console.log(`Created partial unique index "${PARTIAL_KEY}" (TV rows only).`);

  console.log('\nAfter:', await seasonIndexes());
  console.log('\nDone.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nMigration failed:', err);
    process.exit(1);
  });

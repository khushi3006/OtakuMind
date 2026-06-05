-- Make the per-user Anime season-uniqueness rule TV-only.
--
-- Movies/OVAs/Specials are no longer numbered and stop consuming TV season
-- slots, so real TV seasons keep accurate numbers and explicit edits stick.
-- Mirrors scripts/migrate-partial-season.ts. Prisma cannot model partial unique
-- indexes, so this rule lives only in SQL (no @@unique in schema.prisma).
--
-- After applying (via the tsx script or this SQL), reconcile history with:
--   npx prisma migrate resolve --applied 20260605000000_partial_season_unique

ALTER TABLE "Anime" DROP CONSTRAINT IF EXISTS "Anime_userId_normalizedName_season_key";
DROP INDEX IF EXISTS "Anime_userId_normalizedName_season_key";

CREATE UNIQUE INDEX IF NOT EXISTS "Anime_userId_normalizedName_season_tv_key"
  ON "Anime" ("userId", "normalizedName", "season")
  WHERE "type" = 'TV';

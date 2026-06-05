-- Add a nullable split-cour `part` and make TV season-uniqueness part-aware.
-- NULL part = a normal single season; 1,2,… = a part of a split season.
-- NULLS NOT DISTINCT keeps two NULL parts at the same season colliding (so a
-- normal season stays unique) while numbered parts coexist. Mirrors
-- scripts/migrate-add-season-part.ts. Prisma can't model this, so it is SQL-only.
--
-- After applying (script or SQL), reconcile history with:
--   npx prisma migrate resolve --applied 20260605120000_add_season_part

ALTER TABLE "Anime" ADD COLUMN IF NOT EXISTS "part" INTEGER;

DROP INDEX IF EXISTS "Anime_userId_normalizedName_season_tv_key";

CREATE UNIQUE INDEX IF NOT EXISTS "Anime_userId_normalizedName_season_part_tv_key"
  ON "Anime" ("userId", "normalizedName", "season", "part")
  NULLS NOT DISTINCT
  WHERE "type" = 'TV';

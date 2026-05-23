ALTER TABLE "Anime"
ADD COLUMN "droppedAt" TIMESTAMP(3);

UPDATE "Anime"
SET "droppedAt" = "createdAt"
WHERE "status" = 'dropped' AND "droppedAt" IS NULL;

UPDATE "Anime"
SET "watchOrder" = NULL
WHERE "status" <> 'incomplete';

CREATE INDEX "Anime_status_droppedAt_idx" ON "Anime"("status", "droppedAt");

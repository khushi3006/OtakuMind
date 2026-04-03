-- CreateTable
CREATE TABLE "Anime" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "episodesWatched" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "imageUrl" TEXT,
    "malId" INTEGER,
    "type" TEXT NOT NULL DEFAULT 'TV',
    "originalOrder" INTEGER,
    "watchOrder" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Anime_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Anime_status_createdAt_idx" ON "Anime"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Anime_status_originalOrder_idx" ON "Anime"("status", "originalOrder");

-- CreateIndex
CREATE INDEX "Anime_status_watchOrder_idx" ON "Anime"("status", "watchOrder");

-- CreateIndex
CREATE INDEX "Anime_normalizedName_idx" ON "Anime"("normalizedName");

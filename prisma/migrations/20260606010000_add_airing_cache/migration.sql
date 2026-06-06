-- CreateTable
CREATE TABLE "AiringCache" (
    "malId" INTEGER NOT NULL,
    "nextEpisode" INTEGER,
    "nextEpisodeAt" INTEGER,
    "broadcastDay" TEXT,
    "broadcastTime" TEXT,
    "broadcastTimezone" TEXT,
    "broadcastString" TEXT,
    "airingStart" TEXT,
    "releaseStatus" TEXT NOT NULL DEFAULT 'unknown',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiringCache_pkey" PRIMARY KEY ("malId")
);

-- CreateIndex
CREATE INDEX "AiringCache_releaseStatus_nextEpisodeAt_idx" ON "AiringCache"("releaseStatus", "nextEpisodeAt");

-- CreateIndex
CREATE INDEX "AiringCache_syncedAt_idx" ON "AiringCache"("syncedAt");

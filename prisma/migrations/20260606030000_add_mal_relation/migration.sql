-- CreateTable
CREATE TABLE "MalRelation" (
    "malId" INTEGER NOT NULL,
    "relations" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MalRelation_pkey" PRIMARY KEY ("malId")
);

-- AlterTable
ALTER TABLE "BettingPick" ADD COLUMN     "oddsLevel" TEXT,
ADD COLUMN     "oddsReadIds" JSONB,
ADD COLUMN     "siteEventId" TEXT,
ADD COLUMN     "siteKey" TEXT;

-- CreateTable
CREATE TABLE "BookmakerSite" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "baseUrl" TEXT,
    "sportsPath" TEXT,
    "providerHint" TEXT,
    "readTarget" TEXT NOT NULL DEFAULT 'auto',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "statusReason" TEXT,
    "lastReadAt" TIMESTAMP(3),
    "lastOkAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookmakerSite_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "BookmakerRecipe" (
    "id" TEXT NOT NULL,
    "siteKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "level" TEXT NOT NULL,
    "api" JSONB,
    "dom" JSONB,
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "validation" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookmakerRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookmakerReadJob" (
    "id" TEXT NOT NULL,
    "siteKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "params" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookmakerReadJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookmakerEvent" (
    "id" TEXT NOT NULL,
    "siteKey" TEXT NOT NULL,
    "siteEventId" TEXT NOT NULL,
    "league" TEXT NOT NULL,
    "leagueKey" TEXT,
    "homeTeam" TEXT NOT NULL,
    "awayTeam" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "url" TEXT,
    "marketsCount" INTEGER,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "oddsEventId" TEXT,

    CONSTRAINT "BookmakerEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookmakerOdds" (
    "id" TEXT NOT NULL,
    "siteKey" TEXT NOT NULL,
    "siteEventId" TEXT NOT NULL,
    "marketSite" TEXT NOT NULL,
    "marketKey" TEXT,
    "selectionSite" TEXT NOT NULL,
    "selectionKey" TEXT,
    "line" DOUBLE PRECISION,
    "odds" DOUBLE PRECISION NOT NULL,
    "level" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL,
    "jobId" TEXT,

    CONSTRAINT "BookmakerOdds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookmakerRecipe_siteKey_isActive_idx" ON "BookmakerRecipe"("siteKey", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "BookmakerRecipe_siteKey_version_key" ON "BookmakerRecipe"("siteKey", "version");

-- CreateIndex
CREATE INDEX "BookmakerReadJob_siteKey_status_createdAt_idx" ON "BookmakerReadJob"("siteKey", "status", "createdAt");

-- CreateIndex
CREATE INDEX "BookmakerReadJob_target_status_createdAt_idx" ON "BookmakerReadJob"("target", "status", "createdAt");

-- CreateIndex
CREATE INDEX "BookmakerEvent_siteKey_startsAt_idx" ON "BookmakerEvent"("siteKey", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "BookmakerEvent_siteKey_siteEventId_key" ON "BookmakerEvent"("siteKey", "siteEventId");

-- CreateIndex
CREATE INDEX "BookmakerOdds_siteKey_siteEventId_readAt_idx" ON "BookmakerOdds"("siteKey", "siteEventId", "readAt");

-- AddForeignKey
ALTER TABLE "BookmakerRecipe" ADD CONSTRAINT "BookmakerRecipe_siteKey_fkey" FOREIGN KEY ("siteKey") REFERENCES "BookmakerSite"("key") ON DELETE CASCADE ON UPDATE CASCADE;

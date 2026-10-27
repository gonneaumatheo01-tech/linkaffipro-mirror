-- AlterTable
ALTER TABLE "Prospect" ADD COLUMN     "lastRequalifiedAt" TIMESTAMP(3),
ADD COLUMN     "linkAffiAskCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "linkAffiAskedAt" TIMESTAMP(3),
ADD COLUMN     "linkAffiLinkedAt" TIMESTAMP(3),
ADD COLUMN     "nextRequalifyAt" TIMESTAMP(3),
ADD COLUMN     "valueEstimate" JSONB,
ADD COLUMN     "watchMuted" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ProspectSnapshot" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subscribers" INTEGER,
    "medianViews" INTEGER,
    "viewRate" DOUBLE PRECISION,
    "postsPerDay" DOUBLE PRECISION,
    "brands" JSONB,
    "competitiveState" TEXT,
    "bestContact" TEXT,
    "contactConfidence" "ContactConfidence" NOT NULL DEFAULT 'NONE',
    "sellsAds" BOOLEAN NOT NULL DEFAULT false,
    "marketplace" BOOLEAN NOT NULL DEFAULT false,
    "lastPostAt" TIMESTAMP(3),
    "tier" "ProspectTier",
    "score" INTEGER,
    "merged" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ProspectSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectAlert" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "strength" INTEGER NOT NULL DEFAULT 0,
    "data" JSONB NOT NULL DEFAULT '{}',
    "evidence" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "sentAt" TIMESTAMP(3),
    "seenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProspectAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectNetwork" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mainContact" TEXT,
    "totalReach" INTEGER NOT NULL DEFAULT 0,
    "countries" JSONB NOT NULL DEFAULT '[]',
    "verticals" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "score" INTEGER NOT NULL DEFAULT 0,
    "origin" TEXT NOT NULL DEFAULT 'AUTO',
    "splitPairs" JSONB NOT NULL DEFAULT '[]',
    "dossier" TEXT,
    "dossierAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProspectNetwork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectCalibration" (
    "id" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "ctrFactor" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "ftdFactor" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "sample" INTEGER NOT NULL DEFAULT 0,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'default',
    "recommendationId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProspectCalibration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateResult" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "clicks" INTEGER,
    "regs" INTEGER,
    "ftd" INTEGER,
    "revenueCents" INTEGER,
    "missing" JSONB NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL DEFAULT 'linkaffi',
    "pulledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProspectSnapshot_prospectId_takenAt_idx" ON "ProspectSnapshot"("prospectId", "takenAt");

-- CreateIndex
CREATE INDEX "ProspectAlert_status_createdAt_idx" ON "ProspectAlert"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ProspectAlert_prospectId_dedupeKey_createdAt_idx" ON "ProspectAlert"("prospectId", "dedupeKey", "createdAt");

-- CreateIndex
CREATE INDEX "ProspectAlert_kind_createdAt_idx" ON "ProspectAlert"("kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProspectCalibration_segment_key" ON "ProspectCalibration"("segment");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateResult_prospectId_month_key" ON "AffiliateResult"("prospectId", "month");

-- CreateIndex
CREATE INDEX "Prospect_nextRequalifyAt_idx" ON "Prospect"("nextRequalifyAt");

-- CreateIndex
CREATE INDEX "Prospect_networkId_idx" ON "Prospect"("networkId");

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "ProspectNetwork"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectSnapshot" ADD CONSTRAINT "ProspectSnapshot_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectAlert" ADD CONSTRAINT "ProspectAlert_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateResult" ADD CONSTRAINT "AffiliateResult_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

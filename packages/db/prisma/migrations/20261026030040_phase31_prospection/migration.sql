-- CreateEnum
CREATE TYPE "ProspectKind" AS ENUM ('CHANNEL', 'GROUP');

-- CreateEnum
CREATE TYPE "ProspectVertical" AS ENUM ('SPORTS', 'CASINO', 'BOTH', 'OTHER');

-- CreateEnum
CREATE TYPE "ProspectRegion" AS ENUM ('EU', 'NON_EU', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ProspectAuthenticity" AS ENUM ('REAL', 'SUSPECT_GENERIC', 'SUSPECT_BOT', 'REPOST');

-- CreateEnum
CREATE TYPE "ContactConfidence" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ProspectTier" AS ENUM ('A', 'B', 'C', 'D');

-- CreateEnum
CREATE TYPE "ProspectStatus" AS ENUM ('DISCOVERED', 'ENRICHING', 'UNREADABLE', 'ENRICH_FAILED', 'QUALIFIED', 'DISQUALIFIED', 'CONTACTED', 'RESPONDED', 'NEGOTIATING', 'SIGNED', 'ACTIVE', 'CHURNED', 'SKIPPED', 'BLACKLISTED');

-- CreateEnum
CREATE TYPE "ProspectContactType" AS ENUM ('TELEGRAM_USERNAME', 'EMAIL', 'WEBSITE', 'BOT', 'SOCIAL', 'MARKETPLACE', 'LINKED_GROUP', 'OTHER');

-- CreateTable
CREATE TABLE "Prospect" (
    "id" TEXT NOT NULL,
    "username" TEXT,
    "telegramId" TEXT,
    "channelUrl" TEXT NOT NULL,
    "kind" "ProspectKind" NOT NULL DEFAULT 'CHANNEL',
    "title" TEXT NOT NULL DEFAULT '',
    "descriptionRaw" TEXT,
    "summaryFr" TEXT,
    "vertical" "ProspectVertical" NOT NULL DEFAULT 'OTHER',
    "verticalDetails" JSONB,
    "contentType" TEXT,
    "language" TEXT,
    "languageConfidence" DOUBLE PRECISION,
    "countries" JSONB,
    "geoSignals" JSONB,
    "geoConfidence" DOUBLE PRECISION,
    "region" "ProspectRegion" NOT NULL DEFAULT 'UNKNOWN',
    "regulatoryFlag" TEXT,
    "subscribers" INTEGER,
    "postsPerDay" DOUBLE PRECISION,
    "medianViews" INTEGER,
    "avgViews" INTEGER,
    "viewRate" DOUBLE PRECISION,
    "viewVarianceCv" DOUBLE PRECISION,
    "forwardRatio" DOUBLE PRECISION,
    "reactionRate" DOUBLE PRECISION,
    "commentRate" DOUBLE PRECISION,
    "linkDensity" DOUBLE PRECISION,
    "postingHours" JSONB,
    "firstSeenPostAt" TIMESTAMP(3),
    "lastPostAt" TIMESTAMP(3),
    "authenticity" "ProspectAuthenticity",
    "authenticityReason" TEXT,
    "fakeFlags" JSONB,
    "riskFlags" JSONB,
    "monetization" JSONB,
    "brands" JSONB,
    "hasCompetitor" BOOLEAN NOT NULL DEFAULT false,
    "competitiveState" TEXT,
    "contactConfidence" "ContactConfidence" NOT NULL DEFAULT 'NONE',
    "bestContact" TEXT,
    "score" INTEGER,
    "scoreBreakdown" JSONB,
    "tier" "ProspectTier",
    "tierReason" TEXT,
    "dossier" TEXT,
    "dossierAt" TIMESTAMP(3),
    "matchedOfferId" TEXT,
    "status" "ProspectStatus" NOT NULL DEFAULT 'DISCOVERED',
    "statusChangedAt" TIMESTAMP(3),
    "presentedAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "contactedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "dealType" TEXT,
    "dealTerms" JSONB,
    "linkAffiAffiliateId" TEXT,
    "networkId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceDetail" TEXT,
    "discoveredFromId" TEXT,
    "graphDepth" INTEGER NOT NULL DEFAULT 0,
    "cocitationCount" INTEGER NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enrichedAt" TIMESTAMP(3),
    "lastEnrichedAt" TIMESTAMP(3),
    "enrichError" TEXT,
    "enrichAttempts" INTEGER NOT NULL DEFAULT 0,
    "nextEnrichAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prospect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectContact" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "type" "ProspectContactType" NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT,
    "source" TEXT NOT NULL,
    "confidence" "ContactConfidence" NOT NULL,
    "evidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProspectContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectNote" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "authorType" TEXT NOT NULL DEFAULT 'client',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProspectNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectEvent" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProspectEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateOffer" (
    "id" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "vertical" "ProspectVertical" NOT NULL,
    "countries" JSONB NOT NULL DEFAULT '[]',
    "dealTypes" JSONB NOT NULL DEFAULT '{}',
    "trackingHint" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectSourceRun" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceDetail" TEXT,
    "languages" JSONB NOT NULL DEFAULT '[]',
    "vertical" TEXT,
    "started" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished" TIMESTAMP(3),
    "found" INTEGER NOT NULL DEFAULT 0,
    "newCount" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "pausedUntil" TIMESTAMP(3),

    CONSTRAINT "ProspectSourceRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_username_key" ON "Prospect"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_telegramId_key" ON "Prospect"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_channelUrl_key" ON "Prospect"("channelUrl");

-- CreateIndex
CREATE INDEX "Prospect_status_tier_score_idx" ON "Prospect"("status", "tier", "score");

-- CreateIndex
CREATE INDEX "Prospect_region_status_idx" ON "Prospect"("region", "status");

-- CreateIndex
CREATE INDEX "Prospect_status_priority_discoveredAt_idx" ON "Prospect"("status", "priority", "discoveredAt");

-- CreateIndex
CREATE INDEX "Prospect_presentedAt_idx" ON "Prospect"("presentedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProspectContact_prospectId_type_value_key" ON "ProspectContact"("prospectId", "type", "value");

-- CreateIndex
CREATE INDEX "ProspectNote_prospectId_createdAt_idx" ON "ProspectNote"("prospectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProspectEvent_prospectId_createdAt_idx" ON "ProspectEvent"("prospectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProspectEvent_type_createdAt_idx" ON "ProspectEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "ProspectSourceRun_sourceType_started_idx" ON "ProspectSourceRun"("sourceType", "started");

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_matchedOfferId_fkey" FOREIGN KEY ("matchedOfferId") REFERENCES "AffiliateOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectContact" ADD CONSTRAINT "ProspectContact_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectNote" ADD CONSTRAINT "ProspectNote_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectEvent" ADD CONSTRAINT "ProspectEvent_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "TrendSourceType" AS ENUM ('FORUM', 'REDDIT', 'TELEGRAM', 'TWITTER', 'NEWS', 'OTHER');

-- CreateEnum
CREATE TYPE "TrendCategory" AS ENUM ('AD_STRATEGY', 'AD_BAN', 'AD_CREATIVE', 'PLATFORM_CHANGE', 'MARKET_TREND', 'REGULATION', 'OFFER', 'TOOL', 'DISCUSSION', 'OTHER');

-- CreateEnum
CREATE TYPE "TrendSentiment" AS ENUM ('POSITIVE', 'NEGATIVE', 'NEUTRAL');

-- CreateEnum
CREATE TYPE "CompliancePlatform" AS ENUM ('META', 'TIKTOK', 'GOOGLE', 'SNAP', 'X', 'TELEGRAM', 'OTHER');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'BAN');

-- CreateEnum
CREATE TYPE "StrategyReportType" AS ENUM ('WEEKLY', 'MONTHLY', 'ON_DEMAND');

-- CreateTable
CREATE TABLE "TrendSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sourceType" "TrendSourceType" NOT NULL,
    "market" "Vertical" NOT NULL,
    "countries" JSONB NOT NULL DEFAULT '[]',
    "languages" JSONB NOT NULL DEFAULT '[]',
    "scrapeConfig" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "origin" TEXT NOT NULL DEFAULT 'seed',
    "lastScrapedAt" TIMESTAMP(3),
    "nextScrapeAt" TIMESTAMP(3),
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrendSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendEntry" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "market" "Vertical" NOT NULL,
    "countries" JSONB NOT NULL DEFAULT '[]',
    "language" TEXT NOT NULL,
    "title" TEXT,
    "summary" TEXT NOT NULL,
    "summaryOriginal" TEXT,
    "url" TEXT NOT NULL,
    "urlHash" TEXT NOT NULL,
    "author" TEXT,
    "publishedAt" TIMESTAMP(3),
    "category" "TrendCategory" NOT NULL,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "sentiment" "TrendSentiment" NOT NULL,
    "relevanceScore" INTEGER NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "rawText" TEXT,
    "rawTextPurgeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrendEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceRule" (
    "id" TEXT NOT NULL,
    "platform" "CompliancePlatform" NOT NULL,
    "market" "Vertical" NOT NULL,
    "country" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "workaround" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL,
    "sourceEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyReport" (
    "id" TEXT NOT NULL,
    "market" "Vertical",
    "countries" JSONB NOT NULL DEFAULT '[]',
    "period" TEXT NOT NULL,
    "reportType" "StrategyReportType" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL DEFAULT '[]',
    "requestedBy" TEXT,
    "requestText" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrendSource_url_key" ON "TrendSource"("url");

-- CreateIndex
CREATE INDEX "TrendSource_isActive_nextScrapeAt_idx" ON "TrendSource"("isActive", "nextScrapeAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrendEntry_urlHash_key" ON "TrendEntry"("urlHash");

-- CreateIndex
CREATE INDEX "TrendEntry_market_createdAt_idx" ON "TrendEntry"("market", "createdAt");

-- CreateIndex
CREATE INDEX "TrendEntry_category_createdAt_idx" ON "TrendEntry"("category", "createdAt");

-- CreateIndex
CREATE INDEX "TrendEntry_rawTextPurgeAt_idx" ON "TrendEntry"("rawTextPurgeAt");

-- CreateIndex
CREATE INDEX "ComplianceRule_platform_market_country_idx" ON "ComplianceRule"("platform", "market", "country");

-- CreateIndex
CREATE INDEX "ComplianceRule_riskLevel_isActive_idx" ON "ComplianceRule"("riskLevel", "isActive");

-- CreateIndex
CREATE INDEX "StrategyReport_reportType_createdAt_idx" ON "StrategyReport"("reportType", "createdAt");

-- AddForeignKey
ALTER TABLE "TrendEntry" ADD CONSTRAINT "TrendEntry_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "TrendSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceRule" ADD CONSTRAINT "ComplianceRule_sourceEntryId_fkey" FOREIGN KEY ("sourceEntryId") REFERENCES "TrendEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

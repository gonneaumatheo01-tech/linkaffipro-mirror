-- CreateEnum
CREATE TYPE "QaContentType" AS ENUM ('POST', 'SHORT', 'REPORT', 'KEVIN_RESPONSE', 'RECOMMENDATION', 'ALERT', 'COMPLIANCE_RULE');

-- CreateEnum
CREATE TYPE "QaVerdict" AS ENUM ('APPROVED', 'REJECTED', 'TIMEOUT', 'ERROR');

-- CreateTable
CREATE TABLE "QaCheck" (
    "id" TEXT NOT NULL,
    "contentType" "QaContentType" NOT NULL,
    "contentId" TEXT NOT NULL,
    "teamKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "verdict" "QaVerdict" NOT NULL,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "corrections" JSONB,
    "content" JSONB,
    "modelUsed" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "checkedBy" TEXT NOT NULL DEFAULT 'qa-global',
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QaCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QaCheck_contentType_contentId_createdAt_idx" ON "QaCheck"("contentType", "contentId", "createdAt");

-- CreateIndex
CREATE INDEX "QaCheck_contentHash_idx" ON "QaCheck"("contentHash");

-- CreateIndex
CREATE INDEX "QaCheck_verdict_createdAt_idx" ON "QaCheck"("verdict", "createdAt");

-- CreateIndex
CREATE INDEX "QaCheck_teamKey_createdAt_idx" ON "QaCheck"("teamKey", "createdAt");

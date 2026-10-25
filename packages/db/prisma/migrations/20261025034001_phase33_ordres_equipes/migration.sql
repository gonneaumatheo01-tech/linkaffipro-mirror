-- CreateEnum
CREATE TYPE "TeamOrderKind" AS ENUM ('PROGRAM', 'ONE_SHOT', 'ADJUST', 'ASK', 'WHAT_IF');

-- CreateEnum
CREATE TYPE "TeamOrderStatus" AS ENUM ('DRAFT', 'WAITING_CONFIRM', 'RUNNING', 'DONE', 'CANCELLED', 'BLOCKED', 'FAILED');

-- AlterTable
ALTER TABLE "AgentMission" ADD COLUMN     "orderId" TEXT;

-- AlterTable
ALTER TABLE "BetCategory" ADD COLUMN     "createdByOrderId" TEXT,
ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "BossUnmet" ADD COLUMN     "lastOrderId" TEXT,
ADD COLUMN     "suggestedCapability" TEXT,
ADD COLUMN     "teamKey" TEXT;

-- CreateTable
CREATE TABLE "TeamOrder" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "requestText" TEXT NOT NULL,
    "interpretation" JSONB NOT NULL DEFAULT '{}',
    "recap" TEXT NOT NULL DEFAULT '',
    "kind" "TeamOrderKind" NOT NULL,
    "teamKey" TEXT NOT NULL,
    "status" "TeamOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "progress" JSONB NOT NULL DEFAULT '{}',
    "impossible" JSONB,
    "createdById" TEXT,
    "chatId" TEXT,
    "pendingId" TEXT,
    "planCacheKey" TEXT,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelPlanOverride" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "teamKey" TEXT NOT NULL,
    "fromDay" TEXT NOT NULL,
    "toDay" TEXT NOT NULL,
    "postsPerDay" INTEGER,
    "picksPerDay" INTEGER,
    "betCategoryId" TEXT,
    "themes" JSONB,
    "mix" JSONB,
    "format" TEXT,
    "windowStart" TEXT,
    "windowEnd" TEXT,
    "personaId" TEXT,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelPlanOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeamOrder_number_key" ON "TeamOrder"("number");

-- CreateIndex
CREATE INDEX "TeamOrder_status_teamKey_idx" ON "TeamOrder"("status", "teamKey");

-- CreateIndex
CREATE INDEX "TeamOrder_planCacheKey_createdAt_idx" ON "TeamOrder"("planCacheKey", "createdAt");

-- CreateIndex
CREATE INDEX "ChannelPlanOverride_channelId_fromDay_toDay_idx" ON "ChannelPlanOverride"("channelId", "fromDay", "toDay");

-- CreateIndex
CREATE INDEX "ChannelPlanOverride_orderId_idx" ON "ChannelPlanOverride"("orderId");

-- CreateIndex
CREATE INDEX "AgentMission_orderId_idx" ON "AgentMission"("orderId");

-- AddForeignKey
ALTER TABLE "AgentMission" ADD CONSTRAINT "AgentMission_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "TeamOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelPlanOverride" ADD CONSTRAINT "ChannelPlanOverride_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "TeamOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

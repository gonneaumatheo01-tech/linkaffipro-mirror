-- Phase 19 : agents IA (Grand Chef, Chefs d'équipe, agents). Migration additive : nouvelles tables, colonnes nullables
-- sur MediaAsset (médiathèque) et Post.agentMissionId. Aucune table existante n'est modifiée autrement.
-- CreateEnum
CREATE TYPE "AgentMissionKind" AS ENUM ('POST', 'BET', 'REPORT', 'ANALYSIS');

-- CreateEnum
CREATE TYPE "AgentMissionStatus" AS ENUM ('PENDING', 'RUNNING', 'WAITING_VALIDATION', 'WAITING_HUMAN', 'DONE', 'FAILED', 'CANCELLED', 'BLOCKED_BUDGET');

-- CreateEnum
CREATE TYPE "AgentMissionCreator" AS ENUM ('GRAND_CHEF', 'HUMAN');

-- CreateEnum
CREATE TYPE "AgentValidationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EDITED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AgentDecisionVia" AS ENUM ('SITE', 'TELEGRAM');

-- CreateEnum
CREATE TYPE "HumanRequestKind" AS ENUM ('SECRET', 'TEXT', 'CHOICE', 'MEDIA', 'CONFIRM');

-- CreateEnum
CREATE TYPE "HumanRequestStatus" AS ENUM ('QUEUED', 'PENDING', 'ANSWERED', 'SKIPPED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MediaAssetKind" AS ENUM ('SOURCE', 'GENERATED', 'PHOTO', 'REFERENCE');

-- CreateEnum
CREATE TYPE "MediaAssetOrigin" AS ENUM ('HUMAN', 'AI');

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "kind" "MediaAssetKind",
ADD COLUMN     "libraryMessageId" INTEGER,
ADD COLUMN     "origin" "MediaAssetOrigin",
ADD COLUMN     "personaId" TEXT,
ADD COLUMN     "tags" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "teamKey" TEXT,
ADD COLUMN     "theme" TEXT;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "agentMissionId" TEXT;

-- CreateTable
CREATE TABLE "AgentTeamConfig" (
    "id" TEXT NOT NULL,
    "teamKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "simulation" BOOLEAN NOT NULL DEFAULT true,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "pausedReason" TEXT,
    "autonomyLevel" INTEGER NOT NULL DEFAULT 0,
    "monthlyBudgetCents" JSONB NOT NULL DEFAULT '{}',
    "styleGuidelines" TEXT NOT NULL DEFAULT '',
    "forbiddenWords" JSONB NOT NULL DEFAULT '[]',
    "maxTextLength" INTEGER NOT NULL DEFAULT 900,
    "quietHours" JSONB NOT NULL DEFAULT '[]',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentTeamConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelAgentPlan" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "teamKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "postsPerDay" INTEGER NOT NULL DEFAULT 3,
    "windowStart" TEXT NOT NULL DEFAULT '09:00',
    "windowEnd" TEXT NOT NULL DEFAULT '22:00',
    "minSpacingMinutes" INTEGER NOT NULL DEFAULT 90,
    "mix" JSONB NOT NULL DEFAULT '{"video":0,"photo":0,"text":1}',
    "personaId" TEXT,
    "campaignId" TEXT,
    "themes" JSONB NOT NULL DEFAULT '[]',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelAgentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMission" (
    "id" TEXT NOT NULL,
    "teamKey" TEXT NOT NULL,
    "kind" "AgentMissionKind" NOT NULL DEFAULT 'POST',
    "channelId" TEXT,
    "status" "AgentMissionStatus" NOT NULL DEFAULT 'PENDING',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "postId" TEXT,
    "validationId" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "planDay" TEXT,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" "AgentMissionCreator" NOT NULL DEFAULT 'GRAND_CHEF',
    "createdById" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentMission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "agentKey" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "inputSummary" TEXT,
    "outputSummary" TEXT,
    "error" TEXT,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentValidation" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "missionId" TEXT NOT NULL,
    "teamKey" TEXT NOT NULL,
    "previewText" TEXT NOT NULL,
    "mediaAssetId" TEXT,
    "reason" TEXT NOT NULL,
    "status" "AgentValidationStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedVia" "AgentDecisionVia",
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "telegramMessageId" INTEGER,
    "awaitingEditAt" TIMESTAMP(3),
    "editedText" TEXT,
    "remindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentValidation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentUsage" (
    "id" TEXT NOT NULL,
    "teamKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "cents" INTEGER NOT NULL DEFAULT 0,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "alerted80" BOOLEAN NOT NULL DEFAULT false,
    "alerted100" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HumanRequest" (
    "id" TEXT NOT NULL,
    "teamKey" TEXT,
    "kind" "HumanRequestKind" NOT NULL,
    "key" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "expected" JSONB NOT NULL DEFAULT '{}',
    "status" "HumanRequestStatus" NOT NULL DEFAULT 'QUEUED',
    "answerSummary" TEXT,
    "askedAt" TIMESTAMP(3),
    "telegramMessageId" INTEGER,
    "remindedAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "missionId" TEXT,
    "onAnswer" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HumanRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaUsage" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "postId" TEXT,
    "missionId" TEXT,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentTeamConfig_teamKey_key" ON "AgentTeamConfig"("teamKey");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelAgentPlan_channelId_key" ON "ChannelAgentPlan"("channelId");

-- CreateIndex
CREATE INDEX "ChannelAgentPlan_teamKey_enabled_idx" ON "ChannelAgentPlan"("teamKey", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMission_postId_key" ON "AgentMission"("postId");

-- CreateIndex
CREATE INDEX "AgentMission_teamKey_status_idx" ON "AgentMission"("teamKey", "status");

-- CreateIndex
CREATE INDEX "AgentMission_channelId_scheduledFor_idx" ON "AgentMission"("channelId", "scheduledFor");

-- CreateIndex
CREATE INDEX "AgentMission_status_lastActivityAt_idx" ON "AgentMission"("status", "lastActivityAt");

-- CreateIndex
CREATE INDEX "AgentMission_createdAt_idx" ON "AgentMission"("createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_missionId_startedAt_idx" ON "AgentRun"("missionId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentRun_agentKey_startedAt_idx" ON "AgentRun"("agentKey", "startedAt");

-- CreateIndex
CREATE INDEX "AgentRun_startedAt_idx" ON "AgentRun"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentValidation_number_key" ON "AgentValidation"("number");

-- CreateIndex
CREATE INDEX "AgentValidation_status_createdAt_idx" ON "AgentValidation"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AgentValidation_teamKey_status_idx" ON "AgentValidation"("teamKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AgentUsage_teamKey_provider_month_key" ON "AgentUsage"("teamKey", "provider", "month");

-- CreateIndex
CREATE INDEX "HumanRequest_status_createdAt_idx" ON "HumanRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "HumanRequest_key_status_idx" ON "HumanRequest"("key", "status");

-- CreateIndex
CREATE INDEX "MediaUsage_channelId_usedAt_idx" ON "MediaUsage"("channelId", "usedAt");

-- CreateIndex
CREATE INDEX "MediaUsage_assetId_usedAt_idx" ON "MediaUsage"("assetId", "usedAt");

-- CreateIndex
CREATE INDEX "MediaAsset_teamKey_theme_idx" ON "MediaAsset"("teamKey", "theme");

-- CreateIndex
CREATE INDEX "Post_agentMissionId_idx" ON "Post"("agentMissionId");

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_agentMissionId_fkey" FOREIGN KEY ("agentMissionId") REFERENCES "AgentMission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelAgentPlan" ADD CONSTRAINT "ChannelAgentPlan_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMission" ADD CONSTRAINT "AgentMission_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "AgentMission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentValidation" ADD CONSTRAINT "AgentValidation_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "AgentMission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaUsage" ADD CONSTRAINT "MediaUsage_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaUsage" ADD CONSTRAINT "MediaUsage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Phase 21 : équipe Algorithme (fiches de résultats des posts, tests A/B, recommandations, rapports). Migration
-- additive : nouvelles tables, colonnes nullables ou avec défaut sur ChannelAgentPlan et Persona.
-- CreateEnum
CREATE TYPE "ExperimentKind" AS ENUM ('STYLE_LEGENDE', 'HORAIRE', 'MELANGE', 'REGLAGE_PERSONA');

-- CreateEnum
CREATE TYPE "ExperimentStatus" AS ENUM ('PROPOSED', 'RUNNING', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('PROPOSED', 'APPLIED', 'UNDONE', 'REJECTED');

-- CreateEnum
CREATE TYPE "RecommendationAppliedBy" AS ENUM ('GRAND_CHEF', 'HUMAN');

-- AlterTable
ALTER TABLE "ChannelAgentPlan" ADD COLUMN     "styleNotes" TEXT,
ADD COLUMN     "suggestedWindows" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Persona" ADD COLUMN     "suggestedFollowUpHours" JSONB;

-- CreateTable
CREATE TABLE "PostInsight" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "vertical" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "views1h" INTEGER,
    "views2h" INTEGER,
    "views24h" INTEGER,
    "viewsFinal" INTEGER NOT NULL DEFAULT 0,
    "forwards" INTEGER NOT NULL DEFAULT 0,
    "reactions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "offerClicks" INTEGER NOT NULL DEFAULT 0,
    "registrations" INTEGER NOT NULL DEFAULT 0,
    "ftds" INTEGER NOT NULL DEFAULT 0,
    "deposits" INTEGER NOT NULL DEFAULT 0,
    "format" TEXT NOT NULL,
    "theme" TEXT,
    "categoryId" TEXT,
    "personaId" TEXT,
    "textLength" INTEGER NOT NULL DEFAULT 0,
    "emojiCount" INTEGER NOT NULL DEFAULT 0,
    "hasButtons" BOOLEAN NOT NULL DEFAULT false,
    "hourParis" INTEGER NOT NULL,
    "weekdayParis" INTEGER NOT NULL,
    "abGroupId" TEXT,
    "abVariant" TEXT,
    "agentMissionId" TEXT,
    "model" TEXT,
    "experimentId" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL,
    "teamKey" TEXT NOT NULL,
    "channelId" TEXT,
    "personaId" TEXT,
    "kind" "ExperimentKind" NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "variants" JSONB NOT NULL,
    "metric" TEXT NOT NULL,
    "minSamples" INTEGER NOT NULL DEFAULT 20,
    "status" "ExperimentStatus" NOT NULL DEFAULT 'PROPOSED',
    "startedAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "result" JSONB,
    "winner" TEXT,
    "recommendationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "teamKey" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "expectedGain" TEXT,
    "size" TEXT NOT NULL DEFAULT 'SMALL',
    "status" "RecommendationStatus" NOT NULL DEFAULT 'PROPOSED',
    "appliedAt" TIMESTAMP(3),
    "appliedBy" "RecommendationAppliedBy",
    "appliedById" TEXT,
    "undoneAt" TIMESTAMP(3),
    "undoneById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "weekStart" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsightReport" (
    "id" TEXT NOT NULL,
    "teamKey" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "stats" JSONB NOT NULL DEFAULT '{}',
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsightReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PostInsight_postId_key" ON "PostInsight"("postId");

-- CreateIndex
CREATE INDEX "PostInsight_channelId_sentAt_idx" ON "PostInsight"("channelId", "sentAt");

-- CreateIndex
CREATE INDEX "PostInsight_vertical_sentAt_idx" ON "PostInsight"("vertical", "sentAt");

-- CreateIndex
CREATE INDEX "PostInsight_format_idx" ON "PostInsight"("format");

-- CreateIndex
CREATE INDEX "Experiment_status_channelId_idx" ON "Experiment"("status", "channelId");

-- CreateIndex
CREATE INDEX "Experiment_teamKey_status_idx" ON "Experiment"("teamKey", "status");

-- CreateIndex
CREATE INDEX "Recommendation_status_teamKey_idx" ON "Recommendation"("status", "teamKey");

-- CreateIndex
CREATE INDEX "Recommendation_target_targetId_idx" ON "Recommendation"("target", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "InsightReport_teamKey_weekStart_key" ON "InsightReport"("teamKey", "weekStart");

-- AddForeignKey
ALTER TABLE "PostInsight" ADD CONSTRAINT "PostInsight_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;


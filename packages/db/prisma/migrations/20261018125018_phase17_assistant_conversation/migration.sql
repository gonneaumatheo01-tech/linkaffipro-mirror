-- CreateEnum
CREATE TYPE "BotMode" AS ENUM ('STANDARD', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "ConversationStage" AS ENUM ('WELCOME', 'CHAT', 'PROPOSAL', 'LINK_SENT', 'FOLLOW_UP', 'CONVERTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('BOT', 'HUMAN', 'PAUSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ConversationDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "ConversationAuthor" AS ENUM ('MEMBER', 'ASSISTANT', 'TEAM', 'SYSTEM');

-- AlterEnum
ALTER TYPE "OutboundKind" ADD VALUE 'ASSISTANT';

-- AlterTable
ALTER TABLE "Bot" ADD COLUMN     "mode" "BotMode" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "personaId" TEXT;

-- AlterTable
ALTER TABLE "Click" ADD COLUMN     "conversationId" TEXT;

-- AlterTable
ALTER TABLE "TrackingLink" ADD COLUMN     "personaId" TEXT;

-- CreateTable
CREATE TABLE "Persona" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gender" TEXT NOT NULL DEFAULT 'F',
    "personality" TEXT NOT NULL DEFAULT '',
    "tone" TEXT NOT NULL DEFAULT '',
    "languages" TEXT[] DEFAULT ARRAY['fr']::TEXT[],
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "extraPrompt" TEXT,
    "model" TEXT,
    "temperature" DOUBLE PRECISION,
    "minExchangesBeforeOffer" INTEGER NOT NULL DEFAULT 4,
    "requireInterest" BOOLEAN NOT NULL DEFAULT true,
    "maxOfferSends" INTEGER NOT NULL DEFAULT 2,
    "followUpAfterHours" INTEGER NOT NULL DEFAULT 24,
    "followUpsMax" INTEGER NOT NULL DEFAULT 2,
    "affiliateCampaignId" TEXT,
    "campaignId" TEXT,
    "offerPitch" TEXT NOT NULL DEFAULT '',
    "offerButtonText" TEXT NOT NULL DEFAULT 'Découvrir l''app',
    "offerMediaAssetId" TEXT,
    "botDescription" TEXT,
    "botShortDescription" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Persona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "personaId" TEXT,
    "source" TEXT,
    "stage" "ConversationStage" NOT NULL DEFAULT 'WELCOME',
    "status" "ConversationStatus" NOT NULL DEFAULT 'BOT',
    "styleProfile" JSONB NOT NULL DEFAULT '{}',
    "summary" TEXT,
    "facts" JSONB NOT NULL DEFAULT '[]',
    "language" TEXT,
    "isMinor" BOOLEAN NOT NULL DEFAULT false,
    "stoppedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedReason" TEXT,
    "takenOverById" TEXT,
    "takenOverAt" TIMESTAMP(3),
    "memberMessages" INTEGER NOT NULL DEFAULT 0,
    "assistantTurns" INTEGER NOT NULL DEFAULT 0,
    "offerSends" INTEGER NOT NULL DEFAULT 0,
    "lastInboundAt" TIMESTAMP(3),
    "lastAssistantAt" TIMESTAMP(3),
    "followUpCount" INTEGER NOT NULL DEFAULT 0,
    "nextFollowUpAt" TIMESTAMP(3),
    "retryAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "ConversationDirection" NOT NULL,
    "author" "ConversationAuthor" NOT NULL,
    "teamUserId" TEXT,
    "text" TEXT NOT NULL,
    "media" JSONB,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "telegramMessageId" BIGINT,
    "outboundMessageId" TEXT,
    "turnId" TEXT,
    "partIndex" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationEvent" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromStage" "ConversationStage",
    "toStage" "ConversationStage",
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantOfferLink" (
    "id" TEXT NOT NULL,
    "subId" TEXT NOT NULL,
    "conversationId" TEXT,
    "personaId" TEXT,
    "botId" TEXT NOT NULL,
    "memberId" TEXT,
    "trackingLinkId" TEXT NOT NULL,
    "source" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstOpenedAt" TIMESTAMP(3),
    "opens" INTEGER NOT NULL DEFAULT 0,
    "clickId" TEXT,

    CONSTRAINT "AssistantOfferLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiConversationUsage" (
    "id" TEXT NOT NULL,
    "personaId" TEXT,
    "conversationId" TEXT,
    "purpose" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costEur" DECIMAL(10,4) NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiConversationUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Conversation_status_nextFollowUpAt_idx" ON "Conversation"("status", "nextFollowUpAt");

-- CreateIndex
CREATE INDEX "Conversation_status_retryAt_idx" ON "Conversation"("status", "retryAt");

-- CreateIndex
CREATE INDEX "Conversation_personaId_createdAt_idx" ON "Conversation"("personaId", "createdAt");

-- CreateIndex
CREATE INDEX "Conversation_source_idx" ON "Conversation"("source");

-- CreateIndex
CREATE INDEX "Conversation_lastInboundAt_idx" ON "Conversation"("lastInboundAt");

-- CreateIndex
CREATE INDEX "Conversation_memberId_idx" ON "Conversation"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_botId_memberId_key" ON "Conversation"("botId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMessage_outboundMessageId_key" ON "ConversationMessage"("outboundMessageId");

-- CreateIndex
CREATE INDEX "ConversationMessage_conversationId_createdAt_idx" ON "ConversationMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationMessage_conversationId_direction_turnId_idx" ON "ConversationMessage"("conversationId", "direction", "turnId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMessage_conversationId_direction_telegramMessag_key" ON "ConversationMessage"("conversationId", "direction", "telegramMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMessage_turnId_partIndex_key" ON "ConversationMessage"("turnId", "partIndex");

-- CreateIndex
CREATE INDEX "ConversationEvent_conversationId_createdAt_idx" ON "ConversationEvent"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationEvent_type_createdAt_idx" ON "ConversationEvent"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantOfferLink_subId_key" ON "AssistantOfferLink"("subId");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantOfferLink_clickId_key" ON "AssistantOfferLink"("clickId");

-- CreateIndex
CREATE INDEX "AssistantOfferLink_conversationId_idx" ON "AssistantOfferLink"("conversationId");

-- CreateIndex
CREATE INDEX "AssistantOfferLink_personaId_sentAt_idx" ON "AssistantOfferLink"("personaId", "sentAt");

-- CreateIndex
CREATE INDEX "AiConversationUsage_createdAt_idx" ON "AiConversationUsage"("createdAt");

-- CreateIndex
CREATE INDEX "AiConversationUsage_personaId_createdAt_idx" ON "AiConversationUsage"("personaId", "createdAt");

-- CreateIndex
CREATE INDEX "AiConversationUsage_conversationId_idx" ON "AiConversationUsage"("conversationId");

-- CreateIndex
CREATE INDEX "Bot_mode_idx" ON "Bot"("mode");

-- CreateIndex
CREATE INDEX "Click_conversationId_idx" ON "Click"("conversationId");

-- CreateIndex
CREATE INDEX "TrackingLink_personaId_idx" ON "TrackingLink"("personaId");

-- AddForeignKey
ALTER TABLE "Bot" ADD CONSTRAINT "Bot_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingLink" ADD CONSTRAINT "TrackingLink_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Click" ADD CONSTRAINT "Click_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Persona" ADD CONSTRAINT "Persona_affiliateCampaignId_fkey" FOREIGN KEY ("affiliateCampaignId") REFERENCES "AffiliateCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Persona" ADD CONSTRAINT "Persona_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Persona" ADD CONSTRAINT "Persona_offerMediaAssetId_fkey" FOREIGN KEY ("offerMediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Persona" ADD CONSTRAINT "Persona_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_takenOverById_fkey" FOREIGN KEY ("takenOverById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_teamUserId_fkey" FOREIGN KEY ("teamUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_outboundMessageId_fkey" FOREIGN KEY ("outboundMessageId") REFERENCES "OutboundMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationEvent" ADD CONSTRAINT "ConversationEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantOfferLink" ADD CONSTRAINT "AssistantOfferLink_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantOfferLink" ADD CONSTRAINT "AssistantOfferLink_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantOfferLink" ADD CONSTRAINT "AssistantOfferLink_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantOfferLink" ADD CONSTRAINT "AssistantOfferLink_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantOfferLink" ADD CONSTRAINT "AssistantOfferLink_trackingLinkId_fkey" FOREIGN KEY ("trackingLinkId") REFERENCES "TrackingLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantOfferLink" ADD CONSTRAINT "AssistantOfferLink_clickId_fkey" FOREIGN KEY ("clickId") REFERENCES "Click"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversationUsage" ADD CONSTRAINT "AiConversationUsage_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversationUsage" ADD CONSTRAINT "AiConversationUsage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

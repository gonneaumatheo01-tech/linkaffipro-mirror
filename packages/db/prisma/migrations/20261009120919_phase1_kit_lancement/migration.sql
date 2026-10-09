-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('REQUESTED', 'PENDING_GATE', 'SCHEDULED', 'APPROVED', 'DECLINED', 'LEFT', 'KICKED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "ApprovalMode" AS ENUM ('IMMEDIATE', 'DELAY', 'MANUAL');

-- CreateEnum
CREATE TYPE "GateMode" AS ENUM ('NONE', 'REQUIRED', 'SOFT');

-- CreateEnum
CREATE TYPE "ExpireAction" AS ENUM ('DECLINE', 'APPROVE', 'KEEP');

-- CreateEnum
CREATE TYPE "InviteLinkKind" AS ENUM ('AD_ENTRY', 'GATE', 'MANUAL');

-- CreateEnum
CREATE TYPE "AdPlatform" AS ENUM ('TIKTOK', 'META', 'OTHER');

-- CreateEnum
CREATE TYPE "TrackingLinkKind" AS ENUM ('AD_ENTRY', 'OFFER', 'BUTTON', 'GENERIC');

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'FAILED', 'DELETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SequenceTrigger" AS ENUM ('JOIN_REQUEST', 'GATE_REMINDER', 'GATE_SATISFIED', 'APPROVED', 'START', 'OFFER_REPLY');

-- CreateEnum
CREATE TYPE "OutboundKind" AS ENUM ('WELCOME', 'GATE_REMINDER', 'ACCEPTED', 'OFFER_REPLY', 'BROADCAST', 'AUTOMATION', 'TEST');

-- CreateEnum
CREATE TYPE "OutboundStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "AffiliateSource" AS ENUM ('LINKAFFI', 'CSV', 'API');

-- CreateEnum
CREATE TYPE "PlayerEventType" AS ENUM ('CLICK', 'REGISTRATION', 'FTD', 'DEPOSIT', 'REDEPOSIT', 'NGR', 'OTHER');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED');

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "anonymizedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'REQUESTED',
    "inviteLinkId" TEXT,
    "approvalRuleId" TEXT,
    "userChatId" BIGINT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gateSatisfiedAt" TIMESTAMP(3),
    "approveAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "approvedByBotId" TEXT,
    "source" JSONB NOT NULL DEFAULT '{}',
    "remindersSent" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRule" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "inviteLinkId" TEXT,
    "mode" "ApprovalMode" NOT NULL DEFAULT 'DELAY',
    "delaySeconds" INTEGER NOT NULL DEFAULT 0,
    "gateChannelIds" JSONB NOT NULL DEFAULT '[]',
    "gateMode" "GateMode" NOT NULL DEFAULT 'NONE',
    "reminderAfterMinutes" JSONB NOT NULL DEFAULT '[60, 1440]',
    "maxReminders" INTEGER NOT NULL DEFAULT 2,
    "expireAfterHours" INTEGER,
    "expireAction" "ExpireAction" NOT NULL DEFAULT 'KEEP',
    "sendAcceptedMessage" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InviteLink" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "telegramInviteLink" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "InviteLinkKind" NOT NULL DEFAULT 'AD_ENTRY',
    "createsJoinRequest" BOOLEAN NOT NULL DEFAULT true,
    "campaignId" TEXT,
    "adPlatform" "AdPlatform",
    "adCampaignName" TEXT,
    "adSetName" TEXT,
    "adName" TEXT,
    "adExternalIds" JSONB,
    "sourceChannelId" TEXT,
    "language" TEXT NOT NULL DEFAULT 'fr',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "approved" INTEGER NOT NULL DEFAULT 0,
    "joined" INTEGER NOT NULL DEFAULT 0,
    "left" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InviteLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingLink" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "TrackingLinkKind" NOT NULL DEFAULT 'GENERIC',
    "destinationTemplate" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "inviteLinkId" TEXT,
    "channelId" TEXT,
    "campaignId" TEXT,
    "affiliateCampaignId" TEXT,
    "postId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "uniqueClicks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackingLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Click" (
    "id" TEXT NOT NULL,
    "trackingLinkId" TEXT NOT NULL,
    "subId" TEXT,
    "memberId" TEXT,
    "postId" TEXT,
    "botId" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "referer" TEXT,
    "country" TEXT,
    "ttclid" TEXT,
    "fbclid" TEXT,
    "gclid" TEXT,
    "utm" JSONB,
    "destination" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Click_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "vertical" "Vertical",
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "duration" INTEGER,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAssetTelegramFile" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "telegramFileId" TEXT NOT NULL,
    "fileUniqueId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAssetTelegramFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "status" "PostStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "telegramMessageIds" JSONB NOT NULL DEFAULT '[]',
    "categoryId" TEXT,
    "language" TEXT NOT NULL DEFAULT 'fr',
    "text" TEXT NOT NULL DEFAULT '',
    "mediaAssetIds" JSONB NOT NULL DEFAULT '[]',
    "buttons" JSONB NOT NULL DEFAULT '[]',
    "pinAfterSend" BOOLEAN NOT NULL DEFAULT false,
    "unpinPrevious" BOOLEAN NOT NULL DEFAULT false,
    "deleteAfterMinutes" INTEGER,
    "disableNotification" BOOLEAN NOT NULL DEFAULT false,
    "protectContent" BOOLEAN NOT NULL DEFAULT false,
    "disableLinkPreview" BOOLEAN NOT NULL DEFAULT true,
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "templateName" TEXT,
    "lastError" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "updatedById" TEXT,
    "duplicatedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostStats" (
    "postId" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "forwards" INTEGER NOT NULL DEFAULT 0,
    "reactions" JSONB NOT NULL DEFAULT '{}',
    "reactionsTotal" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "uniqueClickers" INTEGER NOT NULL DEFAULT 0,
    "offerClicks" INTEGER NOT NULL DEFAULT 0,
    "registrations" INTEGER NOT NULL DEFAULT 0,
    "ftds" INTEGER NOT NULL DEFAULT 0,
    "deposits" INTEGER NOT NULL DEFAULT 0,
    "depositAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostStats_pkey" PRIMARY KEY ("postId")
);

-- CreateTable
CREATE TABLE "Sequence" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "botId" TEXT,
    "channelId" TEXT,
    "trigger" "SequenceTrigger" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SequenceStep" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "delaySeconds" INTEGER NOT NULL DEFAULT 0,
    "texts" JSONB NOT NULL DEFAULT '{}',
    "buttons" JSONB NOT NULL DEFAULT '[]',
    "mediaAssetId" TEXT,

    CONSTRAINT "SequenceStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundMessage" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "kind" "OutboundKind" NOT NULL,
    "sequenceStepId" TEXT,
    "postId" TEXT,
    "chatId" BIGINT,
    "text" TEXT NOT NULL,
    "buttons" JSONB NOT NULL DEFAULT '[]',
    "status" "OutboundStatus" NOT NULL DEFAULT 'QUEUED',
    "telegramMessageId" INTEGER,
    "error" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateProgram" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vertical" "Vertical",
    "source" "AffiliateSource" NOT NULL DEFAULT 'LINKAFFI',
    "externalId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateCampaign" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "campaignKey" TEXT,
    "name" TEXT NOT NULL,
    "vertical" "Vertical",
    "trackingUrlTemplate" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "affiliateCampaignId" TEXT NOT NULL,
    "externalPlayerId" TEXT NOT NULL,
    "subId" TEXT,
    "clickId" TEXT,
    "memberId" TEXT,
    "registeredAt" TIMESTAMP(3),
    "ftdAt" TIMESTAMP(3),
    "ftdAmount" DECIMAL(14,2),
    "depositCount" INTEGER NOT NULL DEFAULT 0,
    "redepositCount" INTEGER NOT NULL DEFAULT 0,
    "depositTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "ngr" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "status" TEXT,
    "lastEventAt" TIMESTAMP(3),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerEvent" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "type" "PlayerEventType" NOT NULL,
    "amount" DECIMAL(14,2),
    "currency" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "externalId" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncState" (
    "source" TEXT NOT NULL,
    "cursor" JSONB NOT NULL DEFAULT '{}',
    "lastRunAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "rowsImported" INTEGER NOT NULL DEFAULT 0,
    "isRunning" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncState_pkey" PRIMARY KEY ("source")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vertical" "Vertical",
    "channelIds" JSONB NOT NULL DEFAULT '[]',
    "affiliateCampaignIds" JSONB NOT NULL DEFAULT '[]',
    "adPlatform" "AdPlatform",
    "adExternalIds" JSONB,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberNote" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "authorId" TEXT,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Membership_code_key" ON "Membership"("code");

-- CreateIndex
CREATE INDEX "Membership_channelId_status_idx" ON "Membership"("channelId", "status");

-- CreateIndex
CREATE INDEX "Membership_status_approveAt_idx" ON "Membership"("status", "approveAt");

-- CreateIndex
CREATE INDEX "Membership_status_expiresAt_idx" ON "Membership"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Membership_memberId_channelId_idx" ON "Membership"("memberId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_memberId_channelId_requestedAt_key" ON "Membership"("memberId", "channelId", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRule_inviteLinkId_key" ON "ApprovalRule"("inviteLinkId");

-- CreateIndex
CREATE INDEX "ApprovalRule_channelId_isDefault_idx" ON "ApprovalRule"("channelId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "InviteLink_telegramInviteLink_key" ON "InviteLink"("telegramInviteLink");

-- CreateIndex
CREATE INDEX "InviteLink_channelId_kind_idx" ON "InviteLink"("channelId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingLink_slug_key" ON "TrackingLink"("slug");

-- CreateIndex
CREATE INDEX "TrackingLink_kind_isActive_idx" ON "TrackingLink"("kind", "isActive");

-- CreateIndex
CREATE INDEX "TrackingLink_postId_idx" ON "TrackingLink"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "Click_subId_key" ON "Click"("subId");

-- CreateIndex
CREATE INDEX "Click_memberId_createdAt_idx" ON "Click"("memberId", "createdAt");

-- CreateIndex
CREATE INDEX "Click_trackingLinkId_createdAt_idx" ON "Click"("trackingLinkId", "createdAt");

-- CreateIndex
CREATE INDEX "Click_postId_createdAt_idx" ON "Click"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "Click_ipHash_userAgent_trackingLinkId_createdAt_idx" ON "Click"("ipHash", "userAgent", "trackingLinkId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MessageCategory_slug_key" ON "MessageCategory"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_sha256_key" ON "MediaAsset"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAssetTelegramFile_assetId_botId_key" ON "MediaAssetTelegramFile"("assetId", "botId");

-- CreateIndex
CREATE UNIQUE INDEX "Post_code_key" ON "Post"("code");

-- CreateIndex
CREATE INDEX "Post_channelId_scheduledAt_idx" ON "Post"("channelId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Post_status_scheduledAt_idx" ON "Post"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Sequence_channelId_trigger_idx" ON "Sequence"("channelId", "trigger");

-- CreateIndex
CREATE INDEX "SequenceStep_sequenceId_order_idx" ON "SequenceStep"("sequenceId", "order");

-- CreateIndex
CREATE INDEX "OutboundMessage_memberId_queuedAt_idx" ON "OutboundMessage"("memberId", "queuedAt");

-- CreateIndex
CREATE INDEX "OutboundMessage_status_queuedAt_idx" ON "OutboundMessage"("status", "queuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateProgram_source_externalId_key" ON "AffiliateProgram"("source", "externalId");

-- CreateIndex
CREATE INDEX "AffiliateCampaign_campaignKey_idx" ON "AffiliateCampaign"("campaignKey");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateCampaign_programId_externalId_key" ON "AffiliateCampaign"("programId", "externalId");

-- CreateIndex
CREATE INDEX "Player_subId_idx" ON "Player"("subId");

-- CreateIndex
CREATE INDEX "Player_memberId_idx" ON "Player"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "Player_affiliateCampaignId_externalPlayerId_key" ON "Player"("affiliateCampaignId", "externalPlayerId");

-- CreateIndex
CREATE INDEX "PlayerEvent_playerId_occurredAt_idx" ON "PlayerEvent"("playerId", "occurredAt");

-- CreateIndex
CREATE INDEX "PlayerEvent_type_occurredAt_idx" ON "PlayerEvent"("type", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerEvent_playerId_externalId_key" ON "PlayerEvent"("playerId", "externalId");

-- CreateIndex
CREATE INDEX "MemberNote_memberId_createdAt_idx" ON "MemberNote"("memberId", "createdAt");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_inviteLinkId_fkey" FOREIGN KEY ("inviteLinkId") REFERENCES "InviteLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_approvalRuleId_fkey" FOREIGN KEY ("approvalRuleId") REFERENCES "ApprovalRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_approvedByBotId_fkey" FOREIGN KEY ("approvedByBotId") REFERENCES "Bot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRule" ADD CONSTRAINT "ApprovalRule_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRule" ADD CONSTRAINT "ApprovalRule_inviteLinkId_fkey" FOREIGN KEY ("inviteLinkId") REFERENCES "InviteLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InviteLink" ADD CONSTRAINT "InviteLink_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InviteLink" ADD CONSTRAINT "InviteLink_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InviteLink" ADD CONSTRAINT "InviteLink_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InviteLink" ADD CONSTRAINT "InviteLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingLink" ADD CONSTRAINT "TrackingLink_inviteLinkId_fkey" FOREIGN KEY ("inviteLinkId") REFERENCES "InviteLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingLink" ADD CONSTRAINT "TrackingLink_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingLink" ADD CONSTRAINT "TrackingLink_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingLink" ADD CONSTRAINT "TrackingLink_affiliateCampaignId_fkey" FOREIGN KEY ("affiliateCampaignId") REFERENCES "AffiliateCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingLink" ADD CONSTRAINT "TrackingLink_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingLink" ADD CONSTRAINT "TrackingLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Click" ADD CONSTRAINT "Click_trackingLinkId_fkey" FOREIGN KEY ("trackingLinkId") REFERENCES "TrackingLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Click" ADD CONSTRAINT "Click_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Click" ADD CONSTRAINT "Click_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Click" ADD CONSTRAINT "Click_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAssetTelegramFile" ADD CONSTRAINT "MediaAssetTelegramFile_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAssetTelegramFile" ADD CONSTRAINT "MediaAssetTelegramFile_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MessageCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_duplicatedFromId_fkey" FOREIGN KEY ("duplicatedFromId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostStats" ADD CONSTRAINT "PostStats_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_sequenceStepId_fkey" FOREIGN KEY ("sequenceStepId") REFERENCES "SequenceStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateCampaign" ADD CONSTRAINT "AffiliateCampaign_programId_fkey" FOREIGN KEY ("programId") REFERENCES "AffiliateProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_affiliateCampaignId_fkey" FOREIGN KEY ("affiliateCampaignId") REFERENCES "AffiliateCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_clickId_fkey" FOREIGN KEY ("clickId") REFERENCES "Click"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerEvent" ADD CONSTRAINT "PlayerEvent_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberNote" ADD CONSTRAINT "MemberNote_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberNote" ADD CONSTRAINT "MemberNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

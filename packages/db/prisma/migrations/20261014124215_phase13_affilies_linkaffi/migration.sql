-- Phase 13 (14 octobre 2026) : campagnes Telegram des affiliés Link Affi (docs/LINKAFFI-PARTENAIRES.md).
-- Migration additive : une énumération, trois valeurs d'énumération, des colonnes facultatives, deux tables, des index et
-- une clé étrangère ON DELETE SET NULL. L'index unique (linkaffiCampaignKey, channelId) porte sur une colonne nouvelle,
-- vide pour tous les liens existants (NULL n'entre pas en conflit) : il ne peut pas échouer sur les données de production.
-- PostgreSQL ≥ 12 accepte plusieurs ADD VALUE dans la transaction de la migration tant que les valeurs n'y servent pas.

-- CreateEnum
CREATE TYPE "LinkaffiEventStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- AlterEnum


ALTER TYPE "ApprovalSourceKind" ADD VALUE 'LINKAFFI_ANY';
ALTER TYPE "ApprovalSourceKind" ADD VALUE 'LINKAFFI_AFFILIATE';

-- AlterEnum
ALTER TYPE "InviteLinkKind" ADD VALUE 'LINKAFFI';

-- AlterTable
ALTER TABLE "ApprovalRule" ADD COLUMN     "linkaffiAffiliateId" TEXT;

-- AlterTable
ALTER TABLE "Click" ADD COLUMN     "linkaffiTelegramCampaignKey" TEXT;

-- AlterTable
ALTER TABLE "InviteLink" ADD COLUMN     "attributionDays" INTEGER,
ADD COLUMN     "linkaffiAffiliateId" TEXT,
ADD COLUMN     "linkaffiAffiliateName" TEXT,
ADD COLUMN     "linkaffiCampaignKey" TEXT,
ADD COLUMN     "linkaffiCampaignName" TEXT;

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "affiliateAttributedAt" TIMESTAMP(3),
ADD COLUMN     "affiliateAttributionEndsAt" TIMESTAMP(3),
ADD COLUMN     "affiliateInviteLinkId" TEXT,
ADD COLUMN     "linkaffiAffiliateId" TEXT,
ADD COLUMN     "linkaffiCampaignKey" TEXT;

-- CreateTable
CREATE TABLE "LinkaffiEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "campaignKey" TEXT NOT NULL,
    "memberId" TEXT,
    "channelId" TEXT,
    "body" JSONB NOT NULL,
    "status" "LinkaffiEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "lastStatus" INTEGER,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinkaffiEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationKey" (
    "provider" TEXT NOT NULL,
    "apiKeyHash" TEXT,
    "apiKeyPrefix" TEXT,
    "apiKeyCreatedAt" TIMESTAMP(3),
    "apiKeyCreatedById" TEXT,
    "webhookSecretEncrypted" TEXT,
    "webhookSecretCreatedAt" TIMESTAMP(3),
    "eventsUrl" TEXT,
    "lastApiCallAt" TIMESTAMP(3),
    "lastEventSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationKey_pkey" PRIMARY KEY ("provider")
);

-- CreateIndex
CREATE UNIQUE INDEX "LinkaffiEvent_eventId_key" ON "LinkaffiEvent"("eventId");

-- CreateIndex
CREATE INDEX "LinkaffiEvent_status_nextAttemptAt_idx" ON "LinkaffiEvent"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "LinkaffiEvent_campaignKey_occurredAt_idx" ON "LinkaffiEvent"("campaignKey", "occurredAt");

-- CreateIndex
CREATE INDEX "LinkaffiEvent_memberId_idx" ON "LinkaffiEvent"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationKey_apiKeyHash_key" ON "IntegrationKey"("apiKeyHash");

-- CreateIndex
CREATE INDEX "Click_linkaffiTelegramCampaignKey_idx" ON "Click"("linkaffiTelegramCampaignKey");

-- CreateIndex
CREATE INDEX "InviteLink_linkaffiAffiliateId_idx" ON "InviteLink"("linkaffiAffiliateId");

-- CreateIndex
CREATE UNIQUE INDEX "InviteLink_linkaffiCampaignKey_channelId_key" ON "InviteLink"("linkaffiCampaignKey", "channelId");

-- CreateIndex
CREATE INDEX "Member_linkaffiAffiliateId_idx" ON "Member"("linkaffiAffiliateId");

-- CreateIndex
CREATE INDEX "Member_linkaffiCampaignKey_idx" ON "Member"("linkaffiCampaignKey");

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_affiliateInviteLinkId_fkey" FOREIGN KEY ("affiliateInviteLinkId") REFERENCES "InviteLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;


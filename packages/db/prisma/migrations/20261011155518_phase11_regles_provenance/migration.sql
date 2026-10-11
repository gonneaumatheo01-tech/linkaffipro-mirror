-- Phase 11 (11 octobre 2026) : règles d'acceptation selon la provenance, liens de partage.
-- Migration additive : deux énumérations, une valeur d'énumération, des colonnes facultatives ou avec défaut, un index.
-- Les règles existantes deviennent `scope = DEFAULT`, ou `INVITE_LINK` si elles portent un lien précis : même
-- comportement qu'avant (la résolution lit d'abord la règle du lien, puis la règle par défaut du canal).
-- PostgreSQL ≥ 12 accepte ADD VALUE dans la transaction de la migration tant que la valeur n'y est pas utilisée.

-- CreateEnum
CREATE TYPE "ApprovalRuleScope" AS ENUM ('DEFAULT', 'INVITE_LINK', 'SOURCE_CHANNEL', 'SOURCE_KIND');

-- CreateEnum
CREATE TYPE "ApprovalSourceKind" AS ENUM ('GATE', 'ANY_CHANNEL', 'AD_ANY', 'AD_TIKTOK', 'AD_META', 'SHARE');

-- AlterEnum
ALTER TYPE "InviteLinkKind" ADD VALUE 'SHARE';

-- AlterTable
ALTER TABLE "ApprovalRule" ADD COLUMN "label" TEXT,
ADD COLUMN "scope" "ApprovalRuleScope" NOT NULL DEFAULT 'DEFAULT',
ADD COLUMN "sendWelcome" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "sourceChannelId" TEXT,
ADD COLUMN "sourceKind" "ApprovalSourceKind";

-- Règles d'un lien précis (créées avant la phase 11) : portée INVITE_LINK.
UPDATE "ApprovalRule" SET "scope" = 'INVITE_LINK' WHERE "inviteLinkId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "ApprovalRule_channelId_scope_isActive_idx" ON "ApprovalRule"("channelId", "scope", "isActive");

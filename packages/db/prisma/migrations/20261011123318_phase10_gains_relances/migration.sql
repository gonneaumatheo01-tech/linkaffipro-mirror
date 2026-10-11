-- Phase 10 : gains (nos commissions − dépense pub) et relances attribuables.
-- Migration ADDITIVE : valeurs d'énumération, colonnes facultatives ou avec défaut, une table, des index et des clés
-- étrangères ON DELETE SET NULL. Aucune donnée existante n'est modifiée ni supprimée.
-- - PlayerEventType : CPA (commission CPA créditée, montant positif, datée cpa_credited_at) et CPA_REVERSAL (annulation,
--   montant négatif, datée cpa_reversed_at). PostgreSQL ≥ 12 accepte plusieurs ADD VALUE dans une même migration tant
--   que les nouvelles valeurs n'y sont pas utilisées (c'est le cas ici).
-- - Player : cpaStatus, cpaAmount (part affilié, EUR), cpaCreditedAt, cpaReversedAt (copie de players.cpa_*).
-- - AffiliateDailyStat : une ligne par ligne de la table Link Affi `stats` (clé externalId = stats.id), source de la part
--   de revshare ; à additionner par (date, affiliateCampaignId).
-- - DailyStat : commissions = cpaCommissions + revshareCommissions (EUR, défaut 0). Gains = commissions − spend.
-- - TrackingLink.automationRuleId / OutboundMessage.automationRuleId : bouton et message envoyés par une relance.

-- AlterEnum
ALTER TYPE "PlayerEventType" ADD VALUE 'CPA';
ALTER TYPE "PlayerEventType" ADD VALUE 'CPA_REVERSAL';

-- AlterTable
ALTER TABLE "DailyStat" ADD COLUMN     "commissions" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "cpaCommissions" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "revshareCommissions" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "OutboundMessage" ADD COLUMN     "automationRuleId" TEXT;

-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "cpaAmount" DECIMAL(14,2),
ADD COLUMN     "cpaCreditedAt" TIMESTAMP(3),
ADD COLUMN     "cpaReversedAt" TIMESTAMP(3),
ADD COLUMN     "cpaStatus" TEXT;

-- AlterTable
ALTER TABLE "TrackingLink" ADD COLUMN     "automationRuleId" TEXT;

-- CreateTable
CREATE TABLE "AffiliateDailyStat" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "affiliateCampaignId" TEXT,
    "campaignExternalId" TEXT,
    "programId" TEXT,
    "programExternalId" TEXT,
    "affiliateExternalId" TEXT,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "signups" INTEGER NOT NULL DEFAULT 0,
    "deposits" INTEGER NOT NULL DEFAULT 0,
    "depositAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "revenue" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "cpaRevenue" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "revshareRevenue" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "sourceCreatedAt" TIMESTAMP(3),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateDailyStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateDailyStat_externalId_key" ON "AffiliateDailyStat"("externalId");

-- CreateIndex
CREATE INDEX "AffiliateDailyStat_date_idx" ON "AffiliateDailyStat"("date");

-- CreateIndex
CREATE INDEX "AffiliateDailyStat_affiliateCampaignId_date_idx" ON "AffiliateDailyStat"("affiliateCampaignId", "date");

-- CreateIndex
CREATE INDEX "AffiliateDailyStat_programId_date_idx" ON "AffiliateDailyStat"("programId", "date");

-- CreateIndex
CREATE INDEX "OutboundMessage_automationRuleId_status_idx" ON "OutboundMessage"("automationRuleId", "status");

-- CreateIndex
CREATE INDEX "Player_cpaCreditedAt_idx" ON "Player"("cpaCreditedAt");

-- CreateIndex
CREATE INDEX "Player_cpaReversedAt_idx" ON "Player"("cpaReversedAt");

-- CreateIndex
CREATE INDEX "TrackingLink_automationRuleId_idx" ON "TrackingLink"("automationRuleId");

-- AddForeignKey
ALTER TABLE "TrackingLink" ADD CONSTRAINT "TrackingLink_automationRuleId_fkey" FOREIGN KEY ("automationRuleId") REFERENCES "AutomationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_automationRuleId_fkey" FOREIGN KEY ("automationRuleId") REFERENCES "AutomationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateDailyStat" ADD CONSTRAINT "AffiliateDailyStat_affiliateCampaignId_fkey" FOREIGN KEY ("affiliateCampaignId") REFERENCES "AffiliateCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateDailyStat" ADD CONSTRAINT "AffiliateDailyStat_programId_fkey" FOREIGN KEY ("programId") REFERENCES "AffiliateProgram"("id") ON DELETE SET NULL ON UPDATE CASCADE;


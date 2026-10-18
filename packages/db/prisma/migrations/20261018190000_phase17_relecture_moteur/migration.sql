-- Phase 17, relecture du moteur de l'assistant de conversation (additive).
-- 1. ConversationMessage.claimedAt : heure de réclamation d'un message reçu par un tour en cours (index : le balayage des
--    tours bloqués ne lit plus toute la table toutes les 30 s).
-- 2. AiConversationUsage.source : copie de la source de la conversation (le coût de l'IA reste rattaché à sa source
--    après la suppression d'une conversation, comme les liens d'offre).

-- AlterTable
ALTER TABLE "ConversationMessage" ADD COLUMN     "claimedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AiConversationUsage" ADD COLUMN     "source" TEXT;

-- CreateIndex
CREATE INDEX "ConversationMessage_claimedAt_idx" ON "ConversationMessage"("claimedAt");

-- Reprise : messages réclamés par un tour pas encore terminé (heure de réception à défaut d'heure de réclamation),
-- et source des coûts déjà enregistrés.
UPDATE "ConversationMessage" SET "claimedAt" = "createdAt"
 WHERE "direction" = 'IN' AND "turnId" IS NOT NULL AND ("meta" ->> 'turnDone') IS NULL;
UPDATE "AiConversationUsage" u SET "source" = c."source"
  FROM "Conversation" c
 WHERE u."conversationId" = c."id" AND u."source" IS NULL AND c."source" IS NOT NULL;

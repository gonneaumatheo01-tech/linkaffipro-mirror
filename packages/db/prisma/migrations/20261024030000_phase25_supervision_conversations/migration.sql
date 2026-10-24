-- Phase 25 : univers et fiche d'informations des personas, conversations « à traiter ». Migration additive.
-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "needsHumanAt" TIMESTAMP(3),
ADD COLUMN     "needsHumanReason" TEXT;

-- AlterTable
ALTER TABLE "Persona" ADD COLUMN     "faq" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "universe" TEXT NOT NULL DEFAULT 'dating';

-- CreateIndex
CREATE INDEX "Conversation_needsHumanAt_idx" ON "Conversation"("needsHumanAt");


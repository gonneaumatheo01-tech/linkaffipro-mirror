-- Phase 24 : Agent Ads. Migration additive : statut DONE des recommandations, action, commentaire et date « fait ».
-- AlterEnum
ALTER TYPE "RecommendationStatus" ADD VALUE 'DONE';

-- AlterTable
ALTER TABLE "Recommendation" ADD COLUMN     "action" TEXT,
ADD COLUMN     "comment" TEXT,
ADD COLUMN     "doneAt" TIMESTAMP(3),
ADD COLUMN     "doneById" TEXT;


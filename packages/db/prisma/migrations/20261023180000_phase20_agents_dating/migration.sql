-- Phase 20 : équipe Dating des agents. Migration additive : médias du personnage sur Persona, origine des médias
-- produits par un fournisseur sur MediaAsset.
-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "providerJobId" TEXT,
ADD COLUMN     "providerName" TEXT,
ADD COLUMN     "resolution" TEXT,
ADD COLUMN     "sourceAssetId" TEXT;

-- AlterTable
ALTER TABLE "Persona" ADD COLUMN     "loraScale" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
ADD COLUMN     "loraTrigger" TEXT,
ADD COLUMN     "loraUrl" TEXT,
ADD COLUMN     "mediaNotes" TEXT,
ADD COLUMN     "referenceImageIds" JSONB NOT NULL DEFAULT '[]';

-- CreateIndex
CREATE INDEX "MediaAsset_personaId_kind_idx" ON "MediaAsset"("personaId", "kind");


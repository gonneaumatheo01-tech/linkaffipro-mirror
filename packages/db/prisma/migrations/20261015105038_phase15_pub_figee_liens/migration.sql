-- Phase 15 (correction D9) : la pub d'un lien de page d'atterrissage est figée à la création du lien
-- (`InviteLink.landingAdId`), et la reprise des liens manquants passe chaque page à son tour (`LandingSource.linkTriedAt`).

-- AlterTable
ALTER TABLE "InviteLink" ADD COLUMN     "landingAdId" TEXT;

-- AlterTable
ALTER TABLE "LandingSource" ADD COLUMN     "linkTriedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "InviteLink_landingAdId_idx" ON "InviteLink"("landingAdId");

-- AddForeignKey
ALTER TABLE "InviteLink" ADD CONSTRAINT "InviteLink_landingAdId_fkey" FOREIGN KEY ("landingAdId") REFERENCES "Ad"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Reprise : le lien actuel d'une source reliée à une pub est celui de cette pub (aucun ancien lien n'est rattaché après
-- coup à une pub).
UPDATE "InviteLink" AS l SET "landingAdId" = s."adId" FROM "LandingSource" AS s WHERE s."inviteLinkId" = l."id" AND l."kind" = 'LANDING' AND s."adId" IS NOT NULL AND l."landingAdId" IS NULL;

-- CreateTable: PersonaBookmaker
-- Lie une persona à plusieurs bookmakers avec leur campagne d'affiliation et lien d'invitation VIP.
-- Utilisé par le bot VIP paris sportifs pour proposer les books dans l'ordre (Celsius → Bet Portal → Sportaza).

CREATE TABLE "PersonaBookmaker" (
    "id" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "bookmakerKey" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "affiliateCampaignId" TEXT,
    "inviteLinkId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonaBookmaker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PersonaBookmaker_personaId_bookmakerKey_key" ON "PersonaBookmaker"("personaId", "bookmakerKey");
CREATE INDEX "PersonaBookmaker_personaId_idx" ON "PersonaBookmaker"("personaId");

-- AddForeignKey
ALTER TABLE "PersonaBookmaker" ADD CONSTRAINT "PersonaBookmaker_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonaBookmaker" ADD CONSTRAINT "PersonaBookmaker_affiliateCampaignId_fkey" FOREIGN KEY ("affiliateCampaignId") REFERENCES "AffiliateCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PersonaBookmaker" ADD CONSTRAINT "PersonaBookmaker_inviteLinkId_fkey" FOREIGN KEY ("inviteLinkId") REFERENCES "InviteLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

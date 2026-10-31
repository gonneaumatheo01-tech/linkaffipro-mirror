-- CreateTable
CREATE TABLE "PersonaFlirtMedia" (
    "id" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "assetId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonaFlirtMedia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonaFlirtMedia_personaId_idx" ON "PersonaFlirtMedia"("personaId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonaFlirtMedia_personaId_slot_key" ON "PersonaFlirtMedia"("personaId", "slot");

-- AddForeignKey
ALTER TABLE "PersonaFlirtMedia" ADD CONSTRAINT "PersonaFlirtMedia_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonaFlirtMedia" ADD CONSTRAINT "PersonaFlirtMedia_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

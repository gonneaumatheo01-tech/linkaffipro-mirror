-- Phase 18 : identité de la persona (assistante du canal ou fille), ajout sans effet sur les personas existantes.
ALTER TABLE "Persona" ADD COLUMN "identityKind" TEXT NOT NULL DEFAULT 'ASSISTANT';
ALTER TABLE "Persona" ADD COLUMN "age" INTEGER;

-- Phase 18 : mode illusion de la persona (GIRL seulement), ajout sans effet sur les personas existantes.
ALTER TABLE "Persona" ADD COLUMN "illusion" BOOLEAN NOT NULL DEFAULT false;

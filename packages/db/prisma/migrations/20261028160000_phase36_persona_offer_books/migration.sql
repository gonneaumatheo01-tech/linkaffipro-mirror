-- Phase 36 : champ offerBooks sur Persona pour l'architecture multi-bookmakers.
-- JSON array d'objets { key, label, affiliateCampaignId, vipChannelLink, offerButtonText }.
-- Défaut : tableau vide (personas existantes gardent le comportement mono-offre).
ALTER TABLE "Persona" ADD COLUMN "offerBooks" JSONB NOT NULL DEFAULT '[]';

-- Délai de réponse réglable par persona (min/max en secondes).
ALTER TABLE "Persona" ADD COLUMN "responseDelayMinSec" INTEGER;
ALTER TABLE "Persona" ADD COLUMN "responseDelayMaxSec" INTEGER;

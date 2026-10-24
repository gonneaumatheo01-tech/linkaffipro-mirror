-- Phase 25 (relecture) : une seule demande au client « en cours » à la fois, garantie par la base (le site et le
-- worker peuvent réserver en même temps). Index unique partiel : une seconde ligne PENDING est refusée (P2002).
-- Avant de créer l'index, les éventuels doublons déjà en cours repassent en file (on garde la plus ancienne).
UPDATE "HumanRequest" SET "status" = 'QUEUED'
WHERE "status" = 'PENDING'
  AND "id" <> (SELECT "id" FROM "HumanRequest" WHERE "status" = 'PENDING' ORDER BY "askedAt" ASC NULLS LAST, "createdAt" ASC LIMIT 1);
CREATE UNIQUE INDEX "HumanRequest_one_pending" ON "HumanRequest" ((true)) WHERE "status" = 'PENDING';

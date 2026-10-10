-- Phase 8 : une seule séquence par canal et par déclencheur.
-- Plusieurs bots administrateurs d'un même canal recevaient la première mise à jour en même temps et créaient
-- chacun les séquences par défaut. On dédoublonne puis on pose l'unicité (channelId, trigger).
-- Les séquences globales (channelId vide) ne sont pas concernées : PostgreSQL traite les NULL comme distincts.

-- 1. La séquence gardée est la plus ancienne de chaque (canal, déclencheur). Si elle n'a aucune étape,
--    elle reprend les étapes du plus ancien doublon qui en a (rien n'est perdu).
WITH ranked AS (
  SELECT "id", "createdAt",
         row_number() OVER (PARTITION BY "channelId", "trigger" ORDER BY "createdAt", "id") AS rn,
         first_value("id") OVER (PARTITION BY "channelId", "trigger" ORDER BY "createdAt", "id") AS keep_id
  FROM "Sequence"
  WHERE "channelId" IS NOT NULL
),
donor AS (
  SELECT DISTINCT ON (r.keep_id) r.keep_id, r."id" AS donor_id
  FROM ranked r
  WHERE r.rn > 1
    AND EXISTS (SELECT 1 FROM "SequenceStep" st WHERE st."sequenceId" = r."id")
    AND NOT EXISTS (SELECT 1 FROM "SequenceStep" st WHERE st."sequenceId" = r.keep_id)
  ORDER BY r.keep_id, r."createdAt", r."id"
)
UPDATE "SequenceStep" st
SET "sequenceId" = donor.keep_id
FROM donor
WHERE st."sequenceId" = donor.donor_id;

-- 2. Suppression des doublons (leurs étapes restantes partent avec eux ; les messages envoyés gardent leur
--    historique, seul leur lien vers l'étape est vidé : clé étrangère ON DELETE SET NULL).
DELETE FROM "Sequence" s
USING (
  SELECT "id", row_number() OVER (PARTITION BY "channelId", "trigger" ORDER BY "createdAt", "id") AS rn
  FROM "Sequence"
  WHERE "channelId" IS NOT NULL
) d
WHERE s."id" = d."id" AND d.rn > 1;

-- 3. Unicité (remplace l'index simple sur les mêmes colonnes).
-- DropIndex
DROP INDEX "Sequence_channelId_trigger_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Sequence_channelId_trigger_key" ON "Sequence"("channelId", "trigger");

-- Phase 23 : équipe Paris sportifs (catégories de paris, paris retenus, captures). Migration additive : nouvelles
-- tables, valeurs d'énumérations ajoutées, colonne PostInsight.betResult, catégories de départ (seule la première active).
-- CreateEnum
CREATE TYPE "BettingPickStatus" AS ENUM ('PROPOSED', 'PUBLISHED', 'SKIPPED', 'WON', 'LOST', 'VOID');

-- AlterEnum
ALTER TYPE "MediaAssetKind" ADD VALUE 'SCREENSHOT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MediaAssetOrigin" ADD VALUE 'HUMAN_SITE';
ALTER TYPE "MediaAssetOrigin" ADD VALUE 'TEMPLATE';

-- AlterTable
ALTER TABLE "PostInsight" ADD COLUMN     "betResult" TEXT;

-- CreateTable
CREATE TABLE "BetCategory" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sport" TEXT NOT NULL DEFAULT 'SOCCER',
    "marketTypes" JSONB NOT NULL DEFAULT '[]',
    "leagues" JSONB NOT NULL DEFAULT '[]',
    "bookmakers" JSONB NOT NULL DEFAULT '[]',
    "minOdds" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "maxOdds" DOUBLE PRECISION NOT NULL DEFAULT 3.5,
    "picksPerDay" INTEGER NOT NULL DEFAULT 2,
    "channelIds" JSONB NOT NULL DEFAULT '[]',
    "campaignId" TEXT,
    "minMinutesBeforeKickoff" INTEGER NOT NULL DEFAULT 30,
    "maxOddsDriftPct" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BetCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BettingPick" (
    "id" TEXT NOT NULL,
    "missionId" TEXT,
    "categoryId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "homeTeam" TEXT NOT NULL,
    "awayTeam" TEXT NOT NULL,
    "league" TEXT NOT NULL,
    "kickoffAt" TIMESTAMP(3) NOT NULL,
    "marketId" TEXT NOT NULL,
    "marketLabel" TEXT NOT NULL,
    "selectionLabel" TEXT NOT NULL,
    "line" DOUBLE PRECISION,
    "bookmaker" TEXT NOT NULL,
    "odds" DOUBLE PRECISION NOT NULL,
    "consensusOdds" DOUBLE PRECISION,
    "interestScore" DOUBLE PRECISION,
    "oddsAtSend" DOUBLE PRECISION,
    "reasoning" JSONB NOT NULL DEFAULT '{}',
    "screenshotAssetId" TEXT,
    "postId" TEXT,
    "status" "BettingPickStatus" NOT NULL DEFAULT 'PROPOSED',
    "skipReason" TEXT,
    "result" JSONB,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BettingPick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BetCategory_key_key" ON "BetCategory"("key");

-- CreateIndex
CREATE INDEX "BettingPick_status_kickoffAt_idx" ON "BettingPick"("status", "kickoffAt");

-- CreateIndex
CREATE INDEX "BettingPick_categoryId_createdAt_idx" ON "BettingPick"("categoryId", "createdAt");

-- CreateIndex
CREATE INDEX "BettingPick_eventId_marketId_idx" ON "BettingPick"("eventId", "marketId");

-- AddForeignKey
ALTER TABLE "BettingPick" ADD CONSTRAINT "BettingPick_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "BetCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Catégories de départ. Les identifiants de marchés suivent le format SportsGameOdds
-- `{statID}-{statEntityID}-{periodID}-{betTypeID}-{sideID}` ; ils sont réglables dans la fiche de l'équipe et à
-- confirmer avec la vraie clé (liste des marchés : GET /markets).
INSERT INTO "BetCategory" ("id", "key", "name", "sport", "marketTypes", "leagues", "bookmakers", "minOdds", "maxOdds", "picksPerDay", "active", "sortOrder", "updatedAt") VALUES
  (gen_random_uuid()::text, 'tirs-cadres', 'Tirs cadrés', 'SOCCER', '["shots_onGoal-all-game-ou-over","shots_onGoal-home-game-ou-over","shots_onGoal-away-game-ou-over"]', '["EPL","LA_LIGA","BUNDESLIGA","IT_SERIE_A","FR_LIGUE_1"]', '["sportaza"]', 1.5, 3.5, 2, true, 1, NOW()),
  (gen_random_uuid()::text, 'corners', 'Corners', 'SOCCER', '["corners-all-game-ou-over","corners-all-game-ou-under"]', '["EPL","LA_LIGA","BUNDESLIGA","IT_SERIE_A","FR_LIGUE_1"]', '["sportaza"]', 1.5, 3.5, 2, false, 2, NOW()),
  (gen_random_uuid()::text, 'buts', 'Buts (plus / moins)', 'SOCCER', '["points-all-game-ou-over","points-all-game-ou-under"]', '["EPL","LA_LIGA","BUNDESLIGA","IT_SERIE_A","FR_LIGUE_1"]', '["sportaza"]', 1.5, 3.0, 2, false, 3, NOW()),
  (gen_random_uuid()::text, 'cartons', 'Cartons', 'SOCCER', '["cards-all-game-ou-over","cards-all-game-ou-under"]', '["EPL","LA_LIGA","BUNDESLIGA","IT_SERIE_A","FR_LIGUE_1"]', '["sportaza"]', 1.5, 3.5, 1, false, 4, NOW()),
  (gen_random_uuid()::text, 'buteur', 'Buteur', 'SOCCER', '["points-PLAYER_ID-game-yn-yes"]', '["EPL","LA_LIGA","BUNDESLIGA","IT_SERIE_A","FR_LIGUE_1"]', '["sportaza"]', 1.8, 6.0, 1, false, 5, NOW()),
  (gen_random_uuid()::text, 'resultat', 'Résultat du match', 'SOCCER', '["points-home-reg-ml3way-home","points-away-reg-ml3way-away","points-all-reg-ml3way-draw"]', '["EPL","LA_LIGA","BUNDESLIGA","IT_SERIE_A","FR_LIGUE_1"]', '["sportaza"]', 1.4, 4.0, 1, false, 6, NOW())
ON CONFLICT ("key") DO NOTHING;

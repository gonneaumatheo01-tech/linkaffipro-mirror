-- Phase 18 : objets créés en local par `db push` mais jamais migrés (comparaison schema.prisma / migrations rejouées).
-- Contenu : table AccountDm (DM de bienvenue des comptes réels) + son enum, colonnes Channel.welcomeDm*,
-- colonne Conversation.appRefusedAt, index et clés étrangères correspondants. Idempotent sur une base déjà à jour.

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "AccountDmStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "welcomeDmEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "welcomeDmAccountId" TEXT,
ADD COLUMN IF NOT EXISTS "welcomeDmDelayMinutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN IF NOT EXISTS "welcomeDmText" TEXT;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "appRefusedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AccountDm" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "channelId" TEXT,
    "membershipId" TEXT,
    "telegramUserId" BIGINT NOT NULL,
    "text" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "AccountDmStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountDm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountDm_status_dueAt_idx" ON "AccountDm"("status", "dueAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountDm_accountId_createdAt_idx" ON "AccountDm"("accountId", "createdAt");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "Channel" ADD CONSTRAINT "Channel_welcomeDmAccountId_fkey" FOREIGN KEY ("welcomeDmAccountId") REFERENCES "TelegramUserAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "AccountDm" ADD CONSTRAINT "AccountDm_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TelegramUserAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "AccountDm" ADD CONSTRAINT "AccountDm_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
CREATE TYPE "BotRole" AS ENUM ('CHANNEL', 'ADMIN');

-- AlterTable
ALTER TABLE "Bot" ADD COLUMN     "role" "BotRole" NOT NULL DEFAULT 'CHANNEL';

-- CreateTable
CREATE TABLE "BossTurn" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "actionKey" TEXT,
    "status" TEXT,
    "source" TEXT,
    "telegramMessageId" INTEGER,
    "costCents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BossTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BossUnmet" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BossUnmet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BossTurn_createdAt_idx" ON "BossTurn"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BossUnmet_key_key" ON "BossUnmet"("key");

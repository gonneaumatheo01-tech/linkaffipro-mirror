-- Phase 12 (11 octobre 2026) : emojis animés (emojis personnalisés des packs Premium Telegram).
-- Migration additive : deux énumérations, une colonne avec défaut sur Post (publisher = BOT : rien ne change pour
-- les messages existants), une table CustomEmoji (bibliothèque de l'équipe), index et clé étrangère ON DELETE SET NULL.

-- CreateEnum
CREATE TYPE "PostPublisher" AS ENUM ('BOT', 'ACCOUNT');

-- CreateEnum
CREATE TYPE "CustomEmojiSource" AS ENUM ('FORWARD', 'PACK', 'ACCOUNT');

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "publisher" "PostPublisher" NOT NULL DEFAULT 'BOT';

-- CreateTable
CREATE TABLE "CustomEmoji" (
    "id" TEXT NOT NULL,
    "customEmojiId" TEXT NOT NULL,
    "fallback" TEXT NOT NULL,
    "setName" TEXT,
    "setTitle" TEXT,
    "format" TEXT,
    "previewBytes" BYTEA,
    "previewMime" TEXT,
    "previewAt" TIMESTAMP(3),
    "previewError" TEXT,
    "source" "CustomEmojiSource" NOT NULL,
    "addedById" TEXT,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "hiddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomEmoji_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomEmoji_customEmojiId_key" ON "CustomEmoji"("customEmojiId");

-- CreateIndex
CREATE INDEX "CustomEmoji_setName_idx" ON "CustomEmoji"("setName");

-- CreateIndex
CREATE INDEX "CustomEmoji_lastUsedAt_idx" ON "CustomEmoji"("lastUsedAt");

-- CreateIndex
CREATE INDEX "CustomEmoji_hiddenAt_idx" ON "CustomEmoji"("hiddenAt");

-- AddForeignKey
ALTER TABLE "CustomEmoji" ADD CONSTRAINT "CustomEmoji_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


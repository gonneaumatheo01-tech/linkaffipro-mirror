-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "flirtStep" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "flirtTeases" INTEGER NOT NULL DEFAULT 0;

-- CreateEnum
CREATE TYPE "TeamMemberRole" AS ENUM ('ADMIN', 'MANAGER', 'MEMBER');

-- AlterTable
ALTER TABLE "AgentValidation" ADD COLUMN     "assigneeTelegramId" BIGINT;

-- AlterTable
ALTER TABLE "BossTurn" ADD COLUMN     "chatId" BIGINT,
ADD COLUMN     "fromTelegramId" BIGINT;

-- AlterTable
ALTER TABLE "HumanRequest" ADD COLUMN     "assigneeTelegramId" BIGINT,
ADD COLUMN     "chatId" BIGINT;

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "telegramUserId" BIGINT NOT NULL,
    "username" TEXT,
    "firstName" TEXT NOT NULL,
    "role" "TeamMemberRole" NOT NULL DEFAULT 'MEMBER',
    "roleLabel" TEXT,
    "responsibilities" JSONB NOT NULL DEFAULT '{}',
    "available" BOOLEAN NOT NULL DEFAULT true,
    "awayUntil" TIMESTAMP(3),
    "notes" JSONB NOT NULL DEFAULT '[]',
    "startedPrivateAt" TIMESTAMP(3),
    "introducedByTelegramId" BIGINT,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_telegramUserId_key" ON "TeamMember"("telegramUserId");

-- CreateIndex
CREATE INDEX "BossTurn_chatId_createdAt_idx" ON "BossTurn"("chatId", "createdAt");

-- CreateIndex
CREATE INDEX "BossTurn_fromTelegramId_createdAt_idx" ON "BossTurn"("fromTelegramId", "createdAt");

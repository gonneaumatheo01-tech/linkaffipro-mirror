-- CreateEnum
CREATE TYPE "ReferenceVia" AS ENUM ('WEB', 'ACCOUNT', 'FORWARDED');

-- CreateEnum
CREATE TYPE "ReferenceStatus" AS ENUM ('READING', 'READY', 'UNAVAILABLE');

-- AlterTable
ALTER TABLE "ChannelAgentPlan" ADD COLUMN     "styleProfileId" TEXT;

-- AlterTable
ALTER TABLE "Recommendation" ADD COLUMN     "referenceChannelId" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'algo';

-- CreateTable
CREATE TABLE "ReferenceChannel" (
    "id" TEXT NOT NULL,
    "username" TEXT,
    "telegramChatId" BIGINT,
    "title" TEXT,
    "via" "ReferenceVia" NOT NULL,
    "universe" TEXT NOT NULL,
    "targetChannelIds" JSONB NOT NULL DEFAULT '[]',
    "status" "ReferenceStatus" NOT NULL DEFAULT 'READING',
    "unavailableReason" TEXT,
    "accountId" TEXT,
    "addedByTelegramId" BIGINT,
    "postCount" INTEGER NOT NULL DEFAULT 0,
    "lastReadAt" TIMESTAMP(3),
    "nextReadAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferenceChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferencePost" (
    "id" TEXT NOT NULL,
    "referenceChannelId" TEXT NOT NULL,
    "externalId" INTEGER NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "via" "ReferenceVia" NOT NULL,
    "text" TEXT,
    "textPurgedAt" TIMESTAMP(3),
    "textHash" TEXT,
    "shingles" JSONB NOT NULL DEFAULT '[]',
    "length" INTEGER NOT NULL DEFAULT 0,
    "lines" INTEGER NOT NULL DEFAULT 0,
    "emojiCount" INTEGER NOT NULL DEFAULT 0,
    "mediaKind" TEXT NOT NULL DEFAULT 'text',
    "views" INTEGER,
    "hasLink" BOOLEAN NOT NULL DEFAULT false,
    "hasButton" BOOLEAN NOT NULL DEFAULT false,
    "hasPrice" BOOLEAN NOT NULL DEFAULT false,
    "hasOdds" BOOLEAN NOT NULL DEFAULT false,
    "hasVipCall" BOOLEAN NOT NULL DEFAULT false,
    "keywords" JSONB NOT NULL DEFAULT '[]',
    "features" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferencePost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StyleProfile" (
    "id" TEXT NOT NULL,
    "referenceChannelId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "universe" TEXT NOT NULL,
    "stats" JSONB NOT NULL DEFAULT '{}',
    "rules" JSONB NOT NULL DEFAULT '[]',
    "description" TEXT,
    "examples" JSONB NOT NULL DEFAULT '[]',
    "flagged" JSONB NOT NULL DEFAULT '[]',
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StyleProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReferenceChannel_status_idx" ON "ReferenceChannel"("status");

-- CreateIndex
CREATE INDEX "ReferenceChannel_username_idx" ON "ReferenceChannel"("username");

-- CreateIndex
CREATE INDEX "ReferenceChannel_telegramChatId_idx" ON "ReferenceChannel"("telegramChatId");

-- CreateIndex
CREATE INDEX "ReferencePost_referenceChannelId_postedAt_idx" ON "ReferencePost"("referenceChannelId", "postedAt");

-- CreateIndex
CREATE INDEX "ReferencePost_textPurgedAt_createdAt_idx" ON "ReferencePost"("textPurgedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReferencePost_referenceChannelId_externalId_key" ON "ReferencePost"("referenceChannelId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "StyleProfile_referenceChannelId_version_key" ON "StyleProfile"("referenceChannelId", "version");

-- CreateIndex
CREATE INDEX "Recommendation_source_referenceChannelId_idx" ON "Recommendation"("source", "referenceChannelId");

-- AddForeignKey
ALTER TABLE "ReferencePost" ADD CONSTRAINT "ReferencePost_referenceChannelId_fkey" FOREIGN KEY ("referenceChannelId") REFERENCES "ReferenceChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StyleProfile" ADD CONSTRAINT "StyleProfile_referenceChannelId_fkey" FOREIGN KEY ("referenceChannelId") REFERENCES "ReferenceChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

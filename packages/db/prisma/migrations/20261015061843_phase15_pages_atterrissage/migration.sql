-- CreateEnum
CREATE TYPE "LandingEventType" AS ENUM ('VIEW', 'CLICK', 'OPENED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ApprovalSourceKind" ADD VALUE 'LANDING_ANY';
ALTER TYPE "ApprovalSourceKind" ADD VALUE 'LANDING_PAGE';

-- AlterEnum
ALTER TYPE "InviteLinkKind" ADD VALUE 'LANDING';

-- AlterTable
ALTER TABLE "ApprovalRule" ADD COLUMN     "landingPageId" TEXT;

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "chatCheckedAt" TIMESTAMP(3),
ADD COLUMN     "photoFileUniqueId" TEXT,
ADD COLUMN     "photoSmall" BYTEA;

-- AlterTable
ALTER TABLE "InviteLink" ADD COLUMN     "landingPageId" TEXT,
ADD COLUMN     "landingSource" TEXT;

-- CreateTable
CREATE TABLE "LandingPage" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'fr',
    "headline" TEXT NOT NULL,
    "subtext" TEXT,
    "buttonText" TEXT,
    "footnote" TEXT,
    "showPhoto" BOOLEAN NOT NULL DEFAULT false,
    "cookieBanner" BOOLEAN NOT NULL DEFAULT false,
    "tiktokPixelId" TEXT,
    "metaPixelId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LandingPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandingSource" (
    "id" TEXT NOT NULL,
    "landingPageId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "inviteLinkId" TEXT,
    "linkError" TEXT,
    "adId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LandingSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandingEvent" (
    "id" TEXT NOT NULL,
    "landingPageId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL DEFAULT '',
    "rawSrc" TEXT,
    "type" "LandingEventType" NOT NULL,
    "visitId" TEXT NOT NULL,
    "os" TEXT,
    "inApp" TEXT,
    "method" TEXT,
    "country" TEXT,
    "ipHash" TEXT,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "ttclid" TEXT,
    "fbclid" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LandingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LandingPage_slug_key" ON "LandingPage"("slug");

-- CreateIndex
CREATE INDEX "LandingPage_channelId_idx" ON "LandingPage"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "LandingSource_inviteLinkId_key" ON "LandingSource"("inviteLinkId");

-- CreateIndex
CREATE INDEX "LandingSource_adId_idx" ON "LandingSource"("adId");

-- CreateIndex
CREATE UNIQUE INDEX "LandingSource_landingPageId_key_key" ON "LandingSource"("landingPageId", "key");

-- CreateIndex
CREATE INDEX "LandingEvent_landingPageId_createdAt_idx" ON "LandingEvent"("landingPageId", "createdAt");

-- CreateIndex
CREATE INDEX "LandingEvent_landingPageId_type_createdAt_idx" ON "LandingEvent"("landingPageId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "LandingEvent_visitId_idx" ON "LandingEvent"("visitId");

-- CreateIndex
CREATE INDEX "LandingEvent_createdAt_idx" ON "LandingEvent"("createdAt");

-- CreateIndex
CREATE INDEX "InviteLink_landingPageId_landingSource_idx" ON "InviteLink"("landingPageId", "landingSource");

-- AddForeignKey
ALTER TABLE "InviteLink" ADD CONSTRAINT "InviteLink_landingPageId_fkey" FOREIGN KEY ("landingPageId") REFERENCES "LandingPage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandingPage" ADD CONSTRAINT "LandingPage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandingPage" ADD CONSTRAINT "LandingPage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandingSource" ADD CONSTRAINT "LandingSource_landingPageId_fkey" FOREIGN KEY ("landingPageId") REFERENCES "LandingPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandingSource" ADD CONSTRAINT "LandingSource_inviteLinkId_fkey" FOREIGN KEY ("inviteLinkId") REFERENCES "InviteLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandingSource" ADD CONSTRAINT "LandingSource_adId_fkey" FOREIGN KEY ("adId") REFERENCES "Ad"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandingEvent" ADD CONSTRAINT "LandingEvent_landingPageId_fkey" FOREIGN KEY ("landingPageId") REFERENCES "LandingPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

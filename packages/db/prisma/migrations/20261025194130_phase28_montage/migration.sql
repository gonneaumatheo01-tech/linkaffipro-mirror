-- CreateEnum
CREATE TYPE "MontageJobStatus" AS ENUM ('PENDING', 'ANALYZING', 'PLAN_SENT', 'CUTTING', 'DRESSING', 'QC', 'PREVIEW', 'APPROVED', 'DONE', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShortFormat" AS ENUM ('VERTICAL_9_16', 'HORIZONTAL_16_9', 'SQUARE_1_1');

-- CreateEnum
CREATE TYPE "PipPosition" AS ENUM ('TOP_RIGHT', 'TOP_LEFT', 'BOTTOM_RIGHT', 'BOTTOM_LEFT', 'NONE');

-- CreateEnum
CREATE TYPE "ShortClipStatus" AS ENUM ('PLANNED', 'CUTTING', 'DRESSING', 'QC', 'QC_FAILED', 'PREVIEW_SENT', 'APPROVED', 'REJECTED', 'REDO', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MediaAssetKind" ADD VALUE 'LONG_VIDEO';
ALTER TYPE "MediaAssetKind" ADD VALUE 'SHORT';

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "storage" TEXT NOT NULL DEFAULT 'db',
ADD COLUMN     "telegramRef" JSONB;

-- CreateTable
CREATE TABLE "MontageJob" (
    "id" TEXT NOT NULL,
    "teamKey" TEXT NOT NULL DEFAULT 'montage',
    "universe" TEXT NOT NULL DEFAULT 'casino',
    "sourceAssetId" TEXT NOT NULL,
    "instructions" JSONB NOT NULL,
    "instructionsMsgId" BIGINT,
    "chatId" TEXT,
    "status" "MontageJobStatus" NOT NULL DEFAULT 'PENDING',
    "currentStep" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sourceMeta" JSONB,
    "planMsgId" BIGINT,
    "planApprovedAt" TIMESTAMP(3),
    "shortCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "MontageJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShortClip" (
    "id" TEXT NOT NULL,
    "montageJobId" TEXT NOT NULL,
    "assetId" TEXT,
    "index" INTEGER NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "description" TEXT,
    "score" INTEGER,
    "format" "ShortFormat" NOT NULL DEFAULT 'VERTICAL_9_16',
    "pipPosition" "PipPosition" NOT NULL DEFAULT 'NONE',
    "speed" DOUBLE PRECISION,
    "subtitles" BOOLEAN NOT NULL DEFAULT false,
    "subtitlesSrt" TEXT,
    "subtitlesPending" JSONB,
    "overlayText" TEXT,
    "status" "ShortClipStatus" NOT NULL DEFAULT 'PLANNED',
    "qc" JSONB,
    "compressed" BOOLEAN NOT NULL DEFAULT false,
    "previewMsgId" BIGINT,
    "clientFeedback" TEXT,
    "redoCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShortClip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MontageJob_status_updatedAt_idx" ON "MontageJob"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShortClip_montageJobId_index_key" ON "ShortClip"("montageJobId", "index");

-- AddForeignKey
ALTER TABLE "MontageJob" ADD CONSTRAINT "MontageJob_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortClip" ADD CONSTRAINT "ShortClip_montageJobId_fkey" FOREIGN KEY ("montageJobId") REFERENCES "MontageJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortClip" ADD CONSTRAINT "ShortClip_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

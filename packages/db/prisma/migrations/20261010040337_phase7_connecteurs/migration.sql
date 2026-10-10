-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'NEEDS_RECONNECT', 'DISABLED');

-- AlterTable
ALTER TABLE "AdCost" ADD COLUMN     "spendOriginal" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "connectionId" TEXT;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "viewsNextAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ConnectorApp" (
    "platform" "AdPlatform" NOT NULL,
    "clientId" TEXT NOT NULL,
    "secretEncrypted" TEXT NOT NULL,
    "extra" JSONB NOT NULL DEFAULT '{}',
    "verifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectorApp_pkey" PRIMARY KEY ("platform")
);

-- CreateTable
CREATE TABLE "AdAccountConnection" (
    "id" TEXT NOT NULL,
    "platform" "AdPlatform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "timezone" TEXT,
    "businessName" TEXT,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "tokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT,
    "connectedById" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncRows" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextFullSyncAt" TIMESTAMP(3),
    "backfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdAccountConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectorSyncRun" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "dateFrom" DATE NOT NULL,
    "dateTo" DATE NOT NULL,
    "rows" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'running',
    "error" TEXT,

    CONSTRAINT "ConnectorSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramUserSession" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "phone" TEXT NOT NULL,
    "sessionEncrypted" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_CODE',
    "phoneCodeHash" TEXT,
    "connectedById" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramUserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostViewSample" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "views" INTEGER NOT NULL DEFAULT 0,
    "forwards" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PostViewSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdAccountConnection_status_idx" ON "AdAccountConnection"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AdAccountConnection_platform_externalId_key" ON "AdAccountConnection"("platform", "externalId");

-- CreateIndex
CREATE INDEX "ConnectorSyncRun_connectionId_startedAt_idx" ON "ConnectorSyncRun"("connectionId", "startedAt");

-- CreateIndex
CREATE INDEX "PostViewSample_postId_at_idx" ON "PostViewSample"("postId", "at");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "AdAccountConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdAccountConnection" ADD CONSTRAINT "AdAccountConnection_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorSyncRun" ADD CONSTRAINT "ConnectorSyncRun_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "AdAccountConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostViewSample" ADD CONSTRAINT "PostViewSample_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

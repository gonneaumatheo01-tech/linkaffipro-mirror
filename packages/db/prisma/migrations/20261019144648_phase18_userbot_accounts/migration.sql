-- CreateTable
CREATE TABLE "TelegramUserAccount" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "sessionEncrypted" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_CODE',
    "phoneCodeHash" TEXT,
    "personaId" TEXT,
    "telegramUserId" BIGINT,
    "telegramUsername" TEXT,
    "proxyUrl" TEXT,
    "dailyCap" INTEGER NOT NULL DEFAULT 60,
    "newConversationCap" INTEGER NOT NULL DEFAULT 20,
    "warmupDay" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "lastActiveAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramUserAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramUserAccount_phone_key" ON "TelegramUserAccount"("phone");

-- CreateIndex
CREATE INDEX "TelegramUserAccount_status_idx" ON "TelegramUserAccount"("status");

-- CreateIndex
CREATE INDEX "TelegramUserAccount_isActive_idx" ON "TelegramUserAccount"("isActive");

-- AddForeignKey
ALTER TABLE "TelegramUserAccount" ADD CONSTRAINT "TelegramUserAccount_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE SET NULL ON UPDATE CASCADE;

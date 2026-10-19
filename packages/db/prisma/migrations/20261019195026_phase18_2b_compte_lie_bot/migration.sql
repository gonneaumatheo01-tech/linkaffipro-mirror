-- Phase 18 etape 2b : bot fantome portant les conversations d'un compte Telegram reel.
-- L'API bot n'est pas utilisee pour ces conversations : reception et envoi passent par MTProto.
ALTER TABLE "TelegramUserAccount" ADD COLUMN "botId" TEXT;
CREATE UNIQUE INDEX "TelegramUserAccount_botId_key" ON "TelegramUserAccount"("botId");
ALTER TABLE "TelegramUserAccount" ADD CONSTRAINT "TelegramUserAccount_botId_fkey"
  FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

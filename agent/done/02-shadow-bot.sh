#!/usr/bin/env bash
set -eu
cd "$(git rev-parse --show-toplevel)"

cat > packages/userbot/src/shadow.ts <<'TS'
/**
 * Bot fantome d'un compte Telegram REEL (phase 18, etape 2b).
 *
 * Un compte reel n'est pas un bot, mais tout l'assistant est accroche a un `botId` (conversations, liens d'offre,
 * compteurs, etats par membre). On cree donc, par compte, un `Bot` inerte : son jeton n'est jamais utilise, l'API bot
 * ne le sert jamais, et la reception comme l'envoi passent par la session MTProto tenue par apps/userbot.
 * Son `mode` reste STANDARD : le worker (qui n'agit que sur les bots ASSISTANT) ne touche pas ces conversations.
 */
import { encrypt, randomToken } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";

/** Prefixe du pseudo du bot fantome (le pseudo d'un Bot est unique). */
export const SHADOW_BOT_USERNAME_PREFIX = "userbot_";

/** Bot fantome du compte : rendu s'il existe deja, cree et rattache sinon. */
export async function ensureShadowBot(accountId: string) {
  const account = await prisma.telegramUserAccount.findUniqueOrThrow({ where: { id: accountId } });
  if (account.botId) return prisma.bot.findUniqueOrThrow({ where: { id: account.botId } });
  if (!account.telegramUserId) throw new Error("Compte non connecte : identite Telegram absente.");
  const modele = await prisma.bot.findFirst({ orderBy: { createdAt: "asc" } });
  if (!modele) throw new Error("Aucun bot existant : impossible de reprendre le vertical.");
  const bot = await prisma.bot.create({
    data: {
      name: account.label,
      username: SHADOW_BOT_USERNAME_PREFIX + account.id.slice(-12),
      telegramBotId: account.telegramUserId,
      tokenEncrypted: encrypt(SHADOW_BOT_USERNAME_PREFIX + account.id),
      vertical: modele.vertical,
      webhookSecret: randomToken(32),
    },
  });
  await prisma.telegramUserAccount.update({ where: { id: account.id }, data: { botId: bot.id } });
  return bot;
}
TS

if grep -q '"./shadow"' packages/userbot/src/index.ts; then
  echo "index.ts : export deja present"
else
  printf '\nexport * from "./shadow";\n' >> packages/userbot/src/index.ts
  echo "index.ts : export ajoute"
fi

echo "--- typecheck ---"
pnpm typecheck

echo "--- creation du bot fantome ---"
( cd apps/web && node --env-file-if-exists=../../.env.local --import tsx --input-type=module -e "
import { prisma } from '@linkaffipro/db';
import { ensureShadowBot } from '@linkaffipro/userbot';
const a = await prisma.telegramUserAccount.findFirst({ where: { status: 'ACTIVE' } });
if (!a) throw new Error('aucun compte Telegram actif en base');
const bot = await ensureShadowBot(a.id);
console.log('compte ' + a.phone + ' -> bot fantome ' + bot.id);
console.log('pseudo du bot fantome : @' + bot.username + ' | mode : ' + bot.mode);
const relu = await prisma.telegramUserAccount.findUnique({ where: { id: a.id } });
console.log('compte.botId enregistre = ' + relu.botId);
await prisma.\$disconnect();
process.exit(0);
" )

echo "ETAPE 02 OK"

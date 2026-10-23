import { prisma } from "@linkaffipro/db";
import { decrypt } from "@linkaffipro/core";
import { parseTelegramUserApi, TELEGRAM_USER_API_SETTING } from "@linkaffipro/mtproto";
import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

async function main() {
  const row = await prisma.setting.findUnique({ where: { key: TELEGRAM_USER_API_SETTING } });
  const api = parseTelegramUserApi(row?.value);
  if (!api) throw new Error("Identifiants Telegram (my.telegram.org) absents des reglages.");
  const apiHash = decrypt(api.apiHashEncrypted);
  const acc = await prisma.telegramUserAccount.findFirst({});
  if (!acc) throw new Error("Aucun compte Telegram en base.");
  const client = new TelegramClient(new StringSession(decrypt(acc.sessionEncrypted)), api.apiId, apiHash, {
    connectionRetries: 5,
  });
  await client.connect();

  const dialogs = await client.getDialogs({ limit: 300 });
  const byId = new Map<string, Api.Channel | Api.Chat>();
  for (const d of dialogs) {
    const e = (d as { entity?: unknown }).entity;
    if (e instanceof Api.Channel || e instanceof Api.Chat) byId.set(String(e.id), e);
  }
  console.log(`${byId.size} discussions vues par le userbot\n`);

  const channels = await prisma.channel.findMany({ select: { title: true, telegramChatId: true, primaryBotId: true } });
  for (const c of channels) {
    if (!c.telegramChatId) {
      console.log(`- ${c.title} : pas d'identifiant`);
      continue;
    }
    const internal = String(-Number(c.telegramChatId) - 1000000000000);
    const e = byId.get(internal);
    console.log(`- ${c.title} (${c.telegramChatId}) : ${e ? `REEL -> "${e.title}"` : "INTROUVABLE chez le userbot"}`);
  }
  await client.disconnect();
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

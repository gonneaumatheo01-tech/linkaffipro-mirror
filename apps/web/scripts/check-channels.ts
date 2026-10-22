import { prisma } from "@linkaffipro/db";
import { decrypt } from "@linkaffipro/core";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

async function main() {
  const row: any = await prisma.setting.findUnique({ where: { key: "telegram.userApi" } });
  const apiId = Number(row?.value?.apiId);
  const apiHash = decrypt(row?.value?.apiHashEncrypted);
  const acc: any = await prisma.telegramUserAccount.findFirst({});
  const client = new TelegramClient(new StringSession(decrypt(acc.sessionEncrypted)), apiId, apiHash, { connectionRetries: 5 });
  await client.connect();

  const dialogs = (await client.getDialogs({ limit: 300 })) as any[];
  const byId = new Map<string, any>();
  for (const d of dialogs) if (d.entity?.id) byId.set(String(d.entity.id), d.entity);
  console.log(`${byId.size} discussions vues par le userbot\n`);

  const channels = await prisma.channel.findMany({ select: { title: true, telegramChatId: true, primaryBotId: true } });
  for (const c of channels) {
    if (!c.telegramChatId) { console.log(`- ${c.title} : pas d'identifiant`); continue; }
    const internal = String(-Number(c.telegramChatId) - 1000000000000);
    const e = byId.get(internal);
    console.log(`- ${c.title} (${c.telegramChatId}) : ${e ? `REEL -> "${e.title}"` : "INTROUVABLE chez le userbot"}`);
  }
  await client.disconnect();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

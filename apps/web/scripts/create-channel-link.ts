import { prisma } from "@linkaffipro/db";
import { CHANNEL_BOT_WHERE } from "@linkaffipro/db/bot-selectors";
import { decrypt } from "@linkaffipro/core";

async function main() {
  const filtre = process.argv[2] ?? "";
  const canal = await prisma.channel.findFirst({
    where: filtre ? { title: { contains: filtre } } : {},
    select: { id: true, title: true, telegramChatId: true, primaryBotId: true },
  });
  if (!canal) {
    console.log("canal introuvable");
    return;
  }
  const botId =
    canal.primaryBotId ??
    (await prisma.bot.findFirst({ where: CHANNEL_BOT_WHERE, orderBy: { createdAt: "asc" }, select: { id: true } }))?.id;
  if (!botId) {
    console.log("aucun bot");
    return;
  }
  const bot = await prisma.bot.findUniqueOrThrow({
    where: { id: botId },
    select: { tokenEncrypted: true },
  });
  const token = decrypt(bot.tokenEncrypted);
  const res = await fetch(`https://api.telegram.org/bot${token}/createChatInviteLink`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: Number(canal.telegramChatId),
      creates_join_request: true,
      name: `Test local ${Date.now()}`,
    }),
  });
  const json = (await res.json()) as { ok: boolean; result?: { invite_link: string }; description?: string };
  if (!json.ok || !json.result) {
    console.log("Telegram a refuse :", json.description);
    return;
  }
  await prisma.inviteLink.create({
    data: {
      channelId: canal.id,
      botId,
      telegramInviteLink: json.result.invite_link,
      name: `Test local ${Date.now()}`,
      createsJoinRequest: true,
    },
  });
  console.log("LIEN A OUVRIR SUR TON TELEPHONE :");
  console.log(json.result.invite_link);
}

main().then(() => process.exit(0));

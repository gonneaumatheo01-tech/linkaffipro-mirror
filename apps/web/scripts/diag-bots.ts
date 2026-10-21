import { prisma } from "@linkaffipro/db";
import { decrypt } from "@linkaffipro/core";

const filtre = process.argv[2] ?? "Test Local";

async function main() {
  const canal = await prisma.channel.findFirst({
    where: { title: { contains: filtre } },
    select: { id: true, title: true, telegramChatId: true, primaryBotId: true },
  });
  console.log("CANAL:", canal);

  const bots = await prisma.bot.findMany({
    select: { id: true, name: true, username: true, telegramBotId: true, isActive: true, mode: true, tokenEncrypted: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`${bots.length} bots en base\n`);

  for (const b of bots) {
    const label = `${b.username ?? b.name} (${b.id}) isActive=${b.isActive} mode=${b.mode}`;
    let token = "";
    try {
      token = decrypt(b.tokenEncrypted);
    } catch (e) {
      console.log(`- ${label} : DECRYPT ECHOUE ${(e as Error).message}`);
      continue;
    }
    const me: any = await fetch(`https://api.telegram.org/bot${token}/getMe`)
      .then((r) => r.json())
      .catch((e) => ({ ok: false, description: String(e) }));

    if (!me.ok) {
      console.log(`- ${label} : TOKEN MORT -> ${me.error_code} ${me.description}`);
      continue;
    }
    console.log(`- ${label} : TOKEN VIVANT -> @${me.result.username} (id ${me.result.id})`);

    if (canal?.telegramChatId) {
      const chat: any = await fetch(
        `https://api.telegram.org/bot${token}/getChat?chat_id=${canal.telegramChatId}`
      ).then((r) => r.json());
      console.log(
        `    getChat(${canal.telegramChatId}) -> ` +
          (chat.ok
            ? `OK "${chat.result.title}" id=${chat.result.id} type=${chat.result.type}`
            : `${chat.error_code} ${chat.description}`)
      );
      if (chat.ok) {
        const m: any = await fetch(
          `https://api.telegram.org/bot${token}/getChatMember?chat_id=${canal.telegramChatId}&user_id=${me.result.id}`
        ).then((r) => r.json());
        console.log(
          `    getChatMember -> ` +
            (m.ok ? `${m.result.status} can_invite_users=${m.result.can_invite_users}` : `${m.error_code} ${m.description}`)
        );
      }
    }
  }
}

main().then(() => process.exit(0));

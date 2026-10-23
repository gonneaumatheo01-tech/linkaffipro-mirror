import { prisma } from "@linkaffipro/db";
import { decrypt } from "@linkaffipro/core";

const filtre = process.argv[2] ?? "Test Local";

/** Réponse brute de l'API Bot Telegram (forme minimale utile au diagnostic). */
type TgResponse<T> = { ok: true; result: T } | { ok: false; error_code?: number; description: string };

async function tg<T>(token: string, method: string, query = ""): Promise<TgResponse<T>> {
  return fetch(`https://api.telegram.org/bot${token}/${method}${query}`)
    .then((r) => r.json() as Promise<TgResponse<T>>)
    .catch((e: unknown) => ({ ok: false as const, description: String(e) }));
}

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
    const me = await tg<{ id: number; username?: string }>(token, "getMe");
    if (!me.ok) {
      console.log(`- ${label} : TOKEN MORT -> ${me.error_code ?? ""} ${me.description}`);
      continue;
    }
    console.log(`- ${label} : TOKEN VIVANT -> @${me.result.username} (id ${me.result.id})`);

    if (canal?.telegramChatId) {
      const chat = await tg<{ id: number; title?: string; type: string }>(token, "getChat", `?chat_id=${canal.telegramChatId}`);
      console.log(
        `    getChat(${canal.telegramChatId}) -> ` +
          (chat.ok
            ? `OK "${chat.result.title}" id=${chat.result.id} type=${chat.result.type}`
            : `${chat.error_code ?? ""} ${chat.description}`),
      );
      if (chat.ok) {
        const m = await tg<{ status: string; can_invite_users?: boolean }>(
          token,
          "getChatMember",
          `?chat_id=${canal.telegramChatId}&user_id=${me.result.id}`,
        );
        console.log(
          `    getChatMember -> ` +
            (m.ok ? `${m.result.status} can_invite_users=${m.result.can_invite_users}` : `${m.error_code ?? ""} ${m.description}`),
        );
      }
    }
  }
}

main().then(() => process.exit(0));

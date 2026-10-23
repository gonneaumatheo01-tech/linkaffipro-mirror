import { prisma } from "@linkaffipro/db";
import { decrypt } from "@linkaffipro/core";
async function main() {
  const bot = await prisma.bot.findUniqueOrThrow({ where: { id: "cmv0tqjem0000f4x5001cjh9m" } });
  const token = decrypt(bot.tokenEncrypted);
  for (const c of await prisma.channel.findMany({ select: { title: true, telegramChatId: true, primaryBotId: true } })) {
    const r = (await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=${c.telegramChatId}`).then((x) => x.json())) as
      | { ok: true; result: { title: string } }
      | { ok: false; error_code: number; description: string };
    const botLabel = c.primaryBotId ?? "(aucun)";
    console.log(
      `${c.title} | chat ${c.telegramChatId} | bot ${botLabel} -> ` +
        (r.ok ? `OK "${r.result.title}"` : `${r.error_code} ${r.description}`)
    );
  }
}
main().then(() => process.exit(0));

import { prisma } from "@linkaffipro/db";
import { decrypt } from "@linkaffipro/core";

const BOT_DB_ID = "cmv0tqjem0000f4x5001cjh9m";
const url = process.argv[2] ?? "";
const ALLOWED = ["message","edited_message","channel_post","edited_channel_post","callback_query","my_chat_member","chat_member","chat_join_request","message_reaction","message_reaction_count"];

async function main() {
  const b = await prisma.bot.findUniqueOrThrow({ where: { id: BOT_DB_ID } });
  const token = decrypt(b.tokenEncrypted);
  if (!url) {
    console.log("deleteWebhook:", await (await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, { method: "POST" })).json());
  } else {
    console.log("setWebhook:", await (await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, secret_token: b.webhookSecret, allowed_updates: ALLOWED }),
    })).json());
  }
  console.log("info:", await (await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`)).json());
}
main().then(() => process.exit(0));

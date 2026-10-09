import { beforeAll, describe, expect, it } from "vitest";
import { encrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { getOrCreateBot, prismaTelegramDeps } from "@linkaffipro/telegram";
import { POST } from "@/app/api/telegram/[botId]/route";
import { ctx, flushAfter, resetDb } from "./helpers";

const SECRET = "secret-integration";
const calls: Array<{ method: string; body: unknown }> = [];

describe("webhook Telegram (base réelle)", () => {
  let botId = "";
  beforeAll(async () => {
    await resetDb();
    const bot = await prisma.bot.create({
      data: { name: "Bot test", username: "bot_test", telegramBotId: 111n, tokenEncrypted: encrypt("111:TEST-TOKEN-xxxxxxxxxxxxxxxxxxxxxxxxxxxx"), vertical: "CASINO", webhookSecret: SECRET },
    });
    botId = bot.id;
    // La route réutilise l'instance grammY mise en cache : on intercepte son API ici (aucun appel réseau).
    const instance = getOrCreateBot(bot, prismaTelegramDeps);
    instance.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, body: payload });
      return { ok: true, result: { message_id: 1, date: 0, chat: { id: 4242, type: "private", first_name: "x" }, text: "ok" } } as never;
    });
  });

  it("refuse un mauvais secret", async () => {
    const res = await POST(new Request("http://localhost/api/telegram/x", { method: "POST", headers: { "x-telegram-bot-api-secret-token": "faux", "content-type": "application/json" }, body: "{}" }), ctx({ botId }));
    expect(res.status).toBe(403);
  });

  it("enregistre le membre sur /start et répond", async () => {
    const update = { update_id: 1, message: { message_id: 1, date: 1, chat: { id: 4242, type: "private", first_name: "Léa" }, from: { id: 4242, is_bot: false, first_name: "Léa", language_code: "fr" }, text: "/start", entities: [{ type: "bot_command", offset: 0, length: 6 }] } };
    const res = await POST(new Request("http://localhost/api/telegram/x", { method: "POST", headers: { "x-telegram-bot-api-secret-token": SECRET, "content-type": "application/json" }, body: JSON.stringify(update) }), ctx({ botId }));
    expect(res.status).toBe(200);
    await flushAfter();
    const member = await prisma.member.findUnique({ where: { telegramUserId: 4242n }, include: { botStates: true } });
    expect(member?.firstName).toBe("Léa");
    expect(member?.botStates[0]?.canDm).toBe(true);
    const sent = calls.find((c) => c.method === "sendMessage");
    expect((sent?.body as { text: string }).text).toContain("Bonjour");
    const events = await prisma.event.findMany({ where: { memberId: member!.id } });
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["telegram.message", "member.start"]));
  });
});

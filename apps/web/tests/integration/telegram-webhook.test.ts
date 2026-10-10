import { beforeAll, describe, expect, it } from "vitest";
import { encrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { getOrCreateBot, prismaTelegramDeps } from "@linkaffipro/telegram";
import { POST } from "@/app/api/telegram/[botId]/route";
import { ctx, flushAfter, resetDb, webhookRequest } from "./helpers";

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
      const p = (payload ?? {}) as Record<string, unknown>;
      if (method === "getChatAdministrators") {
        return {
          ok: true,
          result: [
            { status: "administrator", user: { id: 111, is_bot: true, first_name: "Bot test", username: "bot_test" }, can_be_edited: false, is_anonymous: false, can_manage_chat: true, can_delete_messages: true, can_manage_video_chats: false, can_restrict_members: false, can_promote_members: false, can_change_info: false, can_invite_users: true, can_post_messages: true, can_post_stories: false, can_edit_stories: false, can_delete_stories: false, can_send_welcome_messages: false },
            { status: "creator", user: { id: 4242, is_bot: false, first_name: "Léa" }, is_anonymous: false },
          ],
        } as never;
      }
      if (method === "getChat") return { ok: true, result: { id: Number(p.chat_id), type: "channel", title: "Canal transféré (titre à jour)", username: "canal_transfere" } } as never;
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

  it("crée un canal inconnu (et les droits du bot) sur une demande d'adhésion", async () => {
    const chatId = -1007770001;
    const update = {
      update_id: 2,
      chat_join_request: { chat: { id: chatId, type: "channel", title: "Canal oublié" }, from: { id: 5353, is_bot: false, first_name: "Nora" }, user_chat_id: 5353, date: Math.floor(Date.now() / 1000) },
    };
    const res = await POST(webhookRequest(update), ctx({ botId }));
    expect(res.status).toBe(200);
    await flushAfter();
    const channel = await prisma.channel.findUnique({ where: { telegramChatId: BigInt(chatId) }, include: { botAdmins: { where: { revokedAt: null } } } });
    expect(channel?.title).toBe("Canal oublié");
    expect(channel?.botAdmins.map((a) => a.botId)).toEqual([botId]);
    // La demande elle-même est traitée au second essai (canal désormais connu) : une adhésion existe.
    const membership = await prisma.membership.findFirst({ where: { channelId: channel!.id } });
    expect(membership).not.toBeNull();
  });

  it("ajoute un canal transféré au bot par un utilisateur de la plateforme (méthode 1) et répond", async () => {
    await prisma.user.upsert({
      where: { email: "lea@test.local" },
      create: { email: "lea@test.local", name: "Léa", passwordHash: "x", role: "ADMIN", telegramUserId: 4242n },
      update: { telegramUserId: 4242n, isActive: true },
    });
    const chatId = -1007770002;
    const before = calls.length;
    const update = {
      update_id: 3,
      message: {
        message_id: 9,
        date: 1,
        chat: { id: 4242, type: "private", first_name: "Léa" },
        from: { id: 4242, is_bot: false, first_name: "Léa", language_code: "fr" },
        text: "Un message du canal",
        forward_origin: { type: "channel", chat: { id: chatId, type: "channel", title: "Canal transféré" }, message_id: 77, date: 1 },
      },
    };
    const res = await POST(webhookRequest(update), ctx({ botId }));
    expect(res.status).toBe(200);
    await flushAfter();
    const channel = await prisma.channel.findUnique({ where: { telegramChatId: BigInt(chatId) }, include: { botAdmins: { where: { revokedAt: null } } } });
    expect(channel?.title).toBe("Canal transféré (titre à jour)");
    expect(channel?.username).toBe("canal_transfere");
    expect(channel?.botAdmins.map((a) => a.botId)).toEqual([botId]);
    const sent = calls.slice(before).find((c) => c.method === "sendMessage");
    expect((sent?.body as { text: string }).text).toBe("Canal « Canal transféré (titre à jour) » ajouté ✅ (bots administrateurs : @bot_test)");
    const log = await prisma.auditLog.findFirst({ where: { action: "channel.imported_by_forward", entityId: channel!.id } });
    expect(log).not.toBeNull();
  });

  it("répond « Je ne reconnais pas votre compte » à un transfert venant d'un inconnu, sans rien créer", async () => {
    const chatId = -1007770003;
    const before = calls.length;
    const update = {
      update_id: 4,
      message: {
        message_id: 10,
        date: 1,
        chat: { id: 6666, type: "private", first_name: "Inconnu" },
        from: { id: 6666, is_bot: false, first_name: "Inconnu", language_code: "fr" },
        text: "x",
        forward_origin: { type: "channel", chat: { id: chatId, type: "channel", title: "Canal d'un inconnu" }, message_id: 1, date: 1 },
      },
    };
    await POST(webhookRequest(update), ctx({ botId }));
    await flushAfter();
    expect(await prisma.channel.findUnique({ where: { telegramChatId: BigInt(chatId) } })).toBeNull();
    const sent = calls.slice(before).find((c) => c.method === "sendMessage");
    expect((sent?.body as { text: string }).text).toBe("Je ne reconnais pas votre compte.");
  });
});

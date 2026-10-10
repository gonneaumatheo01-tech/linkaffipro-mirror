import { beforeAll, describe, expect, it } from "vitest";
import { encrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { getOrCreateBot, prismaTelegramDeps, SEQUENCE_TRIGGERS } from "@linkaffipro/telegram";
import { POST } from "@/app/api/telegram/[botId]/route";
import {
  createTestBot,
  ctx,
  FakeTelegramWorld,
  flushAfter,
  resetDb,
  webhookRequest,
  type TelegramCall,
} from "./helpers";

const SECRET = "secret-integration";
const calls: Array<{ method: string; body: unknown }> = [];

describe("webhook Telegram (base réelle)", () => {
  let botId = "";
  beforeAll(async () => {
    await resetDb();
    const bot = await prisma.bot.create({
      data: {
        name: "Bot test",
        username: "bot_test",
        telegramBotId: 111n,
        tokenEncrypted: encrypt("111:TEST-TOKEN-xxxxxxxxxxxxxxxxxxxxxxxxxxxx"),
        vertical: "CASINO",
        webhookSecret: SECRET,
      },
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
            {
              status: "administrator",
              user: { id: 111, is_bot: true, first_name: "Bot test", username: "bot_test" },
              can_be_edited: false,
              is_anonymous: false,
              can_manage_chat: true,
              can_delete_messages: true,
              can_manage_video_chats: false,
              can_restrict_members: false,
              can_promote_members: false,
              can_change_info: false,
              can_invite_users: true,
              can_post_messages: true,
              can_post_stories: false,
              can_edit_stories: false,
              can_delete_stories: false,
              can_send_welcome_messages: false,
            },
            {
              status: "creator",
              user: { id: 4242, is_bot: false, first_name: "Léa" },
              is_anonymous: false,
            },
          ],
        } as never;
      }
      if (method === "getChat")
        return {
          ok: true,
          result: {
            id: Number(p.chat_id),
            type: "channel",
            title: "Canal transféré (titre à jour)",
            username: "canal_transfere",
          },
        } as never;
      return {
        ok: true,
        result: {
          message_id: 1,
          date: 0,
          chat: { id: 4242, type: "private", first_name: "x" },
          text: "ok",
        },
      } as never;
    });
  });

  it("refuse un mauvais secret", async () => {
    const res = await POST(
      new Request("http://localhost/api/telegram/x", {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "faux", "content-type": "application/json" },
        body: "{}",
      }),
      ctx({ botId }),
    );
    expect(res.status).toBe(403);
  });

  it("enregistre le membre sur /start et répond", async () => {
    const update = {
      update_id: 1,
      message: {
        message_id: 1,
        date: 1,
        chat: { id: 4242, type: "private", first_name: "Léa" },
        from: { id: 4242, is_bot: false, first_name: "Léa", language_code: "fr" },
        text: "/start",
        entities: [{ type: "bot_command", offset: 0, length: 6 }],
      },
    };
    const res = await POST(
      new Request("http://localhost/api/telegram/x", {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": SECRET, "content-type": "application/json" },
        body: JSON.stringify(update),
      }),
      ctx({ botId }),
    );
    expect(res.status).toBe(200);
    await flushAfter();
    const member = await prisma.member.findUnique({
      where: { telegramUserId: 4242n },
      include: { botStates: true },
    });
    expect(member?.firstName).toBe("Léa");
    expect(member?.botStates[0]?.canDm).toBe(true);
    const sent = calls.find((c) => c.method === "sendMessage");
    expect((sent?.body as { text: string }).text).toContain("Bonjour");
    const events = await prisma.event.findMany({ where: { memberId: member!.id } });
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["telegram.message", "member.start"]),
    );
  });

  it("crée un canal inconnu (et les droits du bot) sur une demande d'adhésion", async () => {
    const chatId = -1007770001;
    const update = {
      update_id: 2,
      chat_join_request: {
        chat: { id: chatId, type: "channel", title: "Canal oublié" },
        from: { id: 5353, is_bot: false, first_name: "Nora" },
        user_chat_id: 5353,
        date: Math.floor(Date.now() / 1000),
      },
    };
    const res = await POST(webhookRequest(update), ctx({ botId }));
    expect(res.status).toBe(200);
    await flushAfter();
    const channel = await prisma.channel.findUnique({
      where: { telegramChatId: BigInt(chatId) },
      include: { botAdmins: { where: { revokedAt: null } } },
    });
    expect(channel?.title).toBe("Canal oublié");
    expect(channel?.botAdmins.map((a) => a.botId)).toEqual([botId]);
    // La demande elle-même est traitée au second essai (canal désormais connu) : une adhésion existe.
    const membership = await prisma.membership.findFirst({ where: { channelId: channel!.id } });
    expect(membership).not.toBeNull();
    // Canal sans règle d'adhésion : demande à valider à la main, ni acceptation automatique ni message privé.
    expect(membership?.status).toBe("REQUESTED");
    expect(membership?.approveAt).toBeNull();
    const member = await prisma.member.findUnique({ where: { telegramUserId: 5353n } });
    expect(await prisma.outboundMessage.count({ where: { memberId: member!.id } })).toBe(0);
    // Bot principal posé à la création (le bot qui a détecté le canal) et séquences par défaut créées une seule fois.
    expect(channel?.primaryBotId).toBe(botId);
    expect(await prisma.sequence.count({ where: { channelId: channel!.id } })).toBe(
      SEQUENCE_TRIGGERS.length,
    );
  });

  it("ajoute un canal transféré au bot par un utilisateur de la plateforme (méthode 1) et répond", async () => {
    await prisma.user.upsert({
      where: { email: "lea@test.local" },
      create: {
        email: "lea@test.local",
        name: "Léa",
        passwordHash: "x",
        role: "ADMIN",
        telegramUserId: 4242n,
      },
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
        forward_origin: {
          type: "channel",
          chat: { id: chatId, type: "channel", title: "Canal transféré" },
          message_id: 77,
          date: 1,
        },
      },
    };
    const res = await POST(webhookRequest(update), ctx({ botId }));
    expect(res.status).toBe(200);
    await flushAfter();
    const channel = await prisma.channel.findUnique({
      where: { telegramChatId: BigInt(chatId) },
      include: { botAdmins: { where: { revokedAt: null } } },
    });
    expect(channel?.title).toBe("Canal transféré (titre à jour)");
    expect(channel?.username).toBe("canal_transfere");
    expect(channel?.botAdmins.map((a) => a.botId)).toEqual([botId]);
    const sent = calls.slice(before).find((c) => c.method === "sendMessage");
    expect((sent?.body as { text: string }).text).toBe(
      "Canal « Canal transféré (titre à jour) » ajouté ✅ (bots administrateurs : @bot_test)",
    );
    const log = await prisma.auditLog.findFirst({
      where: { action: "channel.imported_by_forward", entityId: channel!.id },
    });
    expect(log).not.toBeNull();
  });

  it("transfert venant d'un inconnu : aucune réponse particulière, rien n'est créé", async () => {
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
        forward_origin: {
          type: "channel",
          chat: { id: chatId, type: "channel", title: "Canal d'un inconnu" },
          message_id: 1,
          date: 1,
        },
      },
    };
    await POST(webhookRequest(update), ctx({ botId }));
    await flushAfter();
    expect(
      await prisma.channel.findUnique({ where: { telegramChatId: BigInt(chatId) } }),
    ).toBeNull();
    expect(calls.slice(before).filter((c) => c.method === "sendMessage")).toHaveLength(0);
  });

  it("utilisateur de la plateforme qui écrit un simple texte : aide courte pour ajouter un canal", async () => {
    const before = calls.length;
    const update = {
      update_id: 5,
      message: {
        message_id: 11,
        date: 1,
        chat: { id: 4242, type: "private", first_name: "Léa" },
        from: { id: 4242, is_bot: false, first_name: "Léa", language_code: "fr" },
        text: "comment ajouter mon canal ?",
      },
    };
    await POST(webhookRequest(update), ctx({ botId }));
    await flushAfter();
    const sent = calls.slice(before).filter((c) => c.method === "sendMessage");
    expect(sent).toHaveLength(1);
    expect((sent[0]?.body as { text: string }).text).toContain(
      "transférez-moi un message de ce canal",
    );
  });
});

describe("canaux existants avec plusieurs de nos bots (webhook, base réelle)", () => {
  const world = new FakeTelegramWorld();
  const CHAT = -1007780001;
  let bots: Awaited<ReturnType<typeof createTestBot>>[] = [];
  const callsByBot = new Map<string, TelegramCall[]>();

  beforeAll(async () => {
    await resetDb();
    bots = [
      await createTestBot(111, "CASINO"),
      await createTestBot(222, "SPORTS"),
      await createTestBot(333, "DATING"),
    ];
    for (const b of bots)
      callsByBot.set(b.id, world.install(getOrCreateBot(b, prismaTelegramDeps).api, b));
    world.addChat({ id: CHAT, title: "Canal existant", admins: [111, 222, 333, 9001] });
  });

  const post = (update_id: number, chatId = CHAT) => ({
    update_id,
    channel_post: {
      message_id: update_id,
      date: 1,
      chat: { id: chatId, type: "channel", title: "Canal existant" },
      sender_chat: { id: chatId, type: "channel", title: "Canal existant" },
      text: ".",
    },
  });

  it("la même première publication reçue en même temps par 3 bots : un seul canal, séquences sans doublon, droits des 3 bots, aucun retrait", async () => {
    const update = post(100);
    await Promise.all(
      bots.map((b) => POST(webhookRequest(update, b.webhookSecret), ctx({ botId: b.id }))),
    );
    await flushAfter();
    const channels = await prisma.channel.findMany({ where: { telegramChatId: BigInt(CHAT) } });
    expect(channels).toHaveLength(1);
    const channelId = channels[0]!.id;
    expect(await prisma.sequence.count({ where: { channelId } })).toBe(SEQUENCE_TRIGGERS.length);
    const admins = await prisma.channelBotAdmin.findMany({ where: { channelId } });
    expect(admins).toHaveLength(3);
    expect(admins.every((a) => a.revokedAt === null)).toBe(true);
    expect(
      await prisma.event.count({ where: { channelId, type: "channel.bot_admin_revoked" } }),
    ).toBe(0);
    // Bot principal posé une seule fois, par le bot qui a créé le canal.
    expect(channels[0]!.primaryBotId).not.toBeNull();
    expect(
      await prisma.event.count({ where: { channelId, type: "channel.primary_bot_set" } }),
    ).toBe(1);
    // Chaque bot a demandé la liste complète (return_bots).
    for (const b of bots) {
      const c = callsByBot.get(b.id)!.filter((x) => x.method === "getChatAdministrators");
      expect(c.length).toBeGreaterThan(0);
      expect(c.every((x) => x.payload.return_bots === true)).toBe(true);
    }
  });

  it("nouvelles publications : droits inchangés → ni réécriture de detectedAt ni nouvel événement", async () => {
    const channel = await prisma.channel.findUniqueOrThrow({
      where: { telegramChatId: BigInt(CHAT) },
    });
    const before = await prisma.channelBotAdmin.findMany({
      where: { channelId: channel.id },
      orderBy: { botId: "asc" },
    });
    const events = await prisma.event.count({
      where: { channelId: channel.id, type: "channel.bot_admin_detected" },
    });
    for (const n of [101, 102])
      await Promise.all(
        bots.map((b) => POST(webhookRequest(post(n), b.webhookSecret), ctx({ botId: b.id }))),
      );
    await flushAfter();
    const after = await prisma.channelBotAdmin.findMany({
      where: { channelId: channel.id },
      orderBy: { botId: "asc" },
    });
    expect(after.map((a) => a.detectedAt.getTime())).toEqual(
      before.map((a) => a.detectedAt.getTime()),
    );
    expect(after.every((a) => a.revokedAt === null)).toBe(true);
    expect(
      await prisma.event.count({
        where: { channelId: channel.id, type: "channel.bot_admin_detected" },
      }),
    ).toBe(events);
    expect(
      (await prisma.channel.findUniqueOrThrow({ where: { id: channel.id } })).primaryBotId,
    ).toBe(channel.primaryBotId);
  });

  it("un bot vraiment retiré du canal perd ses droits à la publication suivante (confirmé par getChatMember)", async () => {
    world.chats.get(CHAT)!.admins.delete(333);
    await POST(webhookRequest(post(103), bots[0]!.webhookSecret), ctx({ botId: bots[0]!.id }));
    await flushAfter();
    const channel = await prisma.channel.findUniqueOrThrow({
      where: { telegramChatId: BigInt(CHAT) },
    });
    const row = await prisma.channelBotAdmin.findFirstOrThrow({
      where: { channelId: channel.id, botId: bots[2]!.id },
    });
    expect(row.revokedAt).not.toBeNull();
    expect(
      callsByBot
        .get(bots[0]!.id)!
        .some((c) => c.method === "getChatMember" && c.payload.user_id === 333),
    ).toBe(true);
    // Les deux autres restent administrateurs.
    expect(
      await prisma.channelBotAdmin.count({ where: { channelId: channel.id, revokedAt: null } }),
    ).toBe(2);
  });

  it("bot retiré d'un canal jamais vu : aucun canal fantôme", async () => {
    const ghost = -1007780999;
    const update = {
      update_id: 110,
      my_chat_member: {
        chat: { id: ghost, type: "channel", title: "Vieux canal" },
        from: { id: 9001, is_bot: false, first_name: "Client" },
        date: 1,
        old_chat_member: {
          status: "administrator",
          user: { id: 222, is_bot: true, first_name: "Bot 222", username: "bot_222" },
          can_be_edited: false,
          is_anonymous: false,
          can_manage_chat: true,
          can_delete_messages: true,
          can_manage_video_chats: false,
          can_restrict_members: false,
          can_promote_members: false,
          can_change_info: false,
          can_invite_users: true,
          can_post_stories: false,
          can_edit_stories: false,
          can_delete_stories: false,
        },
        new_chat_member: {
          status: "left",
          user: { id: 222, is_bot: true, first_name: "Bot 222", username: "bot_222" },
        },
      },
    };
    const res = await POST(
      webhookRequest(update, bots[1]!.webhookSecret),
      ctx({ botId: bots[1]!.id }),
    );
    expect(res.status).toBe(200);
    await flushAfter();
    expect(
      await prisma.channel.findUnique({ where: { telegramChatId: BigInt(ghost) } }),
    ).toBeNull();
    expect(
      await prisma.sequence.count({ where: { channel: { telegramChatId: BigInt(ghost) } } }),
    ).toBe(0);
  });

  it("canal décoché « Actif » : une demande d'adhésion est ignorée (aucune adhésion, aucun message)", async () => {
    const channel = await prisma.channel.findUniqueOrThrow({
      where: { telegramChatId: BigInt(CHAT) },
    });
    await prisma.channel.update({ where: { id: channel.id }, data: { isActive: false } });
    const update = {
      update_id: 120,
      chat_join_request: {
        chat: { id: CHAT, type: "channel", title: "Canal existant" },
        from: { id: 7171, is_bot: false, first_name: "Inès" },
        user_chat_id: 7171,
        date: Math.floor(Date.now() / 1000),
      },
    };
    await Promise.all(
      bots.map((b) => POST(webhookRequest(update, b.webhookSecret), ctx({ botId: b.id }))),
    );
    await flushAfter();
    expect(await prisma.membership.count({ where: { channelId: channel.id } })).toBe(0);
    expect(await prisma.outboundMessage.count()).toBe(0);
    await prisma.channel.update({ where: { id: channel.id }, data: { isActive: true } });
  });

  it("lien public collé au bot par un utilisateur de la plateforme : canal importé (méthode 2 depuis le bot), audit", async () => {
    await prisma.user.upsert({
      where: { email: "nora@test.local" },
      create: {
        email: "nora@test.local",
        name: "Nora",
        passwordHash: "x",
        role: "MANAGER",
        telegramUserId: 8282n,
      },
      update: { telegramUserId: 8282n, isActive: true },
    });
    world.addChat({
      id: -1007780002,
      title: "Canal public",
      username: "canal_public_test",
      admins: [222, 9001],
    });
    const b = bots[0]!;
    const before = callsByBot.get(b.id)!.length;
    const update = {
      update_id: 130,
      message: {
        message_id: 3,
        date: 1,
        chat: { id: 8282, type: "private", first_name: "Nora" },
        from: { id: 8282, is_bot: false, first_name: "Nora", language_code: "fr" },
        text: "https://t.me/s/canal_public_test",
      },
    };
    await POST(webhookRequest(update, b.webhookSecret), ctx({ botId: b.id }));
    await flushAfter();
    const channel = await prisma.channel.findUnique({
      where: { telegramChatId: -1007780002n },
      include: { botAdmins: { where: { revokedAt: null } } },
    });
    expect(channel?.title).toBe("Canal public");
    expect(channel?.botAdmins.map((a) => a.botId)).toEqual([bots[1]!.id]);
    expect(channel?.primaryBotId).toBe(bots[1]!.id);
    const sent = callsByBot
      .get(b.id)!
      .slice(before)
      .filter((c) => c.method === "sendMessage");
    expect(sent.map((c) => c.payload.text)).toEqual([
      "Canal « Canal public » ajouté ✅ (bots administrateurs : @bot_222)",
    ]);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "nora@test.local" } });
    expect(
      await prisma.auditLog.findFirst({
        where: { action: "channel.imported_by_link", entityId: channel!.id, userId: user.id },
      }),
    ).not.toBeNull();
  });

  it("admin du dialogue avec Claude : « fait » ne reçoit pas l'aide, un lien cité dans une phrase n'importe rien", async () => {
    await prisma.setting.upsert({
      where: { key: "admin.telegramUserId" },
      create: { key: "admin.telegramUserId", value: "9393" },
      update: { value: "9393" },
    });
    try {
      world.addChat({
        id: -1007780003,
        title: "Canal d'un autre",
        username: "canal_concurrent",
        admins: [9001],
      });
      const b = bots[0]!; // bot casino : celui du dialogue (pnpm tg:send)
      const before = callsByBot.get(b.id)!.length;
      const dm = (update_id: number, text: string) => ({
        update_id,
        message: {
          message_id: update_id,
          date: 1,
          chat: { id: 9393, type: "private", first_name: "Admin" },
          from: { id: 9393, is_bot: false, first_name: "Admin", language_code: "fr" },
          text,
        },
      });
      await POST(webhookRequest(dm(140, "fait"), b.webhookSecret), ctx({ botId: b.id }));
      await POST(
        webhookRequest(dm(141, "regarde t.me/canal_concurrent"), b.webhookSecret),
        ctx({ botId: b.id }),
      );
      await flushAfter();
      const sent = callsByBot
        .get(b.id)!
        .slice(before)
        .filter((c) => c.method === "sendMessage");
      expect(sent).toEqual([]);
      expect(await prisma.channel.count({ where: { telegramChatId: -1007780003n } })).toBe(0);
    } finally {
      await prisma.setting.deleteMany({ where: { key: "admin.telegramUserId" } });
    }
  });
});

/**
 * Phase 12, webhook Telegram réel (base réelle, Telegram simulé) : ajout d'emojis animés à la bibliothèque par un
 * message envoyé au bot, et repli des emojis animés dans une réponse directe du bot (réponse d'offre).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { getOrCreateBot, prismaTelegramDeps } from "@linkaffipro/telegram";
import { POST } from "@/app/api/telegram/[botId]/route";
import {
  capturedJobs,
  createBotAndChannel,
  ctx,
  flushAfter,
  resetDb,
  webhookRequest,
} from "./helpers";

const TEAM_ID = 7_310_001;
const ADMIN_ID = 7_310_002;
const STRANGER_ID = 7_310_003;
const MEMBER_ID = 7_310_004;
const ADMIN_SETTING = "admin.telegramUserId";

type Call = { method: string; payload: Record<string, unknown> };
const calls: Call[] = [];
/** Refus des emojis animés par Telegram (réponses du bot) quand vrai. */
let refuseEmojis = false;
/** Canaux dont le bot de test ne peut pas lire la liste des administrateurs (il n'en est pas administrateur). */
const deniedChats = new Set<number>();
const MEMBER_LIST_DENIED = {
  ok: false,
  error_code: 400,
  description: "Bad Request: member list is inaccessible",
};
/** Canal d'un tiers (aucun de nos bots administrateur) et canal dont seul notre second bot est administrateur. */
const STRANGER_CHAT = -1008880001;
const SPORT_ONLY_CHAT = -1008880002;
const REFUSAL =
  'Bad Request: can\'t parse entities: Unsupported start tag "tg-emoji" at byte offset 10';

let updateId = 9_000;
function privateMessage(fromId: number, extra: Record<string, unknown>) {
  updateId++;
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: fromId, type: "private", first_name: "Prénom" },
      from: { id: fromId, is_bot: false, first_name: "Prénom", language_code: "fr" },
      ...extra,
    },
  };
}

/** « Top 🔥 et 🎁 et 🔥 » : trois emojis animés, deux différents (positions UTF-16). */
const EMOJI_TEXT = {
  text: "Top 🔥 et 🎁 et 🔥",
  entities: [
    { type: "custom_emoji", offset: 4, length: 2, custom_emoji_id: "5368324170671202286" },
    { type: "custom_emoji", offset: 10, length: 2, custom_emoji_id: "5361111111111111111" },
    { type: "custom_emoji", offset: 16, length: 2, custom_emoji_id: "5368324170671202286" },
  ],
  forward_origin: { type: "hidden_user", sender_user_name: "Un ami", date: 1 },
};

const sentTexts = (from: number) =>
  calls
    .slice(from)
    .filter((c) => c.method === "sendMessage")
    .map((c) => String(c.payload.text));

describe("emojis animés envoyés au bot (webhook, base réelle)", () => {
  let botId = "";
  let channelId = "";
  let teamUserId = "";
  let previousAdmin: unknown = undefined;

  beforeAll(async () => {
    await resetDb();
    await prisma.customEmoji.deleteMany();
    const { bot, channel } = await createBotAndChannel();
    botId = bot.id;
    channelId = channel.id;
    const user = await prisma.user.upsert({
      where: { email: "emojis@test.local" },
      create: {
        email: "emojis@test.local",
        name: "Équipe",
        passwordHash: "x",
        role: "MANAGER",
        telegramUserId: BigInt(TEAM_ID),
      },
      update: { telegramUserId: BigInt(TEAM_ID), isActive: true },
    });
    teamUserId = user.id;
    previousAdmin = (await prisma.setting.findUnique({ where: { key: ADMIN_SETTING } }))?.value;
    await prisma.setting.upsert({
      where: { key: ADMIN_SETTING },
      create: { key: ADMIN_SETTING, value: String(ADMIN_ID) },
      update: { value: String(ADMIN_ID) },
    });
    getOrCreateBot(bot, prismaTelegramDeps).api.config.use(async (_prev, method, payload) => {
      const p = (payload ?? {}) as Record<string, unknown>;
      calls.push({ method, payload: p });
      if (method === "getChat")
        return {
          ok: true,
          result: { id: Number(p.chat_id), type: "channel", title: "Canal aux emojis" },
        } as never;
      if (method === "getChatAdministrators" && deniedChats.has(Number(p.chat_id)))
        return MEMBER_LIST_DENIED as never;
      if (method === "getChatAdministrators")
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
            },
          ],
        } as never;
      const text = String(p.text ?? p.caption ?? "");
      if (refuseEmojis && method === "sendMessage" && text.includes("<tg-emoji"))
        return { ok: false, error_code: 400, description: REFUSAL } as never;
      return {
        ok: true,
        result: {
          message_id: 1,
          date: 0,
          chat: { id: Number(p.chat_id), type: "private", first_name: "x" },
          text,
          entities: text.includes("<tg-emoji")
            ? [{ type: "custom_emoji", offset: 0, length: 2 }]
            : [],
        },
      } as never;
    });
  });

  afterAll(async () => {
    await prisma.customEmoji.deleteMany();
    if (previousAdmin === undefined)
      await prisma.setting.deleteMany({ where: { key: ADMIN_SETTING } });
    else
      await prisma.setting.update({
        where: { key: ADMIN_SETTING },
        data: { value: previousAdmin as never },
      });
  });

  it("message transféré par un utilisateur de la plateforme : emojis ajoutés une fois chacun, aperçus enfilés, réponse", async () => {
    const before = calls.length;
    const res = await POST(webhookRequest(privateMessage(TEAM_ID, EMOJI_TEXT)), ctx({ botId }));
    expect(res.status).toBe(200);
    await flushAfter();

    // Emojis créés ensemble (même milliseconde) : ordre fixé par leur identifiant, pas par la date de création.
    const rows = await prisma.customEmoji.findMany({ orderBy: { customEmojiId: "desc" } });
    expect(
      rows.map((r) => [r.customEmojiId, r.fallback, r.source, r.addedById, r.hiddenAt]),
    ).toEqual([
      ["5368324170671202286", "🔥", "FORWARD", teamUserId, null],
      ["5361111111111111111", "🎁", "FORWARD", teamUserId, null],
    ]);
    expect(sentTexts(before)).toEqual([
      "2 emojis animés ajoutés ✅\n\nRetrouvez-les sur le site : Messages → Emojis animés.",
    ]);

    const events = await prisma.event.findMany({ where: { type: "custom_emoji.added" } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ botId });
    expect(events[0]!.payload).toMatchObject({
      count: 2,
      source: "FORWARD",
      ids: ["5368324170671202286", "5361111111111111111"],
      userId: teamUserId,
    });
    const jobs = capturedJobs("custom-emoji");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.data).toEqual({
      type: "fetch-previews",
      customEmojiIds: ["5368324170671202286", "5361111111111111111"],
    });
    // Pas d'aide « Pour ajouter un canal » en plus.
    expect(sentTexts(before)).toHaveLength(1);
  });

  it("le même message une seconde fois : aucun doublon, « déjà dans la bibliothèque »", async () => {
    const before = calls.length;
    await POST(webhookRequest(privateMessage(TEAM_ID, EMOJI_TEXT)), ctx({ botId }));
    await flushAfter();
    expect(await prisma.customEmoji.count()).toBe(2);
    expect(sentTexts(before)).toEqual([
      "Ces 2 emojis animés sont déjà dans la bibliothèque ✅\n\nRetrouvez-les sur le site : Messages → Emojis animés.",
    ]);
    expect(await prisma.event.count({ where: { type: "custom_emoji.added" } })).toBe(1);
    expect(capturedJobs("custom-emoji")).toHaveLength(1);
  });

  it("un emoji retiré de la bibliothèque y revient ; l'admin (sans compte lié) peut aussi en ajouter", async () => {
    await prisma.customEmoji.update({
      where: { customEmojiId: "5361111111111111111" },
      data: { hiddenAt: new Date() },
    });
    const before = calls.length;
    await POST(
      webhookRequest(
        privateMessage(ADMIN_ID, {
          text: "🎁 ⭐",
          entities: [
            { type: "custom_emoji", offset: 0, length: 2, custom_emoji_id: "5361111111111111111" },
            { type: "custom_emoji", offset: 3, length: 1, custom_emoji_id: "5399999999999999999" },
          ],
        }),
      ),
      ctx({ botId }),
    );
    await flushAfter();
    expect(sentTexts(before)).toEqual([
      "2 emojis animés ajoutés ✅\n\nRetrouvez-les sur le site : Messages → Emojis animés.",
    ]);
    const gift = await prisma.customEmoji.findUniqueOrThrow({
      where: { customEmojiId: "5361111111111111111" },
    });
    expect(gift.hiddenAt).toBeNull();
    const star = await prisma.customEmoji.findUniqueOrThrow({
      where: { customEmojiId: "5399999999999999999" },
    });
    expect(star).toMatchObject({ fallback: "⭐", source: "FORWARD", addedById: null });
    const restoredLog = await prisma.auditLog.findFirst({
      where: { action: "custom_emoji.restored" },
      orderBy: { createdAt: "desc" },
    });
    expect(restoredLog?.metadata).toMatchObject({
      customEmojiIds: ["5361111111111111111"],
      via: "bot",
    });
  });

  it("message d'un inconnu : rien n'est enregistré, aucune réponse", async () => {
    const before = calls.length;
    const count = await prisma.customEmoji.count();
    await POST(
      webhookRequest(
        privateMessage(STRANGER_ID, {
          text: "😈",
          entities: [
            { type: "custom_emoji", offset: 0, length: 2, custom_emoji_id: "5300000000000000666" },
          ],
        }),
      ),
      ctx({ botId }),
    );
    await flushAfter();
    expect(await prisma.customEmoji.count()).toBe(count);
    expect(sentTexts(before)).toEqual([]);
  });

  it("transfert d'un message de canal avec emojis : emojis ajoutés ET canal ajouté", async () => {
    const before = calls.length;
    await POST(
      webhookRequest(
        privateMessage(TEAM_ID, {
          photo: [{ file_id: "P", file_unique_id: "U", width: 1, height: 1 }],
          caption: "💎 VIP",
          caption_entities: [
            { type: "custom_emoji", offset: 0, length: 2, custom_emoji_id: "5311111111111111111" },
          ],
          forward_origin: {
            type: "channel",
            chat: { id: -1007771234, type: "channel", title: "Canal aux emojis" },
            message_id: 3,
            date: 1,
          },
        }),
      ),
      ctx({ botId }),
    );
    await flushAfter();
    expect(
      await prisma.customEmoji.findUnique({ where: { customEmojiId: "5311111111111111111" } }),
    ).toMatchObject({
      fallback: "💎",
    });
    expect(
      await prisma.channel.findUnique({ where: { telegramChatId: -1007771234n } }),
    ).not.toBeNull();
    const texts = sentTexts(before);
    expect(texts[0]).toMatch(/^1 emoji animé ajouté ✅/);
    expect(texts[1]).toContain("Canal « Canal aux emojis » ajouté ✅");
  });

  it("transfert depuis le canal de quelqu'un d'autre : emojis ajoutés, aucun canal créé, une seule réponse", async () => {
    deniedChats.add(STRANGER_CHAT);
    // Le journal d'audit n'est pas vidé entre deux passages : seules les lignes de ce test comptent.
    const startedAt = new Date();
    const channelsBefore = await prisma.channel.count();
    const before = calls.length;
    await POST(
      webhookRequest(
        privateMessage(TEAM_ID, {
          text: "🌟 promo",
          entities: [
            { type: "custom_emoji", offset: 0, length: 2, custom_emoji_id: "5322222222222222222" },
          ],
          forward_origin: {
            type: "channel",
            chat: { id: STRANGER_CHAT, type: "channel", title: "Canal d'un autre" },
            message_id: 9,
            date: 1,
          },
        }),
      ),
      ctx({ botId }),
    );
    await flushAfter();
    expect(
      await prisma.customEmoji.findUnique({ where: { customEmojiId: "5322222222222222222" } }),
    ).toMatchObject({ fallback: "🌟", source: "FORWARD" });
    expect(await prisma.channel.count()).toBe(channelsBefore);
    expect(
      await prisma.channel.findUnique({ where: { telegramChatId: BigInt(STRANGER_CHAT) } }),
    ).toBeNull();
    expect(
      await prisma.auditLog.count({
        where: {
          action: "channel.imported_by_forward",
          createdAt: { gte: startedAt },
          metadata: { path: ["telegramChatId"], equals: String(STRANGER_CHAT) },
        },
      }),
    ).toBe(0);
    expect(sentTexts(before)).toEqual([
      "1 emoji animé ajouté ✅\n\nRetrouvez-le sur le site : Messages → Emojis animés.\n\n" +
        "Le canal d'origine n'a pas été ajouté à la plateforme. Si c'est l'un de vos canaux : nommez @bot_test " +
        "administrateur, puis transférez-moi de nouveau un de ses messages.",
    ]);
  });

  it("transfert depuis un canal dont seul un autre de nos bots est administrateur : emojis ET canal ajoutés", async () => {
    deniedChats.add(SPORT_ONLY_CHAT);
    const sport = await prisma.bot.create({
      data: {
        name: "Bot sport",
        username: "bot_sport",
        telegramBotId: 222n,
        tokenEncrypted: encrypt("222:TEST-TOKEN-yyyyyyyyyyyyyyyyyyyyyyyyyyyy"),
        vertical: "SPORTS",
        webhookSecret: "secret-sport",
      },
    });
    const sportCalls: Call[] = [];
    getOrCreateBot(sport, prismaTelegramDeps).api.config.use(async (_prev, method, payload) => {
      const p = (payload ?? {}) as Record<string, unknown>;
      sportCalls.push({ method, payload: p });
      if (method === "getChatAdministrators" && Number(p.chat_id) === SPORT_ONLY_CHAT)
        return {
          ok: true,
          result: [
            {
              status: "administrator",
              user: { id: 222, is_bot: true, first_name: "Bot sport", username: "bot_sport" },
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
            },
          ],
        } as never;
      if (method === "getChatAdministrators") return MEMBER_LIST_DENIED as never;
      return { ok: true, result: true } as never;
    });
    try {
      const before = calls.length;
      await POST(
        webhookRequest(
          privateMessage(TEAM_ID, {
            text: "⚽ match",
            entities: [
              {
                type: "custom_emoji",
                offset: 0,
                length: 1,
                custom_emoji_id: "5333333333333333333",
              },
            ],
            forward_origin: {
              type: "channel",
              chat: { id: SPORT_ONLY_CHAT, type: "channel", title: "Canal sport" },
              message_id: 4,
              date: 1,
            },
          }),
        ),
        ctx({ botId }),
      );
      await flushAfter();
      expect(
        sportCalls.some(
          (c) =>
            c.method === "getChatAdministrators" && Number(c.payload.chat_id) === SPORT_ONLY_CHAT,
        ),
      ).toBe(true);
      expect(
        await prisma.channel.findUnique({ where: { telegramChatId: BigInt(SPORT_ONLY_CHAT) } }),
      ).not.toBeNull();
      const texts = sentTexts(before);
      expect(texts[0]).toBe(
        "1 emoji animé ajouté ✅\n\nRetrouvez-le sur le site : Messages → Emojis animés.",
      );
      expect(texts[1]).toContain("Canal « Canal aux emojis » ajouté");
    } finally {
      await prisma.channelBotAdmin.deleteMany({ where: { botId: sport.id } });
      await prisma.channel.updateMany({
        where: { primaryBotId: sport.id },
        data: { primaryBotId: botId },
      });
      await prisma.bot.update({ where: { id: sport.id }, data: { isActive: false } });
    }
  });

  it("réponse d'offre avec un emoji animé refusée par Telegram : renvoyée aussitôt avec l'emoji normal, journalisée", async () => {
    const program = await prisma.affiliateProgram.create({
      data: { name: "Casino emoji", source: "LINKAFFI", externalId: "cas-emoji" },
    });
    const offer = await prisma.affiliateCampaign.create({
      data: {
        programId: program.id,
        externalId: "camp-emoji",
        campaignKey: "KEYE",
        name: "Offre emoji",
        trackingUrlTemplate: "https://linkaffi.me/go/KEYE?sub_id={subid}",
      },
    });
    await prisma.trackingLink.create({
      data: {
        slug: "emoji001",
        kind: "OFFER",
        destinationTemplate: offer.trackingUrlTemplate,
        label: "Offre emoji",
        affiliateCampaignId: offer.id,
        channelId,
      },
    });
    const seq = await prisma.sequence.create({
      data: { name: "Réponse d'offre", channelId, trigger: "OFFER_REPLY" },
    });
    await prisma.sequenceStep.create({
      data: {
        sequenceId: seq.id,
        texts: { fr: 'Ton bonus <tg-emoji emoji-id="5368324170671202286">🔥</tg-emoji> !' },
        buttons: [[{ text: "J'en profite" }]],
      },
    });
    refuseEmojis = true;
    try {
      const before = calls.length;
      await POST(
        webhookRequest(
          privateMessage(MEMBER_ID, {
            text: "/start oemoji001",
            entities: [{ type: "bot_command", offset: 0, length: 6 }],
          }),
        ),
        ctx({ botId }),
      );
      await flushAfter();
      const sends = calls.slice(before).filter((c) => c.method === "sendMessage");
      expect(sends.map((c) => c.payload.text)).toEqual([
        'Ton bonus <tg-emoji emoji-id="5368324170671202286">🔥</tg-emoji> !',
        "Ton bonus 🔥 !",
      ]);
      const kb = sends[1]!.payload.reply_markup as {
        inline_keyboard: Array<Array<{ text: string; url: string }>>;
      };
      expect(kb.inline_keyboard[0]![0]!.text).toBe("J'en profite");
      expect(kb.inline_keyboard[0]![0]!.url).toMatch(
        /^https:\/\/linkaffi\.me\/go\/KEYE\?sub_id=[0-9A-Za-z]{12}$/,
      );
      const member = await prisma.member.findUniqueOrThrow({
        where: { telegramUserId: BigInt(MEMBER_ID) },
      });
      const ev = await prisma.event.findFirst({
        where: { type: "dm.custom_emoji_fallback", memberId: member.id },
      });
      expect(ev).toMatchObject({ botId });
      expect(ev?.payload).toMatchObject({
        outboundMessageId: null,
        botId,
        error: REFUSAL,
        resent: true,
        via: "offer_reply",
      });
      // Un seul clic : le renvoi ne recompte rien.
      expect(await prisma.click.count({ where: { memberId: member.id } })).toBe(1);
    } finally {
      refuseEmojis = false;
    }
  });
});

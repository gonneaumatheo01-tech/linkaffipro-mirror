import { beforeEach, describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { MessageEntity, Update } from "grammy/types";
import { registerHandlers } from "../handlers";
import { botInfoFromRecord } from "../factory";
import { MESSAGES } from "../i18n";
import type { BotIdentity, TelegramDeps } from "../ports";
import type { OfferDeps } from "../offers/deps";
import type { CustomEmojiAddOutcome } from "../custom-emoji/extract";
import { registerOfferHandlers } from "./offers";
import { registerJoinFlowHandlers } from "./join-flow";
import type { JoinFlowDeps } from "../join-flow/deps";
import type * as JoinFlowService from "../join-flow/service";

// Réponse « ✅ J'ai rejoint » simulée (le flux complet est testé dans join-flow.test.ts) : texte de l'équipe avec un
// emoji animé, pour vérifier le repli de la réponse directe du bot.
const gate = vi.hoisted(() => ({
  text: 'C\'est fait <tg-emoji emoji-id="5368324170671202286">🎉</tg-emoji> !',
}));
vi.mock("../join-flow/service", async (importOriginal) => ({
  ...(await importOriginal<typeof JoinFlowService>()),
  handleGateStart: vi.fn(async () => ({ text: gate.text, buttons: [] })),
}));

const identity: BotIdentity = {
  id: "bot_1",
  name: "CasinoBot",
  username: "casinobot",
  telegramBotId: 111n,
  vertical: "CASINO",
};
const from = { id: 42, is_bot: false, first_name: "Mathéo", language_code: "fr" };
const privateChat = { id: 42, type: "private" as const, first_name: "Mathéo" };
const channel = { id: -1009999, type: "channel" as const, title: "Canal VIP" };
const FR = MESSAGES.fr;

const ce = (offset: number, length: number, id: string): MessageEntity =>
  ({ type: "custom_emoji", offset, length, custom_emoji_id: id }) as MessageEntity;

function makeDeps(
  opts: {
    platformUser?: boolean;
    outcome?: CustomEmojiAddOutcome;
    fail?: boolean;
    knownChannelId?: string | null;
  } = {},
) {
  return {
    recordUpdate: vi.fn(async () => undefined),
    memberStarted: vi.fn(async () => ({ memberId: "m1" })),
    memberSeen: vi.fn(async () => ({ memberId: "m1" })),
    memberDmStatus: vi.fn(async () => undefined),
    upsertChannel: vi.fn(async () => ({ channelId: "c_vip", created: true })),
    findChannelId: vi.fn(async (): Promise<string | null> => opts.knownChannelId ?? null),
    setChannelAdmin: vi.fn(async () => undefined),
    revokeChannelAdmin: vi.fn(async () => undefined),
    listOurBotTelegramIds: vi.fn(async () => [111n]),
    initPrimaryBot: vi.fn(async () => undefined),
    linkAdminAccount: vi.fn(async () => null),
    isPlatformUser: vi.fn(async () => opts.platformUser ?? true),
    isAdminDialogPartner: vi.fn(async () => false),
    auditChannel: vi.fn(async () => undefined),
    addCustomEmojis: vi.fn(
      async (input: {
        emojis: Array<{ customEmojiId: string }>;
      }): Promise<CustomEmojiAddOutcome> => {
        if (opts.fail) throw new Error("base indisponible");
        return (
          opts.outcome ?? {
            added: input.emojis.map((e) => e.customEmojiId),
            restored: [],
            already: [],
          }
        );
      },
    ),
  } satisfies TelegramDeps;
}

/**
 * Liste des administrateurs que Telegram renvoie au bot : « ours » = notre bot y figure ; « others » = liste lisible sans
 * aucun de nos bots ; « denied » = liste inaccessible (notre bot n'est pas administrateur du canal).
 */
type AdminsMode = "ours" | "others" | "denied";

function makeBot(deps: TelegramDeps, admins: AdminsMode = "ours") {
  const bot = new Bot("111:TEST", { botInfo: botInfoFromRecord(identity) });
  const apiCalls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  bot.api.config.use(async (_prev, method, payload) => {
    apiCalls.push({ method, payload: payload as Record<string, unknown> });
    if (method === "getChat")
      return { ok: true, result: { ...channel, username: "canalvip" } } as never;
    if (method === "getChatAdministrators" && admins === "denied")
      return {
        ok: false,
        error_code: 400,
        description: "Bad Request: member list is inaccessible",
      } as never;
    if (method === "getChatAdministrators" && admins === "others")
      return {
        ok: true,
        result: [
          {
            status: "creator",
            user: { id: 555, is_bot: false, first_name: "Propriétaire" },
            is_anonymous: false,
          },
        ],
      } as never;
    if (method === "getChatAdministrators")
      return {
        ok: true,
        result: [
          {
            status: "administrator",
            user: { id: 111, is_bot: true, first_name: "CasinoBot", username: "casinobot" },
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
    return { ok: true, result: { message_id: 1, date: 0, chat: privateChat, text: "ok" } } as never;
  });
  registerHandlers(bot, identity, deps, { extended: false });
  return { bot, apiCalls };
}

let nextId = 500;
function messageUpdate(extra: Record<string, unknown>): Update {
  return {
    update_id: nextId++,
    message: { message_id: nextId, date: 1, chat: privateChat, from, ...extra } as never,
  };
}

const TEXT = "Top 🔥 et 🎁 et 🔥";
const ENTITIES = [
  ce(4, 2, "5368324170671202286"),
  ce(10, 2, "5361111111111111111"),
  ce(16, 2, "5368324170671202286"),
];
const replies = (calls: Array<{ method: string; payload: Record<string, unknown> }>) =>
  calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));

describe("ajout d'emojis animés par message au bot", () => {
  it("message d'un utilisateur de la plateforme : emojis enregistrés une fois chacun, réponse, aucune aide", async () => {
    const deps = makeDeps();
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate(messageUpdate({ text: TEXT, entities: ENTITIES }));
    expect(deps.addCustomEmojis).toHaveBeenCalledTimes(1);
    expect(deps.addCustomEmojis.mock.calls[0]![0]).toEqual({
      emojis: [
        { customEmojiId: "5368324170671202286", fallback: "🔥" },
        { customEmojiId: "5361111111111111111", fallback: "🎁" },
      ],
      telegramUserId: 42n,
      botId: "bot_1",
    });
    expect(replies(apiCalls)).toEqual([
      "2 emojis animés ajoutés ✅\n\nRetrouvez-les sur le site : Messages → Emojis animés.",
    ]);
    const reply = apiCalls.find((c) => c.method === "sendMessage")!;
    expect(reply.payload.reply_parameters).toMatchObject({ allow_sending_without_reply: true });
    expect(reply.payload.parse_mode).toBeUndefined();
  });

  it("message transféré depuis une personne : emojis ajoutés, pas d'aide « transférer un message de canal »", async () => {
    const deps = makeDeps({ outcome: { added: ["1"], restored: [], already: ["2", "3"] } });
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate(
      messageUpdate({
        text: TEXT,
        entities: ENTITIES,
        forward_origin: { type: "hidden_user", sender_user_name: "Quelqu'un", date: 1 },
      }),
    );
    expect(replies(apiCalls)).toEqual([
      "1 emoji animé ajouté ✅\n2 déjà dans la bibliothèque\n\nRetrouvez-les sur le site : Messages → Emojis animés.",
    ]);
    expect(replies(apiCalls).some((t) => t === FR.forwardHelp)).toBe(false);
  });

  it("légende d'une photo transférée depuis un canal : emojis ajoutés ET canal ajouté (comportement de la phase 8)", async () => {
    const deps = makeDeps();
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate(
      messageUpdate({
        photo: [{ file_id: "P", file_unique_id: "U", width: 1, height: 1 }],
        caption: "😀 promo",
        caption_entities: [ce(0, 2, "777")],
        forward_origin: { type: "channel", chat: channel, message_id: 5, date: 1 },
      }),
    );
    expect(deps.addCustomEmojis.mock.calls[0]![0].emojis).toEqual([
      { customEmojiId: "777", fallback: "😀" },
    ]);
    expect(deps.upsertChannel).toHaveBeenCalledTimes(1);
    const texts = replies(apiCalls);
    expect(texts[0]).toMatch(/^1 emoji animé ajouté ✅/);
    expect(texts[1]).toMatch(/Canal « Canal VIP » ajouté ✅/);
  });

  it("transfert depuis le canal de quelqu'un d'autre : seuls les emojis sont ajoutés, aucun canal créé, une seule réponse", async () => {
    for (const mode of ["denied", "others"] as const) {
      const deps = makeDeps();
      const { bot, apiCalls } = makeBot(deps, mode);
      await bot.handleUpdate(
        messageUpdate({
          text: TEXT,
          entities: ENTITIES,
          forward_origin: { type: "channel", chat: channel, message_id: 5, date: 1 },
        }),
      );
      expect(deps.addCustomEmojis).toHaveBeenCalledTimes(1);
      expect(deps.upsertChannel).not.toHaveBeenCalled();
      expect(deps.auditChannel).not.toHaveBeenCalled();
      expect(deps.findChannelId).toHaveBeenCalledWith(channel.id);
      expect(replies(apiCalls)).toEqual([
        "2 emojis animés ajoutés ✅\n\nRetrouvez-les sur le site : Messages → Emojis animés.\n\n" +
          "Le canal d'origine n'a pas été ajouté à la plateforme. Si c'est l'un de vos canaux : nommez @casinobot " +
          "administrateur, puis transférez-moi de nouveau un de ses messages.",
      ]);
    }
  });

  it("album transféré depuis un canal tiers : les autres photos de l'album n'ajoutent pas le canal non plus", async () => {
    const deps = makeDeps();
    const { bot, apiCalls } = makeBot(deps, "denied");
    const origin = { type: "channel", chat: channel, message_id: 5, date: 1 };
    const photo = [{ file_id: "P", file_unique_id: "U", width: 1, height: 1 }];
    await bot.handleUpdate(
      messageUpdate({
        media_group_id: "album-1",
        photo,
        caption: "😀 promo",
        caption_entities: [ce(0, 2, "777")],
        forward_origin: origin,
      }),
    );
    await bot.handleUpdate(
      messageUpdate({ media_group_id: "album-1", photo, forward_origin: origin }),
    );
    expect(deps.addCustomEmojis).toHaveBeenCalledTimes(1);
    expect(deps.upsertChannel).not.toHaveBeenCalled();
    expect(replies(apiCalls)).toHaveLength(1);
  });

  it("canal déjà sur la plateforme : emojis ajoutés ET canal mis à jour, même si ce bot n'en lit pas la liste", async () => {
    const deps = makeDeps({ knownChannelId: "c_vip" });
    const { bot, apiCalls } = makeBot(deps, "denied");
    await bot.handleUpdate(
      messageUpdate({
        text: TEXT,
        entities: ENTITIES,
        forward_origin: { type: "channel", chat: channel, message_id: 5, date: 1 },
      }),
    );
    expect(deps.addCustomEmojis).toHaveBeenCalledTimes(1);
    expect(deps.upsertChannel).toHaveBeenCalledTimes(1);
    expect(replies(apiCalls)[0]).toBe(
      "2 emojis animés ajoutés ✅\n\nRetrouvez-les sur le site : Messages → Emojis animés.",
    );
  });

  it("un autre de nos bots est administrateur (vérifié avec son propre jeton) : le canal est ajouté aussi", async () => {
    const isOurBotAdminOf = vi.fn(async () => true);
    const deps = { ...makeDeps(), isOurBotAdminOf };
    const { bot } = makeBot(deps, "denied");
    await bot.handleUpdate(
      messageUpdate({
        text: TEXT,
        entities: ENTITIES,
        forward_origin: { type: "channel", chat: channel, message_id: 5, date: 1 },
      }),
    );
    expect(isOurBotAdminOf).toHaveBeenCalledWith(channel.id, identity.telegramBotId);
    expect(deps.upsertChannel).toHaveBeenCalledTimes(1);
  });

  it("aucun de nos autres bots n'est administrateur non plus : aucun canal créé", async () => {
    const isOurBotAdminOf = vi.fn(async () => false);
    const deps = { ...makeDeps(), isOurBotAdminOf };
    const { bot } = makeBot(deps, "denied");
    await bot.handleUpdate(
      messageUpdate({
        text: TEXT,
        entities: ENTITIES,
        forward_origin: { type: "channel", chat: channel, message_id: 5, date: 1 },
      }),
    );
    expect(isOurBotAdminOf).toHaveBeenCalledTimes(1);
    expect(deps.upsertChannel).not.toHaveBeenCalled();
  });

  it("expéditeur inconnu : rien n'est enregistré, comportement habituel (aucune réponse)", async () => {
    const deps = makeDeps({ platformUser: false });
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate(messageUpdate({ text: TEXT, entities: ENTITIES }));
    await bot.handleUpdate(
      messageUpdate({
        text: TEXT,
        entities: ENTITIES,
        forward_origin: { type: "channel", chat: channel, message_id: 5, date: 1 },
      }),
    );
    expect(deps.addCustomEmojis).not.toHaveBeenCalled();
    expect(deps.upsertChannel).not.toHaveBeenCalled();
    expect(replies(apiCalls)).toEqual([]);
  });

  it("sans emoji animé ou commande : le traitement habituel continue", async () => {
    const deps = makeDeps();
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate(messageUpdate({ text: "Bonjour" }));
    await bot.handleUpdate(
      messageUpdate({
        text: "/start 😀",
        entities: [{ type: "bot_command", offset: 0, length: 6 }, ce(7, 2, "1")],
      }),
    );
    expect(deps.addCustomEmojis).not.toHaveBeenCalled();
    const texts = replies(apiCalls);
    expect(texts[0]).toBe(FR.forwardHelp);
    expect(texts[1]).toContain("Bonjour");
  });

  it("déjà tous dans la bibliothèque, et échec d'enregistrement : réponses claires", async () => {
    const already = makeDeps({ outcome: { added: [], restored: [], already: ["1"] } });
    const a = makeBot(already);
    await a.bot.handleUpdate(messageUpdate({ text: "😀", entities: [ce(0, 2, "1")] }));
    expect(replies(a.apiCalls)[0]).toMatch(/^Cet emoji animé est déjà dans la bibliothèque ✅/);

    const failing = makeDeps({ fail: true });
    const f = makeBot(failing);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await f.bot.handleUpdate(messageUpdate({ text: "😀", entities: [ce(0, 2, "1")] }));
    err.mockRestore();
    expect(replies(f.apiCalls)[0]).toMatch(/Impossible d'ajouter ces emojis animés/);
  });
});

// ---------------------------------------------------------------------------------------------
// Réponses directes du bot (webhook) avec emojis animés : repli immédiat si Telegram les refuse.
// ---------------------------------------------------------------------------------------------

const REFUSAL = {
  ok: false,
  error_code: 400,
  description: 'Bad Request: can\'t parse entities: Unsupported start tag "tg-emoji"',
};

function refusingBot(register: (bot: Bot) => void, refuse = true) {
  const bot = new Bot("111:TEST", { botInfo: botInfoFromRecord(identity) });
  const apiCalls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  bot.api.config.use(async (_prev, method, payload) => {
    const p = payload as Record<string, unknown>;
    apiCalls.push({ method, payload: p });
    const content = String(p.text ?? p.caption ?? "");
    if (refuse && /^(sendMessage|sendPhoto)$/.test(method) && content.includes("<tg-emoji"))
      return REFUSAL as never;
    return {
      ok: true,
      result: { message_id: 3, date: 0, chat: privateChat, text: content },
    } as never;
  });
  register(bot);
  registerHandlers(bot, identity, makeDeps(), { extended: false });
  return { bot, apiCalls };
}

function offerDeps(overrides: Partial<OfferDeps> = {}) {
  return {
    memberStarted: vi.fn(async () => ({ memberId: "m1" })),
    resolveOffer: vi.fn(async () => ({
      trackingLinkId: "tl1",
      destinationTemplate: "https://linkaffi.me/go/k?sub_id={subid}",
      postId: null,
      channelId: "c1",
      channelLanguage: "fr",
    })),
    recordOfferClick: vi.fn(async () => ({ clickId: "click1" })),
    offerReplyTexts: vi.fn(async () => ({
      text: 'Ton bonus {prenom} <tg-emoji emoji-id="5368324170671202286">🎁</tg-emoji>',
      button: "Go",
    })),
    recordEvent: vi.fn(async () => undefined),
    ...overrides,
  } satisfies OfferDeps;
}

const offerStart = (): Update => ({
  update_id: nextId++,
  message: {
    message_id: nextId,
    date: 1,
    chat: privateChat,
    from,
    text: "/start oabc12345",
    entities: [{ type: "bot_command", offset: 0, length: 6 }],
  } as never,
});

describe("réponse d'offre avec emojis animés", () => {
  it("refusée par Telegram : renvoyée aussitôt avec l'emoji de remplacement, même bouton, journalisée", async () => {
    const deps = offerDeps();
    const { bot, apiCalls } = refusingBot((b) => registerOfferHandlers(b, identity, deps));
    await bot.handleUpdate(offerStart());
    const sends = apiCalls.filter((c) => c.method === "sendMessage");
    expect(sends.map((c) => c.payload.text)).toEqual([
      'Ton bonus Mathéo <tg-emoji emoji-id="5368324170671202286">🎁</tg-emoji>',
      "Ton bonus Mathéo 🎁",
    ]);
    expect(sends[1]!.payload.parse_mode).toBe("HTML");
    expect(sends[1]!.payload.reply_markup).toEqual(sends[0]!.payload.reply_markup);
    expect(deps.recordEvent).toHaveBeenCalledWith({
      type: "dm.custom_emoji_fallback",
      memberId: "m1",
      botId: "bot_1",
      payload: {
        outboundMessageId: null,
        botId: "bot_1",
        error: REFUSAL.description,
        resent: true,
        via: "offer_reply",
      },
    });
  });

  it("acceptée : envoyée telle quelle, sans journal de repli", async () => {
    const deps = offerDeps();
    const { bot, apiCalls } = refusingBot((b) => registerOfferHandlers(b, identity, deps), false);
    await bot.handleUpdate(offerStart());
    const sends = apiCalls.filter((c) => c.method === "sendMessage");
    expect(sends).toHaveLength(1);
    expect(String(sends[0]!.payload.text)).toContain("<tg-emoji");
    // La réponse simulée n'a pas d'entité : Telegram aurait retiré l'emoji → signalé sans renvoi.
    expect(deps.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "dm.custom_emoji_fallback",
        payload: expect.objectContaining({ resent: false }),
      }),
    );
  });

  it("légende d'un média refusée : média renvoyé avec la légende de remplacement", async () => {
    const deps = offerDeps({
      offerReplyTexts: vi.fn(async () => ({
        text: 'Photo <tg-emoji emoji-id="1">⭐</tg-emoji>',
        button: "Go",
        media: { fileId: "PHOTO", kind: "photo" as const },
      })),
    });
    const { bot, apiCalls } = refusingBot((b) => registerOfferHandlers(b, identity, deps));
    await bot.handleUpdate(offerStart());
    const photos = apiCalls.filter((c) => c.method === "sendPhoto");
    expect(photos.map((c) => c.payload.caption)).toEqual([
      'Photo <tg-emoji emoji-id="1">⭐</tg-emoji>',
      "Photo ⭐",
    ]);
    expect(apiCalls.filter((c) => c.method === "sendMessage")).toHaveLength(0);
  });

  it("légende longue avec plusieurs emojis animés : mesurée en caractères visibles, le média part", async () => {
    // 990 caractères visibles + 8 emojis animés = 998 caractères pour Telegram, mais plus de 1300 en HTML brut.
    const tag = (i: number) => `<tg-emoji emoji-id="536832417067120${1000 + i}">🎁</tg-emoji>`;
    const caption = "x".repeat(982) + Array.from({ length: 8 }, (_, i) => tag(i)).join("");
    expect(caption.length).toBeGreaterThan(1024);
    const deps = offerDeps({
      offerReplyTexts: vi.fn(async () => ({
        text: caption,
        button: "Go",
        media: { fileId: "PHOTO", kind: "photo" as const },
      })),
    });
    const { bot, apiCalls } = refusingBot((b) => registerOfferHandlers(b, identity, deps), false);
    await bot.handleUpdate(offerStart());
    const photos = apiCalls.filter((c) => c.method === "sendPhoto");
    expect(photos).toHaveLength(1);
    expect(photos[0]!.payload.caption).toBe(caption);
    expect(apiCalls.filter((c) => c.method === "sendMessage")).toHaveLength(0);
  });

  it("légende trop longue en caractères visibles : texte seul, comme avant", async () => {
    const deps = offerDeps({
      offerReplyTexts: vi.fn(async () => ({
        text: "y".repeat(1025),
        button: "Go",
        media: { fileId: "PHOTO", kind: "photo" as const },
      })),
    });
    const { bot, apiCalls } = refusingBot((b) => registerOfferHandlers(b, identity, deps), false);
    await bot.handleUpdate(offerStart());
    expect(apiCalls.filter((c) => c.method === "sendPhoto")).toHaveLength(0);
    expect(apiCalls.filter((c) => c.method === "sendMessage")).toHaveLength(1);
  });
});

describe("réponse « ✅ J'ai rejoint » avec emojis animés", () => {
  const joinDeps = {
    upsertMember: vi.fn(async () => ({ memberId: "m7", languageCode: "fr", firstName: "Mathéo" })),
    recordEvent: vi.fn(async () => undefined),
  } as unknown as JoinFlowDeps;

  beforeEach(() => vi.mocked(joinDeps.recordEvent).mockClear());

  it("refusée : renvoyée avec l'emoji de remplacement et journalisée", async () => {
    const { bot, apiCalls } = refusingBot((b) => registerJoinFlowHandlers(b, identity, joinDeps));
    await bot.handleUpdate({
      update_id: nextId++,
      message: {
        message_id: nextId,
        date: 1,
        chat: privateChat,
        from,
        text: "/start gAbC1234",
        entities: [{ type: "bot_command", offset: 0, length: 6 }],
      } as never,
    });
    const sends = apiCalls.filter((c) => c.method === "sendMessage").map((c) => c.payload.text);
    expect(sends).toEqual([gate.text, "C'est fait 🎉 !"]);
    expect(joinDeps.recordEvent).toHaveBeenCalledWith({
      type: "dm.custom_emoji_fallback",
      memberId: "m7",
      botId: "bot_1",
      payload: expect.objectContaining({
        outboundMessageId: null,
        resent: true,
        via: "gate_start",
      }),
    });
  });
});

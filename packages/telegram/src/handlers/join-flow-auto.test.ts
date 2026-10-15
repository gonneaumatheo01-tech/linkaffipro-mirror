/**
 * Phase 14 (demandes bloquées sur « Attend les canaux ») : validation automatique quand les canaux obligatoires sont
 * rejoints, bouton à rappel « ✅ J'ai rejoint », rappel à l'heure, « Canaux rejoints » seulement si le bot peut encore
 * écrire. Mises à jour Telegram simulées, sans base.
 */
import { describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update } from "grammy/types";
import { botInfoFromRecord } from "../factory";
import type { BotIdentity } from "../ports";
import type { ChannelInfo, JoinFlowDeps, MembershipInfo } from "../join-flow/deps";
import type { GateLinkApi } from "../join-flow/gate-links";
import type { BotStateLike } from "../join-flow/reachability";
import { IMPLICIT_RULE, type RuleData } from "../join-flow/rules";
import { handleChatMember } from "../join-flow/service";
import { registerJoinFlowHandlers } from "./join-flow";

const identity: BotIdentity = {
  id: "bot_1",
  name: "DatingBot",
  username: "datingbot",
  telegramBotId: 111n,
  vertical: "DATING",
};
const channel = (id: string, title: string, chatId: bigint, isActive = true): ChannelInfo => ({
  id,
  title,
  username: null,
  language: "fr",
  telegramChatId: chatId,
  primaryBotId: "bot_1",
  isActive,
});
const ZONE = channel("cZone", "Zone Interdite", -100700n);
const ROULETTE = channel("cRoul", "LA ZONE ROULETTE", -100701n);
const TIR = channel("cTir", "TIR CADRÉ", -100702n);
const AUTRE = channel("cAutre", "Autre canal", -100703n);
const PAUSE = channel("cPause", "Canal en pause", -100704n, false);
const CHANNELS = [ZONE, ROULETTE, TIR, AUTRE, PAUSE];

/** Zone : canaux obligatoires Roulette et Tir, acceptation 5 minutes après, rappels à 4 minutes et 1 heure. */
const ZONE_RULE: RuleData = {
  ...IMPLICIT_RULE,
  id: "r_zone",
  name: "Règle par défaut",
  mode: "DELAY",
  delaySeconds: 300,
  gateMode: "REQUIRED",
  gateChannelIds: ["cRoul", "cTir"],
  reminderAfterMinutes: [4, 60],
  maxReminders: 2,
};
const OPEN: RuleData = { ...IMPLICIT_RULE, id: "r_open", name: "Immédiat" };

type Membership = MembershipInfo & { gateSatisfiedAt?: Date; expiresAt?: Date | null };

function makeWorld(
  opts: {
    rules?: Record<string, RuleData>;
    /** Statut Telegram de chaque (canal, personne) : « member », « left »… (défaut « left »). */
    members?: Record<string, string>;
    botStates?: Record<string, BotStateLike>;
  } = {},
) {
  const rules = { cZone: ZONE_RULE, cRoul: OPEN, cTir: OPEN, cAutre: OPEN, ...opts.rules };
  const members = { ...opts.members };
  const st = {
    memberships: [] as Membership[],
    dms: [] as Array<{ kind: string; text: string; buttons: unknown[][]; chatId: bigint | null }>,
    events: [] as Array<{ type: string; payload: Record<string, unknown> }>,
    reminders: [] as Array<{ membershipId: string; index: number; at: Date }>,
    canDm: [] as Array<[string, boolean]>,
    botStates: { ...opts.botStates } as Record<string, BotStateLike>,
  };
  const ruleOf = (m: Pick<MembershipInfo, "channelId">): RuleData => {
    const r = rules[m.channelId as keyof typeof rules] ?? OPEN;
    return { ...r, gateChannelIds: r.gateChannelIds.filter((id) => id !== m.channelId) };
  };
  const deps: JoinFlowDeps = {
    upsertMember: async (u) => ({
      memberId: `m${u.id}`,
      languageCode: u.language_code ?? "fr",
      firstName: u.first_name,
    }),
    findChannelByChatId: async (id) => CHANNELS.find((c) => c.telegramChatId === id) ?? null,
    getChannels: async (ids) =>
      ids.map((id) => CHANNELS.find((c) => c.id === id)).filter((c): c is ChannelInfo => !!c),
    actingBotIdFor: async () => ({ botId: "bot_1" }),
    findInviteLinkByUrl: async () => null,
    resolveRule: async (channelId) => ruleOf({ channelId }),
    createMembership: async (d) => {
      const m: Membership = { ...d, id: `ms${st.memberships.length + 1}`, remindersSent: 0 };
      m.telegramUserId = BigInt(d.memberId.slice(1));
      st.memberships.push(m);
      return { id: m.id };
    },
    updateMembership: async (id, data) => {
      const m = st.memberships.find((x) => x.id === id);
      if (m) Object.assign(m, data);
    },
    updateMembershipIfStatus: async (id, expected, data) => {
      const m = st.memberships.find((x) => x.id === id);
      if (!m || m.status !== expected) return false;
      Object.assign(m, data);
      return true;
    },
    findPendingGateMemberships: async (memberId) =>
      st.memberships.filter((m) => m.memberId === memberId && m.status === "PENDING_GATE"),
    scheduleReminder: async (r) => {
      st.reminders.push(r);
    },
    botState: async (memberId, botId) => st.botStates[`${memberId}:${botId}`] ?? null,
    findMembershipByCode: async (code) => st.memberships.find((m) => m.code === code) ?? null,
    findMembershipById: async (id) => st.memberships.find((m) => m.id === id) ?? null,
    findLatestMembership: async (memberId, channelId) =>
      [...st.memberships]
        .reverse()
        .find((m) => m.memberId === memberId && m.channelId === channelId) ?? null,
    getRuleForMembership: async (m) => ruleOf(m),
    lastWelcomeAt: async () => null,
    incrementInviteLink: async () => undefined,
    findGateLink: async (_src, gateId) => `https://t.me/+gate_${gateId}`,
    saveGateLink: async () => undefined,
    requestedChannelIds: async (memberId, ids) =>
      ids.filter((id) => {
        const last = [...st.memberships]
          .reverse()
          .find((m) => m.memberId === memberId && m.channelId === id);
        return (
          !!last && ["REQUESTED", "PENDING_GATE", "SCHEDULED", "APPROVED"].includes(last.status)
        );
      }),
    adminBots: async () => [{ botId: "bot_1", username: "datingbot", canInvite: true }],
    apiFor: async () => null,
    warn: () => undefined,
    getMember: async (memberId) => ({ memberId, languageCode: "fr", firstName: "Jean" }),
    getBotIdentity: async (id) => (id === identity.id ? identity : null),
    canWriteTo: async () => false,
    getSequenceText: async () => null,
    enqueueDm: async (i) => {
      st.dms.push({ kind: i.kind, text: i.text, buttons: i.buttons, chatId: i.chatId });
      return { outboundMessageId: `om${st.dms.length}` };
    },
    setCanDm: async (m, b, v) => {
      st.canDm.push([m, v]);
      st.botStates[`${m}:${b}`] = { canDm: v, startedAt: v ? new Date() : null, blockedAt: null };
    },
    recordEvent: async (e) => {
      st.events.push({ type: e.type, payload: (e.payload ?? {}) as Record<string, unknown> });
    },
  };

  const bot = new Bot("111:TEST", { botInfo: botInfoFromRecord(identity) });
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  /** Réponse forcée d'une méthode (erreur Telegram simulée). */
  const failures: Record<string, { error_code: number; description: string }> = {};
  /** Action jouée une fois pendant le prochain appel getChatMember du bot (mise à jour traitée en même temps). */
  const hooks: { getChatMember: (() => Promise<void>) | null } = { getChatMember: null };
  bot.api.config.use(async (_prev, method, payload) => {
    const p = payload as Record<string, unknown>;
    calls.push({ method, payload: p });
    const fail = failures[method];
    if (fail) return { ok: false, ...fail } as never;
    if (method === "getChatMember" && hooks.getChatMember) {
      const hook = hooks.getChatMember;
      hooks.getChatMember = null;
      await hook();
    }
    if (method === "getChatMember") {
      const chat = CHANNELS.find((c) => Number(c.telegramChatId) === Number(p.chat_id));
      const status = members[`${chat?.id}:${p.user_id}`] ?? "left";
      return {
        ok: true,
        result: { status, user: { id: p.user_id, is_bot: false, first_name: "Jean" } },
      } as never;
    }
    if (method === "sendMessage" || method === "editMessageText" || method === "editMessageCaption")
      return {
        ok: true,
        result: {
          message_id: 77,
          date: 1,
          chat: { id: 42, type: "private", first_name: "Jean" },
          text: String(p.text ?? p.caption ?? ""),
        },
      } as never;
    return { ok: true, result: true } as never;
  });
  registerJoinFlowHandlers(bot, identity, deps, {
    upsertChannel: vi.fn(async () => ({ channelId: "c_new", created: true })),
    findChannelId: vi.fn(async () => null),
    setChannelAdmin: vi.fn(async () => undefined),
    revokeChannelAdmin: vi.fn(async () => undefined),
    listOurBotTelegramIds: vi.fn(async () => [111n]),
  });
  /** API d'un autre traitement (autre mise à jour, worker) : mêmes membres, sans les crochets ni le journal du bot. */
  const otherApi: GateLinkApi = {
    createChatInviteLink: async () => ({ invite_link: "https://t.me/+autre" }),
    getChatMember: async (chatId, userId) => {
      const chat = CHANNELS.find((c) => Number(c.telegramChatId) === Number(chatId));
      return { status: members[`${chat?.id}:${userId}`] ?? "left" };
    },
  };
  return { bot, deps, st, calls, members, failures, hooks, otherApi };
}

const from = (id = 42) => ({ id, is_bot: false, first_name: "Jean", language_code: "fr" });
const nowSec = () => Math.floor(Date.now() / 1000);

function joinRequest(c: ChannelInfo, opts: { userId?: number; date?: number } = {}): Update {
  const userId = opts.userId ?? 42;
  return {
    update_id: 1,
    chat_join_request: {
      chat: { id: Number(c.telegramChatId), type: "channel", title: c.title },
      from: from(userId),
      user_chat_id: userId,
      date: opts.date ?? nowSec(),
    },
  } as Update;
}

function joined(c: ChannelInfo, userId = 42): Update {
  const user = from(userId);
  return {
    update_id: 2,
    chat_member: {
      chat: { id: Number(c.telegramChatId), type: "channel", title: c.title },
      from: user,
      date: nowSec(),
      old_chat_member: { status: "left", user },
      new_chat_member: { status: "member", user },
    },
  } as Update;
}

function pressed(
  data: string,
  opts: { userId?: number; media?: boolean; inaccessible?: boolean } = {},
): Update {
  const userId = opts.userId ?? 42;
  const chat = { id: userId, type: "private" as const, first_name: "Jean" };
  const message = opts.inaccessible
    ? { message_id: 55, date: 0, chat }
    : opts.media
      ? {
          message_id: 55,
          date: 1,
          chat,
          photo: [{ file_id: "p", file_unique_id: "u", width: 1, height: 1 }],
          caption: "Accueil",
        }
      : { message_id: 55, date: 1, chat, text: "Accueil" };
  return {
    update_id: 3,
    callback_query: { id: "cb1", from: from(userId), chat_instance: "ci", data, message },
  } as Update;
}

function startG(code: string): Update {
  return {
    update_id: 4,
    message: {
      message_id: 9,
      date: nowSec(),
      chat: { id: 42, type: "private", first_name: "Jean" },
      from: from(),
      text: `/start g${code}`,
      entities: [{ type: "bot_command", offset: 0, length: 6 }],
    },
  } as Update;
}

const zoneOf = (st: { memberships: Membership[] }) =>
  st.memberships.find((m) => m.channelId === "cZone")!;
const autoEvents = (st: { events: Array<{ type: string; payload: Record<string, unknown> }> }) =>
  st.events.filter((e) => e.type === "membership.gate_satisfied");

describe("validation automatique : demande ou entrée dans un canal obligatoire", () => {
  it("demande dans le 2e canal obligatoire → acceptation programmée, sans « ✅ J'ai rejoint »", async () => {
    const { bot, st, calls } = makeWorld();
    await bot.handleUpdate(joinRequest(ZONE));
    const zone = zoneOf(st);
    expect(zone.status).toBe("PENDING_GATE");

    // 1er canal obligatoire : Tir encore à rejoindre (Telegram répond « left »), la demande attend toujours.
    await bot.handleUpdate(joinRequest(ROULETTE));
    expect(zoneOf(st).status).toBe("PENDING_GATE");
    expect(calls.filter((c) => c.method === "getChatMember").map((c) => c.payload.chat_id)).toEqual(
      [Number(TIR.telegramChatId)],
    );

    // 2e canal obligatoire : les deux demandes à nous comptent, aucun appel de plus.
    const before = calls.filter((c) => c.method === "getChatMember").length;
    await bot.handleUpdate(joinRequest(TIR));
    expect(calls.filter((c) => c.method === "getChatMember")).toHaveLength(before);
    const z = zoneOf(st);
    expect(z.status).toBe("SCHEDULED");
    expect(z.gateSatisfiedAt).toBeInstanceOf(Date);
    expect(z.approveAt!.getTime() - z.gateSatisfiedAt!.getTime()).toBe(300_000);
    expect(autoEvents(st).map((e) => e.payload)).toEqual([
      expect.objectContaining({
        membershipId: z.id,
        auto: true,
        trigger: "join_request",
        requested: ["cRoul", "cTir"],
      }),
    ]);
    // Demande de moins de 5 minutes : le bot peut encore écrire, message « Canaux rejoints ».
    const done = st.dms.filter((d) => d.kind === "GATE_REMINDER");
    expect(done.map((d) => d.text)).toEqual([
      "C'est bon Jean, tu seras accepté dans <b>Zone Interdite</b> dans 5 minutes.",
    ]);
    expect(done[0]!.chatId).toBe(42n);
    // Le message « Canaux rejoints » est repérable (rangé avec les rappels en base, faute de type dédié) : son
    // identifiant est dans l'événement, pour que la fiche membre l'affiche sous son vrai nom.
    expect(autoEvents(st)[0]!.payload.outboundMessageId).toBe(`om${st.dms.indexOf(done[0]!) + 1}`);
  });

  it("entrée directe dans un canal obligatoire (chat_member) : validée si l'autre canal est rejoint", async () => {
    const { bot, st } = makeWorld({ members: { "cRoul:42": "member" } });
    await bot.handleUpdate(joinRequest(ZONE));
    await bot.handleUpdate(joined(TIR));
    expect(zoneOf(st).status).toBe("SCHEDULED");
    expect(autoEvents(st)[0]!.payload).toMatchObject({ auto: true, trigger: "joined" });
  });

  it("entrée dans un canal obligatoire désactivé chez nous : compte quand même", async () => {
    const { bot, st } = makeWorld({
      rules: { cZone: { ...ZONE_RULE, gateChannelIds: ["cRoul", "cPause"] } },
      members: { "cRoul:42": "member" },
    });
    await bot.handleUpdate(joinRequest(ZONE));
    await bot.handleUpdate(joined(PAUSE));
    expect(zoneOf(st).status).toBe("SCHEDULED");
    // Le flux d'adhésion ignore toujours ce canal : aucune demande enregistrée pour lui.
    expect(st.memberships.filter((m) => m.channelId === "cPause")).toEqual([]);
  });

  it("un seul canal rejoint, ou un canal sans rapport : la demande attend toujours", async () => {
    const { bot, st, calls } = makeWorld();
    await bot.handleUpdate(joinRequest(ZONE));
    await bot.handleUpdate(joinRequest(AUTRE));
    expect(calls.filter((c) => c.method === "getChatMember")).toHaveLength(0);
    await bot.handleUpdate(joined(TIR));
    expect(zoneOf(st).status).toBe("PENDING_GATE");
    expect(autoEvents(st)).toEqual([]);
  });

  it("« Canaux rejoints » jamais envoyé à une personne injoignable (demande de plus de 5 minutes, jamais démarré)", async () => {
    const { bot, st } = makeWorld({ members: { "cRoul:42": "member" } });
    await bot.handleUpdate(joinRequest(ZONE, { date: nowSec() - 10 * 60 }));
    await bot.handleUpdate(joinRequest(TIR));
    expect(zoneOf(st).status).toBe("SCHEDULED");
    expect(st.dms.filter((d) => d.kind === "GATE_REMINDER")).toEqual([]);
    expect(st.events.find((e) => e.type === "dm.skipped_unreachable")?.payload).toEqual({
      membershipId: zoneOf(st).id,
      kind: "GATE_SATISFIED",
      reason: "never_started",
    });
    // Ordre du journal : canaux rejoints, puis message non envoyé ; aucun message à repérer.
    const types = st.events.map((e) => e.type);
    expect(types.indexOf("membership.gate_satisfied")).toBeLessThan(
      types.indexOf("dm.skipped_unreachable"),
    );
    expect(autoEvents(st)[0]!.payload.outboundMessageId).toBeNull();
  });

  it("personne qui a démarré le bot : « Canaux rejoints » même longtemps après la demande", async () => {
    const { bot, st } = makeWorld({
      members: { "cRoul:42": "member" },
      botStates: { "m42:bot_1": { canDm: true, startedAt: new Date(), blockedAt: null } },
    });
    await bot.handleUpdate(joinRequest(ZONE, { date: nowSec() - 3600 }));
    await bot.handleUpdate(joinRequest(TIR));
    expect(st.dms.filter((d) => d.kind === "GATE_REMINDER")).toHaveLength(1);
  });
});

describe("bouton à rappel « ✅ J'ai rejoint » (g:<code>)", () => {
  it("accueil avec canaux obligatoires : bouton à rappel, rappel à 4 minutes programmé à l'heure", async () => {
    const { bot, st } = makeWorld();
    const date = nowSec();
    await bot.handleUpdate(joinRequest(ZONE, { date }));
    const zone = zoneOf(st);
    const welcome = st.dms.find((d) => d.kind === "WELCOME")!;
    expect(welcome.buttons.at(-1)).toEqual([
      { text: "✅ J'ai rejoint", callbackData: `g:${zone.code}` },
    ]);
    // Seul le rappel de moins de 5 minutes est une tâche à l'heure ; celui d'1 heure reste au passage du worker.
    expect(st.reminders).toEqual([
      { membershipId: zone.id, index: 0, at: new Date(date * 1000 + 4 * 60_000) },
    ]);
  });

  it("canaux complets : réponse courte, message du bot modifié (« C'est bon »), acceptation programmée", async () => {
    const { bot, st, calls } = makeWorld({
      members: { "cRoul:42": "member", "cTir:42": "member" },
    });
    await bot.handleUpdate(joinRequest(ZONE, { date: nowSec() - 3600 }));
    const zone = zoneOf(st);
    await bot.handleUpdate(pressed(`g:${zone.code}`));
    expect(zoneOf(st).status).toBe("SCHEDULED");
    const answer = calls.find((c) => c.method === "answerCallbackQuery")!;
    expect(answer.payload).toMatchObject({
      callback_query_id: "cb1",
      text: "C'est bon Jean, tu seras accepté dans Zone Interdite dans 5 minutes.",
      show_alert: false,
    });
    const edit = calls.find((c) => c.method === "editMessageText")!;
    expect(edit.payload).toMatchObject({
      chat_id: 42,
      message_id: 55,
      text: "C'est bon Jean, tu seras accepté dans <b>Zone Interdite</b> dans 5 minutes.",
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [] },
    });
    // Appuyer sur un bouton du bot : la personne devient joignable.
    expect(st.canDm).toEqual([["m42", true]]);
    expect(calls.filter((c) => c.method === "sendMessage")).toEqual([]);
  });

  it("un canal manquant : « Il te manque encore » avec le bouton du canal et « ✅ J'ai rejoint »", async () => {
    const { bot, st, calls } = makeWorld({ members: { "cRoul:42": "member" } });
    await bot.handleUpdate(joinRequest(ZONE, { date: nowSec() - 3600 }));
    const zone = zoneOf(st);
    await bot.handleUpdate(pressed(`g:${zone.code}`));
    expect(zoneOf(st).status).toBe("PENDING_GATE");
    const edit = calls.find((c) => c.method === "editMessageText")!;
    expect(edit.payload.text).toBe(
      "Il te manque encore : TIR CADRÉ. Rejoins-les puis appuie à nouveau sur ✅ J'ai rejoint.",
    );
    expect(edit.payload.reply_markup).toEqual({
      inline_keyboard: [
        [{ text: "Rejoindre TIR CADRÉ", url: "https://t.me/+gate_cTir" }],
        [{ text: "✅ J'ai rejoint", callback_data: `g:${zone.code}` }],
      ],
    });
    expect(calls.find((c) => c.method === "answerCallbackQuery")!.payload.text).toContain(
      "Il te manque encore : TIR CADRÉ",
    );
  });

  it("appuyé deux fois (même texte) : Telegram dit « message is not modified », rien d'autre n'est envoyé", async () => {
    const { bot, st, calls, failures } = makeWorld();
    await bot.handleUpdate(joinRequest(ZONE, { date: nowSec() - 3600 }));
    failures.editMessageText = {
      error_code: 400,
      description:
        "Bad Request: message is not modified: specified new message content and reply markup are exactly the same",
    };
    await bot.handleUpdate(pressed(`g:${zoneOf(st).code}`));
    expect(calls.filter((c) => c.method === "answerCallbackQuery")).toHaveLength(1);
    expect(calls.filter((c) => c.method === "sendMessage")).toEqual([]);
  });

  it("message avec photo : la légende est modifiée ; message trop ancien : la réponse part en nouveau message", async () => {
    const w = makeWorld({ members: { "cRoul:42": "member", "cTir:42": "member" } });
    await w.bot.handleUpdate(joinRequest(ZONE, { date: nowSec() - 3600 }));
    await w.bot.handleUpdate(pressed(`g:${zoneOf(w.st).code}`, { media: true }));
    expect(w.calls.find((c) => c.method === "editMessageCaption")?.payload).toMatchObject({
      caption: "C'est bon Jean, tu seras accepté dans <b>Zone Interdite</b> dans 5 minutes.",
    });

    const v = makeWorld();
    await v.bot.handleUpdate(joinRequest(ZONE, { date: nowSec() - 3600 }));
    await v.bot.handleUpdate(pressed(`g:${zoneOf(v.st).code}`, { inaccessible: true }));
    expect(v.calls.find((c) => c.method === "editMessageText")).toBeUndefined();
    expect(String(v.calls.find((c) => c.method === "sendMessage")?.payload.text)).toContain(
      "Il te manque encore",
    );
  });

  it("code inconnu : seulement une réponse courte, le message n'est pas touché", async () => {
    const { bot, calls } = makeWorld();
    await bot.handleUpdate(pressed("g:INCONNU1"));
    expect(calls.find((c) => c.method === "answerCallbackQuery")!.payload).toMatchObject({
      text: "Je ne retrouve pas ta demande. Refais une demande d'adhésion au canal, puis réessaie.",
      show_alert: true,
    });
    expect(calls.filter((c) => /^edit/.test(c.method))).toEqual([]);
  });

  it("une autre personne appuie : sa réponse dit « demande introuvable », la demande ne bouge pas", async () => {
    const { bot, st, calls } = makeWorld({
      members: { "cRoul:99": "member", "cTir:99": "member" },
    });
    await bot.handleUpdate(joinRequest(ZONE));
    const zone = zoneOf(st);
    await bot.handleUpdate(pressed(`g:${zone.code}`, { userId: 99 }));
    expect(zoneOf(st).status).toBe("PENDING_GATE");
    expect(calls.find((c) => c.method === "answerCallbackQuery")!.payload.show_alert).toBe(true);
    expect(calls.filter((c) => /^edit/.test(c.method))).toEqual([]);
    expect(autoEvents(st)).toEqual([]);
  });

  it("autre bouton à rappel (pas « g: ») : laissé aux autres handlers, aucune réponse de ce handler", async () => {
    const { bot, calls } = makeWorld();
    await bot.handleUpdate(pressed("autre:1"));
    expect(calls.filter((c) => c.method === "answerCallbackQuery")).toEqual([]);
  });

  it("appuyé pendant la validation automatique (entrée dans le dernier canal) : un seul événement, un seul « C'est bon »", async () => {
    const w = makeWorld({ members: { "cRoul:42": "member", "cTir:42": "member" } });
    await w.bot.handleUpdate(joinRequest(ZONE, { date: nowSec() - 60 }));
    const zone = zoneOf(w.st);
    // Pendant la vérification du bouton (1er appel getChatMember), l'entrée dans Tir est traitée par le bot.
    w.hooks.getChatMember = async () => {
      await handleChatMember(identity, w.deps, joined(TIR).chat_member!, w.otherApi);
    };
    await w.bot.handleUpdate(pressed(`g:${zone.code}`));
    const z = zoneOf(w.st);
    expect(z.status).toBe("SCHEDULED");
    const events = autoEvents(w.st);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ auto: true, trigger: "joined" });
    // Heure d'acceptation de la validation automatique, jamais réécrite par le bouton.
    expect(events[0]!.payload.approveAt).toBe(z.approveAt!.toISOString());
    // Un seul « C'est bon » : le message privé de la validation automatique ; le bouton répond par une fenêtre et
    // retire les boutons devenus inutiles, sans réécrire le message.
    expect(w.st.dms.filter((d) => d.kind === "GATE_REMINDER")).toHaveLength(1);
    expect(w.calls.filter((c) => c.method === "editMessageText")).toEqual([]);
    expect(w.calls.find((c) => c.method === "answerCallbackQuery")!.payload).toMatchObject({
      text: expect.stringMatching(/^C'est bon Jean, tu seras accepté dans Zone Interdite/),
      show_alert: true,
    });
    expect(w.calls.find((c) => c.method === "editMessageReplyMarkup")?.payload).toMatchObject({
      chat_id: 42,
      message_id: 55,
      reply_markup: { inline_keyboard: [] },
    });
  });

  it("appuyé pendant l'acceptation (règle « tout de suite ») : la demande acceptée reste acceptée", async () => {
    const w = makeWorld({
      rules: { cZone: { ...ZONE_RULE, mode: "IMMEDIATE", delaySeconds: 0 } },
      members: { "cRoul:42": "member", "cTir:42": "member" },
    });
    await w.bot.handleUpdate(joinRequest(ZONE, { date: nowSec() - 3600 }));
    const zone = zoneOf(w.st);
    // Pendant la vérification du bouton : validation automatique puis acceptation par le worker (20 secondes).
    w.hooks.getChatMember = async () => {
      await handleChatMember(identity, w.deps, joined(TIR).chat_member!, w.otherApi);
      expect(zoneOf(w.st).status).toBe("SCHEDULED");
      await w.deps.updateMembership(zone.id, { status: "APPROVED" });
    };
    await w.bot.handleUpdate(pressed(`g:${zone.code}`));
    expect(zoneOf(w.st).status).toBe("APPROVED");
    expect(autoEvents(w.st)).toHaveLength(1);
    expect(w.calls.find((c) => c.method === "answerCallbackQuery")!.payload).toMatchObject({
      text: "Bienvenue dans Zone Interdite, Jean ! Tu es accepté.",
      show_alert: true,
    });
    expect(w.calls.filter((c) => c.method === "editMessageText")).toEqual([]);
  });

  it("canal vu « left » par le bouton mais demande validée entre-temps : jamais « Il te manque encore »", async () => {
    const w = makeWorld({ members: { "cRoul:42": "member" } });
    await w.bot.handleUpdate(joinRequest(ZONE, { date: nowSec() - 3600 }));
    const zone = zoneOf(w.st);
    // Demande dans Tir traitée pendant la vérification du bouton : Telegram répond encore « left » pour Tir.
    w.hooks.getChatMember = async () => {
      await w.bot.handleUpdate(joinRequest(TIR));
    };
    await w.bot.handleUpdate(pressed(`g:${zone.code}`));
    expect(zoneOf(w.st).status).toBe("SCHEDULED");
    expect(autoEvents(w.st)).toHaveLength(1);
    const answer = w.calls.find(
      (c) => c.method === "answerCallbackQuery" && c.payload.callback_query_id === "cb1",
    )!;
    expect(String(answer.payload.text)).toMatch(/^C'est bon Jean/);
    expect(w.calls.filter((c) => c.method === "editMessageText")).toEqual([]);
  });

  it("demande déjà programmée (validée avant l'appui) : fenêtre « C'est bon » et boutons retirés, pas de nouveau texte", async () => {
    const w = makeWorld({ members: { "cRoul:42": "member" } });
    await w.bot.handleUpdate(joinRequest(ZONE, { date: nowSec() - 3600 }));
    await w.bot.handleUpdate(joined(TIR));
    expect(zoneOf(w.st).status).toBe("SCHEDULED");
    await w.bot.handleUpdate(pressed(`g:${zoneOf(w.st).code}`));
    expect(w.calls.find((c) => c.method === "answerCallbackQuery")!.payload).toMatchObject({
      show_alert: true,
    });
    expect(w.calls.filter((c) => c.method === "editMessageText")).toEqual([]);
    expect(w.calls.filter((c) => c.method === "editMessageReplyMarkup")).toHaveLength(1);
    expect(autoEvents(w.st)).toHaveLength(1);
  });

  it("l'ancien lien /start g<code> des messages déjà envoyés reste valable", async () => {
    const { bot, st, calls } = makeWorld({
      members: { "cRoul:42": "member", "cTir:42": "member" },
    });
    await bot.handleUpdate(joinRequest(ZONE, { date: nowSec() - 3600 }));
    await bot.handleUpdate(startG(zoneOf(st).code));
    expect(zoneOf(st).status).toBe("SCHEDULED");
    expect(calls.find((c) => c.method === "sendMessage")?.payload.text).toBe(
      "C'est bon Jean, tu seras accepté dans <b>Zone Interdite</b> dans 5 minutes.",
    );
  });
});

describe("rappels à l'heure", () => {
  it("rappels « 60, 1440 » (règles existantes) : aucune tâche à l'heure ; canaux proposés : aucun rappel", async () => {
    const legacy = makeWorld({
      rules: { cZone: { ...ZONE_RULE, reminderAfterMinutes: [60, 1440] } },
    });
    await legacy.bot.handleUpdate(joinRequest(ZONE));
    expect(legacy.st.reminders).toEqual([]);

    const soft = makeWorld({ rules: { cZone: { ...ZONE_RULE, gateMode: "SOFT" } } });
    await soft.bot.handleUpdate(joinRequest(ZONE));
    expect(zoneOf(soft.st).status).toBe("SCHEDULED");
    expect(soft.st.reminders).toEqual([]);
  });
});

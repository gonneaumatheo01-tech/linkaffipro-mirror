import { describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import { validateTelegramHtml } from "@linkaffipro/core";
import type { Update } from "grammy/types";
import { botInfoFromRecord } from "../factory";
import type { BotIdentity } from "../ports";
import type { ChannelInfo, JoinFlowDeps, MembershipInfo } from "../join-flow/deps";
import type { GateBot, GateLinkApi } from "../join-flow/gate-links";
import { IMPLICIT_RULE, NO_RULE, type RuleData } from "../join-flow/rules";
import { resendGateWelcome } from "../join-flow/service";
import { registerJoinFlowHandlers } from "./join-flow";

const identity: BotIdentity = {
  id: "bot_1",
  name: "CasinoBot",
  username: "casinobot",
  telegramBotId: 111n,
  vertical: "CASINO",
};
const chanA: ChannelInfo = {
  id: "cA",
  title: "Canal A",
  username: null,
  language: "fr",
  telegramChatId: -100100n,
  primaryBotId: "bot_1",
  isActive: true,
};
const chanB: ChannelInfo = {
  id: "cB",
  title: "Canal B",
  username: "canalb",
  language: "fr",
  telegramChatId: -100200n,
  primaryBotId: "bot_1",
  isActive: true,
};
const chanC: ChannelInfo = {
  id: "cC",
  title: "Canal C",
  username: null,
  language: "fr",
  telegramChatId: -100300n,
  primaryBotId: null,
  isActive: true,
};
/** Canal décoché « Actif » par l'équipe. */
const chanOff: ChannelInfo = {
  id: "cOff",
  title: "Canal en pause",
  username: null,
  language: "fr",
  telegramChatId: -100400n,
  primaryBotId: "bot_1",
  isActive: false,
};
/** Canaux privés du cas du client : chacun géré par un autre de nos bots que celui du canal source. */
const chanRoulette: ChannelInfo = {
  id: "cRoulette",
  title: "LA ZONE ROULETTE 🎰",
  username: null,
  language: "fr",
  telegramChatId: -100500n,
  primaryBotId: "bot_casino",
  isActive: true,
};
const chanTir: ChannelInfo = {
  id: "cTir",
  title: "🎯 TIR CADRÉ ⚡",
  username: null,
  language: "fr",
  telegramChatId: -100600n,
  primaryBotId: "bot_sports",
  isActive: true,
};
/** Titres avec des caractères spéciaux du HTML (le texte du bot est en HTML Telegram). */
const chanAmp: ChannelInfo = {
  id: "cAmp",
  title: "Paris & Foot <VIP>",
  username: null,
  language: "fr",
  telegramChatId: -100900n,
  primaryBotId: "bot_1",
  isActive: true,
};
const chanAmpGate: ChannelInfo = {
  id: "cAmpGate",
  title: "Roulette & Co",
  username: null,
  language: "fr",
  telegramChatId: -100901n,
  primaryBotId: "bot_1",
  isActive: true,
};
const ALL_CHANNELS = [chanA, chanB, chanC, chanOff, chanRoulette, chanTir, chanAmp, chanAmpGate];
/** Règle explicite « immédiat » (ce que l'équipe choisit dans la fiche canal). */
const IMMEDIATE_RULE: RuleData = { ...IMPLICIT_RULE, id: "r_immediat", name: "Immédiat" };
const from = { id: 42, is_bot: false, first_name: "Jean", language_code: "fr" };

type State = {
  memberships: Array<
    MembershipInfo & {
      expiresAt: Date | null;
      gateSatisfiedAt?: Date;
      joinedAt?: Date;
      leftAt?: Date;
    }
  >;
  dms: Array<{
    kind: string;
    text: string;
    buttons: Array<Array<{ text: string; url: string }>>;
    chatId: bigint | null;
  }>;
  events: string[];
  eventPayloads: Array<{ type: string; payload: Record<string, unknown> }>;
  canDm: Array<[string, boolean]>;
  /** Liens GATE enregistrés : « source->canal » → lien et bot créateur. */
  links: Record<string, { url: string; botId: string }>;
};

type DepsOpts = {
  rule?: RuleData;
  actingBotId?: string | null;
  inviteLinkUrl?: string;
  /** Nos bots administrateurs de chaque canal (relevé de la base). */
  adminsOf?: Record<string, GateBot[]>;
  /** API des autres bots (`apiFor`). */
  apis?: Record<string, GateLinkApi>;
  /** Le membre a-t-il ouvert la conversation avec le bot ? */
  canWrite?: boolean;
};

function makeDeps(opts: DepsOpts = {}) {
  const st: State = {
    memberships: [],
    dms: [],
    events: [],
    eventPayloads: [],
    canDm: [],
    links: {},
  };
  const rule = opts.rule ?? IMMEDIATE_RULE;
  const deps: JoinFlowDeps = {
    upsertMember: async (u) => ({
      memberId: `m${u.id}`,
      languageCode: u.language_code ?? null,
      firstName: u.first_name,
    }),
    findChannelByChatId: async (id) => ALL_CHANNELS.find((c) => c.telegramChatId === id) ?? null,
    getChannels: async (ids) =>
      ids
        .map((id) => ALL_CHANNELS.find((c) => c.id === id && c.isActive))
        .filter((c): c is ChannelInfo => !!c),
    actingBotIdFor: async () =>
      opts.actingBotId === null ? null : { botId: opts.actingBotId ?? "bot_1" },
    findInviteLinkByUrl: async (url) =>
      url === opts.inviteLinkUrl
        ? {
            id: "link1",
            kind: "AD_ENTRY",
            name: "TT-pub-1",
            channelId: "cA",
            campaignId: null,
            adPlatform: "TIKTOK",
            adCampaignName: null,
            adName: null,
            sourceChannelId: null,
            telegramInviteLink: url,
          }
        : null,
    resolveRule: async () => rule,
    createMembership: async (d) => {
      const m = {
        ...d,
        id: `ms${st.memberships.length + 1}`,
        remindersSent: 0,
      } as State["memberships"][number];
      st.memberships.push(m);
      return { id: m.id };
    },
    updateMembership: async (id, data) => {
      const m = st.memberships.find((x) => x.id === id);
      if (m) Object.assign(m, data);
    },
    findMembershipByCode: async (code) => st.memberships.find((m) => m.code === code) ?? null,
    findMembershipById: async (id) => st.memberships.find((m) => m.id === id) ?? null,
    findLatestMembership: async (memberId, channelId) =>
      [...st.memberships]
        .reverse()
        .find((m) => m.memberId === memberId && m.channelId === channelId) ?? null,
    getRuleForMembership: async () => rule,
    lastWelcomeAt: async () => null,
    incrementInviteLink: vi.fn(async () => undefined),
    findGateLink: async (src, gateId, o) => {
      const l = st.links[`${src}->${gateId}`];
      return l && (!o?.botId || l.botId === o.botId) ? l.url : null;
    },
    saveGateLink: async ({ sourceChannelId, gate, botId, url }) => {
      st.links[`${sourceChannelId}->${gate.id}`] = { url, botId };
    },
    adminBots: async (channelId) => opts.adminsOf?.[channelId] ?? [],
    apiFor: async (botId) => opts.apis?.[botId] ?? null,
    warn: () => undefined,
    getMember: async (memberId) => ({ memberId, languageCode: "fr", firstName: "Jean" }),
    getBotIdentity: async (botId) => (botId === identity.id ? identity : null),
    canWriteTo: async () => opts.canWrite ?? false,
    getSequenceText: async () => null,
    enqueueDm: async (i) => {
      st.dms.push({ kind: i.kind, text: i.text, buttons: i.buttons, chatId: i.chatId });
    },
    setCanDm: async (m, _b, v) => {
      st.canDm.push([m, v]);
    },
    recordEvent: async (e) => {
      st.events.push(e.type);
      st.eventPayloads.push({
        type: e.type,
        payload: (e.payload ?? {}) as Record<string, unknown>,
      });
    },
  };
  return { deps, st };
}

/** Erreur Telegram telle que l'API la renvoie quand le bot n'est pas administrateur du canal. */
const NOT_ADMIN = {
  ok: false,
  error_code: 400,
  description: "Bad Request: not enough rights to manage chat invite links",
};
const NOT_MEMBER = {
  ok: false,
  error_code: 403,
  description: "Forbidden: bot is not a member of the channel chat",
};

/** API simulée d'un autre de nos bots : administrateur des canaux `adminOf`, membres présents `members`. */
function otherBotApi(
  name: string,
  adminOf: bigint[],
  members: Record<string, string> = {},
): GateLinkApi & { calls: string[] } {
  const calls: string[] = [];
  const isAdmin = (chatId: number | string) => adminOf.some((c) => Number(c) === Number(chatId));
  return {
    calls,
    async createChatInviteLink(chatId) {
      calls.push(`createChatInviteLink ${chatId}`);
      if (!isAdmin(chatId)) throw Object.assign(new Error("refus"), NOT_ADMIN);
      return { invite_link: `https://t.me/+${name}${String(chatId).slice(-3)}` };
    },
    async getChatMember(chatId, userId) {
      calls.push(`getChatMember ${chatId} ${userId}`);
      if (!isAdmin(chatId)) throw Object.assign(new Error("refus"), NOT_MEMBER);
      return { status: members[String(chatId)] ?? "left" };
    },
  };
}

function makeBot(
  deps: JoinFlowDeps,
  members: Record<string, string> = {},
  /** Canaux dont le bot qui traite la demande est administrateur (par défaut : tous). */
  identityAdminOf?: bigint[],
) {
  const bot = new Bot("111:TEST", { botInfo: botInfoFromRecord(identity) });
  const apiCalls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  const isAdmin = (chatId: unknown) =>
    !identityAdminOf || identityAdminOf.some((c) => Number(c) === Number(chatId));
  bot.api.config.use(async (_prev, method, payload) => {
    apiCalls.push({ method, payload: payload as Record<string, unknown> });
    if (method === "createChatInviteLink") {
      const chatId = (payload as { chat_id: number }).chat_id;
      if (!isAdmin(chatId)) return NOT_ADMIN as never;
      return {
        ok: true,
        result: {
          invite_link: `https://t.me/+gate${chatId}`,
          creator: { id: 111, is_bot: true, first_name: "b" },
          creates_join_request: false,
          is_primary: false,
          is_revoked: false,
        },
      } as never;
    }
    if (method === "getChatMember") {
      const p = payload as { chat_id: number; user_id: number };
      if (!isAdmin(p.chat_id)) return NOT_MEMBER as never;
      return {
        ok: true,
        result: {
          status: members[String(p.chat_id)] ?? "left",
          user: { id: p.user_id, is_bot: false, first_name: "Jean" },
        },
      } as never;
    }
    return {
      ok: true,
      result: {
        message_id: 1,
        date: 0,
        chat: { id: 42, type: "private", first_name: "x" },
        text: "ok",
      },
    } as never;
  });
  // Canal inconnu : création simulée (sans base) ; le handler réessaie ensuite avec les mêmes deps.
  const channelDeps = {
    upsertChannel: vi.fn(async () => ({ channelId: "c_new", created: true })),
    findChannelId: vi.fn(async () => null),
    setChannelAdmin: vi.fn(async () => undefined),
    revokeChannelAdmin: vi.fn(async () => undefined),
    listOurBotTelegramIds: vi.fn(async () => [111n]),
  };
  registerJoinFlowHandlers(bot, identity, deps, channelDeps);
  return { bot, apiCalls, channelDeps };
}

const joinRequest = (chatId: number, inviteLink?: string): Update => ({
  update_id: 1,
  chat_join_request: {
    chat: { id: chatId, type: "channel", title: "Canal A" },
    from,
    user_chat_id: 42,
    date: 1_760_000_000,
    ...(inviteLink
      ? {
          invite_link: {
            invite_link: inviteLink,
            creator: { id: 111, is_bot: true, first_name: "b" },
            creates_join_request: true,
            is_primary: false,
            is_revoked: false,
          },
        }
      : {}),
  },
});
const startUpdate = (payload: string): Update => ({
  update_id: 2,
  message: {
    message_id: 1,
    date: 1,
    chat: { id: 42, type: "private", first_name: "Jean" },
    from,
    text: `/start ${payload}`,
    entities: [{ type: "bot_command", offset: 0, length: 6 }],
  },
});

describe("chat_join_request", () => {
  it("canal sans règle : demande enregistrée à valider (manuel), sans acceptation automatique ni message privé", async () => {
    const { deps, st } = makeDeps({ rule: NO_RULE });
    const { bot } = makeBot(deps);
    await bot.handleUpdate(joinRequest(-100100));
    expect(st.memberships).toHaveLength(1);
    const m = st.memberships[0]!;
    expect(m.status).toBe("REQUESTED");
    expect(m.approveAt).toBeNull();
    expect(m.approvalRuleId).toBeNull();
    expect(st.events).toContain("membership.requested");
    expect(st.dms).toHaveLength(0);
  });

  it("canal désactivé (« Actif » décoché) : la demande est ignorée", async () => {
    const { deps, st } = makeDeps();
    const { bot } = makeBot(deps);
    await bot.handleUpdate(joinRequest(-100400));
    expect(st.memberships).toHaveLength(0);
    expect(st.dms).toHaveLength(0);
    expect(st.events).toHaveLength(0);
  });

  it("règle « immédiat » : demande planifiée immédiatement, message d'accueil sans bouton", async () => {
    const { deps, st } = makeDeps();
    const { bot } = makeBot(deps);
    await bot.handleUpdate(joinRequest(-100100));
    expect(st.memberships).toHaveLength(1);
    const m = st.memberships[0]!;
    expect(m.status).toBe("SCHEDULED");
    expect(m.approveAt?.getTime()).toBe(1_760_000_000 * 1000);
    expect(m.userChatId).toBe(42n);
    expect(m.code).toMatch(/^[0-9A-Za-z]{8}$/);
    expect(st.events).toContain("membership.requested");
    expect(st.dms).toHaveLength(1);
    expect(st.dms[0]).toMatchObject({ kind: "WELCOME", chatId: 42n });
    expect(st.dms[0]!.text).toContain("Jean");
    expect(st.dms[0]!.text).toContain("immédiatement");
    expect(st.dms[0]!.buttons).toEqual([]);
  });

  it("délai 10 minutes + lien d'entrée : snapshot de la source et compteur du lien", async () => {
    const rule: RuleData = { ...IMPLICIT_RULE, id: "r", delaySeconds: 600 };
    const { deps, st } = makeDeps({ rule, inviteLinkUrl: "https://t.me/+pub1" });
    const { bot } = makeBot(deps);
    await bot.handleUpdate(joinRequest(-100100, "https://t.me/+pub1"));
    const m = st.memberships[0]!;
    expect(m.inviteLinkId).toBe("link1");
    expect(m.approveAt?.getTime()).toBe(1_760_000_000 * 1000 + 600_000);
    expect((m.source.inviteLink as { name: string }).name).toBe("TT-pub-1");
    expect(deps.incrementInviteLink).toHaveBeenCalledWith("link1", "requests");
    expect(st.dms[0]!.text).toContain("dans 10 minutes");
  });

  it("gate requis : PENDING_GATE, liens GATE créés, boutons rejoindre + J'ai rejoint", async () => {
    const rule: RuleData = {
      ...IMPLICIT_RULE,
      id: "r",
      delaySeconds: 60,
      gateMode: "REQUIRED",
      gateChannelIds: ["cB", "cC"],
    };
    const { deps, st } = makeDeps({ rule });
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate(joinRequest(-100100));
    const m = st.memberships[0]!;
    expect(m.status).toBe("PENDING_GATE");
    expect(m.approveAt).toBeNull();
    expect(apiCalls.filter((c) => c.method === "createChatInviteLink")).toHaveLength(2);
    const btns = st.dms[0]!.buttons;
    expect(btns).toHaveLength(3);
    expect(btns[0]![0]!.text).toBe("Rejoindre Canal B");
    expect(btns[2]![0]!.text).toBe("✅ J'ai rejoint");
    expect(btns[2]![0]!.url).toBe(`https://t.me/casinobot?start=g${m.code}`);
    expect((m.source.gates as unknown[]).length).toBe(2);
  });

  it("gate SOFT : planifié malgré tout, canaux proposés", async () => {
    const rule: RuleData = {
      ...IMPLICIT_RULE,
      id: "r",
      delaySeconds: 60,
      gateMode: "SOFT",
      gateChannelIds: ["cB"],
    };
    const { deps, st } = makeDeps({ rule });
    const { bot } = makeBot(deps);
    await bot.handleUpdate(joinRequest(-100100));
    expect(st.memberships[0]!.status).toBe("SCHEDULED");
    expect(st.dms[0]!.buttons).toHaveLength(2);
  });

  it("ignore la demande si un autre bot agit pour le canal ou si le canal est inconnu", async () => {
    const { deps, st } = makeDeps({ actingBotId: "bot_2" });
    const { bot, channelDeps } = makeBot(deps);
    await bot.handleUpdate(joinRequest(-100100));
    expect(channelDeps.upsertChannel).not.toHaveBeenCalled();
    await bot.handleUpdate(joinRequest(-100999));
    // Canal inconnu : il est créé (droits relevés) avant un second essai.
    expect(channelDeps.upsertChannel).toHaveBeenCalledWith({
      id: -100999,
      type: "channel",
      title: "Canal A",
    });
    expect(st.memberships).toHaveLength(0);
    expect(st.dms).toHaveLength(0);
  });
});

describe("droits enregistrés en retard (phase 11 : liens des canaux à rejoindre avec demande d'adhésion)", () => {
  it("aucun bot administrateur connu : droits relevés (la demande le prouve), puis demande traitée", async () => {
    const { deps, st } = makeDeps();
    let known = false;
    deps.actingBotIdFor = async () => (known ? { botId: "bot_1" } : null);
    const { bot, apiCalls, channelDeps } = makeBot(deps);
    channelDeps.upsertChannel.mockImplementation(async () => {
      known = true;
      return { channelId: "cA", created: false };
    });
    await bot.handleUpdate(joinRequest(-100100));
    expect(apiCalls.some((c) => c.method === "getChatAdministrators")).toBe(true);
    expect(st.memberships).toHaveLength(1);
    expect(st.memberships[0]!.status).toBe("SCHEDULED");
  });
});

describe("canaux à rejoindre gérés par d'autres bots (cas du client du 11 octobre)", () => {
  /** Règle du canal « Zone Interdite » : délai de 10 minutes après avoir rejoint deux canaux obligatoires. */
  const clientRule: RuleData = {
    ...IMPLICIT_RULE,
    id: "r_zone",
    delaySeconds: 600,
    gateMode: "REQUIRED",
    gateChannelIds: ["cRoulette", "cTir"],
    reminderAfterMinutes: [60],
    maxReminders: 1,
  };
  const casinoBot: GateBot = {
    botId: "bot_casino",
    username: "casinogamblingoobot",
    canInvite: true,
  };
  const sportsBot: GateBot = {
    botId: "bot_sports",
    username: "sportbettingoobot",
    canInvite: true,
  };
  /** Le bot du canal source n'est administrateur que de son canal. */
  const onlySource = [-100100n];

  function clientWorld(members: Record<string, string> = {}) {
    const casinoApi = otherBotApi("casino", [-100500n], members);
    const sportsApi = otherBotApi("sports", [-100600n], members);
    const opts: DepsOpts = {
      rule: clientRule,
      adminsOf: { cRoulette: [casinoBot], cTir: [sportsBot] },
      apis: { bot_casino: casinoApi, bot_sports: sportsApi },
    };
    return { opts, casinoApi, sportsApi };
  }

  it("liens créés par le bot de chaque canal à rejoindre, accueil avec les 2 canaux et « ✅ J'ai rejoint », puis acceptation", async () => {
    const { opts, casinoApi, sportsApi } = clientWorld({
      "-100500": "member",
      "-100600": "member",
    });
    const { deps, st } = makeDeps(opts);
    const { bot, apiCalls } = makeBot(deps, {}, onlySource);
    await bot.handleUpdate(joinRequest(-100100));

    // Le bot de chaque canal à rejoindre crée le lien (c'est lui qui recevra la demande : Telegram masquerait la fin
    // d'un lien créé par un autre bot) ; le bot qui traite la demande n'essaie même pas.
    expect(apiCalls.filter((c) => c.method === "createChatInviteLink")).toHaveLength(0);
    expect(casinoApi.calls).toEqual(["createChatInviteLink -100500"]);
    expect(sportsApi.calls).toEqual(["createChatInviteLink -100600"]);
    expect(st.links["cA->cRoulette"]).toEqual({
      url: "https://t.me/+casino500",
      botId: "bot_casino",
    });
    expect(st.links["cA->cTir"]).toEqual({ url: "https://t.me/+sports600", botId: "bot_sports" });

    const m = st.memberships[0]!;
    expect(m.status).toBe("PENDING_GATE");
    expect(m.source.gateLinksMissing).toEqual([]);
    expect(st.events).not.toContain("membership.gate_links_missing");
    const btns = st.dms[0]!.buttons;
    expect(btns.map((r) => r[0]!.text)).toEqual([
      "Rejoindre LA ZONE ROULETTE 🎰",
      "Rejoindre 🎯 TIR CADRÉ ⚡",
      "✅ J'ai rejoint",
    ]);
    expect(btns[0]![0]!.url).toBe("https://t.me/+casino500");
    expect(btns[2]![0]!.url).toBe(`https://t.me/casinobot?start=g${m.code}`);

    // « J'ai rejoint » : le bot source ne peut pas lire ces canaux, les bots administrateurs vérifient.
    await bot.handleUpdate(startUpdate(`g${m.code}`));
    expect(casinoApi.calls).toContain("getChatMember -100500 42");
    expect(sportsApi.calls).toContain("getChatMember -100600 42");
    expect(m.status).toBe("SCHEDULED");
    expect(m.approveAt!.getTime() - m.gateSatisfiedAt!.getTime()).toBe(600_000);
    expect(st.events).toContain("membership.gate_satisfied");
  });

  it("lien GATE déjà créé : réutilisé, aucun appel à Telegram", async () => {
    const { opts, casinoApi, sportsApi } = clientWorld();
    const { deps, st } = makeDeps(opts);
    st.links["cA->cRoulette"] = { url: "https://t.me/+ancien1", botId: "bot_casino" };
    st.links["cA->cTir"] = { url: "https://t.me/+ancien2", botId: "bot_sports" };
    const { bot, apiCalls } = makeBot(deps, {}, onlySource);
    await bot.handleUpdate(joinRequest(-100100));
    expect(apiCalls.filter((c) => c.method === "createChatInviteLink")).toHaveLength(0);
    expect(casinoApi.calls).toEqual([]);
    expect(sportsApi.calls).toEqual([]);
    expect(st.dms[0]!.buttons.map((r) => r[0]!.url).slice(0, 2)).toEqual([
      "https://t.me/+ancien1",
      "https://t.me/+ancien2",
    ]);
  });

  it("aucun de nos bots n'est administrateur : accueil avec « ✅ J'ai rejoint », erreur exacte journalisée, demande marquée", async () => {
    const { deps, st } = makeDeps({ rule: clientRule });
    const { bot } = makeBot(deps, {}, onlySource);
    await bot.handleUpdate(joinRequest(-100100));
    const m = st.memberships[0]!;
    expect(m.status).toBe("PENDING_GATE");
    // Jamais un accueil muet sans boutons : le bouton « J'ai rejoint » est toujours là.
    expect(st.dms).toHaveLength(1);
    expect(st.dms[0]!.buttons).toEqual([
      [{ text: "✅ J'ai rejoint", url: `https://t.me/casinobot?start=g${m.code}` }],
    ]);
    const missing = m.source.gateLinksMissing as Array<Record<string, unknown>>;
    expect(missing.map((p) => p.title)).toEqual(["LA ZONE ROULETTE 🎰", "🎯 TIR CADRÉ ⚡"]);
    expect(missing[0]).toMatchObject({
      channelId: "cRoulette",
      tried: ["@casinobot"],
      suggestedBot: "casinobot",
    });
    expect(String(missing[0]!.error)).toContain(
      "@casinobot : 400 Bad Request: not enough rights to manage chat invite links",
    );
    const ev = st.eventPayloads.find((e) => e.type === "membership.gate_links_missing");
    expect(ev?.payload).toMatchObject({ membershipId: m.id, stage: "welcome" });
    expect((ev?.payload.missing as unknown[]).length).toBe(2);
  });

  it("canal public sans bot administrateur : son lien public sert de bouton", async () => {
    const rule: RuleData = { ...clientRule, gateChannelIds: ["cB"] };
    const { deps, st } = makeDeps({ rule });
    const { bot } = makeBot(deps, {}, onlySource);
    await bot.handleUpdate(joinRequest(-100100));
    expect(st.dms[0]!.buttons[0]![0]!.url).toBe("https://t.me/canalb");
    expect(st.memberships[0]!.source.gateLinksMissing).toEqual([]);
  });

  it("« J'ai rejoint » après correction des droits : liens recalculés pour les canaux encore sans lien", async () => {
    const { opts, casinoApi } = clientWorld();
    const adminsOf = opts.adminsOf!;
    opts.adminsOf = {};
    const { deps, st } = makeDeps(opts);
    const { bot, apiCalls } = makeBot(deps, {}, onlySource);
    await bot.handleUpdate(joinRequest(-100100));
    const m = st.memberships[0]!;
    expect((m.source.gateLinksMissing as unknown[]).length).toBe(2);

    // Le client ajoute le bot casino au canal roulette ; le canal paris sportifs reste sans bot.
    opts.adminsOf = { cRoulette: adminsOf.cRoulette! };
    await bot.handleUpdate(startUpdate(`g${m.code}`));
    expect(m.status).toBe("PENDING_GATE");
    expect(casinoApi.calls).toContain("createChatInviteLink -100500");
    const reply = apiCalls.filter((c) => c.method === "sendMessage").at(-1)!;
    expect(String(reply.payload.text)).toContain("LA ZONE ROULETTE");
    expect(String(reply.payload.text)).toContain("TIR CADRÉ");
    const kb = reply.payload.reply_markup as { inline_keyboard: Array<Array<{ text: string }>> };
    expect(kb.inline_keyboard.map((r) => r[0]!.text)).toEqual([
      "Rejoindre LA ZONE ROULETTE 🎰",
      "✅ J'ai rejoint",
    ]);
    expect((m.source.gates as unknown[]).length).toBe(1);
    expect(
      (m.source.gateLinksMissing as Array<{ channelId: string }>).map((p) => p.channelId),
    ).toEqual(["cTir"]);
  });
});

describe("canal obligatoire qu'aucun de nos bots ne peut vérifier (lien public, aucun bot administrateur)", () => {
  const rule: RuleData = {
    ...IMPLICIT_RULE,
    id: "r_public",
    delaySeconds: 600,
    gateMode: "REQUIRED",
    gateChannelIds: ["cB"],
  };
  const checker: GateBot = { botId: "bot_check", username: "checkerbot", canInvite: true };

  async function blocked(canWrite = true) {
    const opts: DepsOpts = { rule, canWrite, apis: { bot_1: otherBotApi("source", [-100100n]) } };
    const { deps, st } = makeDeps(opts);
    const { bot } = makeBot(deps, {}, [-100100n]);
    await bot.handleUpdate(joinRequest(-100100));
    const m = st.memberships[0]!;
    // Le lien public part dans l'accueil : aucun lien ne manque…
    expect(st.dms[0]!.buttons[0]![0]!.url).toBe("https://t.me/canalb");
    expect(m.source.gateLinksMissing).toEqual([]);
    // … mais « J'ai rejoint » ne peut pas être vérifié : la demande est marquée (point « À faire », alerte).
    await bot.handleUpdate(startUpdate(`g${m.code}`));
    expect(m.status).toBe("PENDING_GATE");
    return { deps, st, opts, m };
  }

  it("« J'ai rejoint » impossible à vérifier : demande marquée avec le canal, l'erreur et le bot à ajouter", async () => {
    const { st, m } = await blocked();
    const failed = m.source.gateCheckFailed as Array<Record<string, unknown>>;
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      channelId: "cB",
      title: "Canal B",
      tried: ["@casinobot"],
      suggestedBot: "casinobot",
      reason: "cannot_verify",
    });
    expect(String(failed[0]!.error)).toContain("@casinobot : 403 Forbidden");
    expect(st.events).toContain("membership.gate_check_failed");
  });

  it("« Renvoyer l'accueil » : rien tant qu'aucun bot ne peut vérifier, puis accueil renvoyé et marque effacée", async () => {
    const { deps, st, opts, m } = await blocked();
    const r1 = await resendGateWelcome(deps, m.id);
    expect(r1.status).toBe("still_missing");
    expect(r1.status === "still_missing" && r1.missing[0]).toMatchObject({
      channelId: "cB",
      reason: "cannot_verify",
    });
    expect(st.dms).toHaveLength(1);
    expect((m.source.gateCheckFailed as unknown[]).length).toBe(1);

    // Le client ajoute un de nos bots comme administrateur du canal.
    opts.adminsOf = { cB: [checker] };
    const r2 = await resendGateWelcome(deps, m.id, {
      now: new Date(m.requestedAt.getTime() + 3_600_000),
    });
    expect(r2).toEqual({ status: "sent", gates: 1 });
    expect(st.dms).toHaveLength(2);
    expect(m.source.gateCheckFailed).toEqual([]);
  });

  it("vérification possible ensuite (bot ajouté) : membre accepté, marque effacée", async () => {
    const { deps, opts, m } = await blocked();
    opts.adminsOf = { cB: [checker] };
    opts.apis = {
      ...opts.apis,
      bot_check: otherBotApi("check", [-100200n], { "-100200": "member" }),
    };
    const { bot } = makeBot(deps, {}, [-100100n]);
    await bot.handleUpdate(startUpdate(`g${m.code}`));
    expect(m.status).toBe("SCHEDULED");
    expect(m.source.gateCheckFailed).toEqual([]);
  });
});

describe("Renvoyer l'accueil avec les liens (bouton de l'équipe)", () => {
  const clientRule: RuleData = {
    ...IMPLICIT_RULE,
    id: "r_zone",
    delaySeconds: 600,
    gateMode: "REQUIRED",
    gateChannelIds: ["cRoulette", "cTir"],
  };
  const admins = {
    cRoulette: [{ botId: "bot_casino", username: "casinogamblingoobot", canInvite: true }],
    cTir: [{ botId: "bot_sports", username: "sportbettingoobot", canInvite: true }],
  };

  async function pendingWithoutLinks(canWrite: boolean) {
    const opts: DepsOpts = {
      rule: clientRule,
      canWrite,
      apis: {
        bot_1: otherBotApi("source", [-100100n]),
        bot_casino: otherBotApi("casino", [-100500n]),
        bot_sports: otherBotApi("sports", [-100600n]),
      },
    };
    const { deps, st } = makeDeps(opts);
    const { bot } = makeBot(deps, {}, [-100100n]);
    await bot.handleUpdate(joinRequest(-100100));
    return { deps, st, opts, m: st.memberships[0]! };
  }

  it("liens toujours impossibles : rien n'est envoyé, l'erreur reste visible", async () => {
    const { deps, st, m } = await pendingWithoutLinks(true);
    const r = await resendGateWelcome(deps, m.id, { byUserId: "u1" });
    expect(r.status).toBe("still_missing");
    expect(st.dms).toHaveLength(1);
    expect((m.source.gateLinksMissing as unknown[]).length).toBe(2);
    expect(
      st.eventPayloads.filter((e) => e.type === "membership.gate_links_missing").at(-1)?.payload,
    ).toMatchObject({ stage: "resend" });
  });

  it("droits corrigés et membre joignable : accueil renvoyé avec les 2 canaux et « J'ai rejoint »", async () => {
    const { deps, st, opts, m } = await pendingWithoutLinks(true);
    opts.adminsOf = admins;
    const r = await resendGateWelcome(deps, m.id, {
      byUserId: "u1",
      now: new Date(m.requestedAt.getTime() + 3_600_000),
    });
    expect(r).toEqual({ status: "sent", gates: 2 });
    expect(st.dms).toHaveLength(2);
    expect(st.dms[1]!.kind).toBe("WELCOME");
    expect(st.dms[1]!.buttons.map((b) => b[0]!.text)).toEqual([
      "Rejoindre LA ZONE ROULETTE 🎰",
      "Rejoindre 🎯 TIR CADRÉ ⚡",
      "✅ J'ai rejoint",
    ]);
    expect(m.source.gateLinksMissing).toEqual([]);
    expect(st.eventPayloads.at(-1)).toMatchObject({
      type: "membership.welcome_resent",
      payload: { membershipId: m.id, byUserId: "u1", gates: 2 },
    });
  });

  it("droits corrigés mais le bot ne peut plus écrire en premier : liens prêts, rien n'est envoyé", async () => {
    const { deps, st, opts, m } = await pendingWithoutLinks(false);
    opts.adminsOf = admins;
    const r = await resendGateWelcome(deps, m.id, {
      now: new Date(m.requestedAt.getTime() + 3_600_000),
    });
    expect(r).toEqual({ status: "links_ready", gates: 2 });
    expect(st.dms).toHaveLength(1);
    expect(m.source.gateLinksMissing).toEqual([]);
    expect((m.source.gates as unknown[]).length).toBe(2);
  });

  it("dans les 5 minutes qui suivent la demande, le bot peut encore écrire : accueil renvoyé", async () => {
    const { deps, st, opts, m } = await pendingWithoutLinks(false);
    opts.adminsOf = admins;
    const r = await resendGateWelcome(deps, m.id, {
      now: new Date(m.requestedAt.getTime() + 60_000),
    });
    expect(r.status).toBe("sent");
    expect(st.dms).toHaveLength(2);
  });

  it("demande qui n'est plus en attente : rien n'est envoyé", async () => {
    const { deps, st, opts, m } = await pendingWithoutLinks(true);
    opts.adminsOf = admins;
    m.status = "APPROVED";
    expect(await resendGateWelcome(deps, m.id)).toEqual({ status: "not_pending" });
    expect(await resendGateWelcome(deps, "inconnue")).toEqual({ status: "not_found" });
    expect(st.dms).toHaveLength(1);
  });
});

describe("/start g<code>", () => {
  const rule: RuleData = {
    ...IMPLICIT_RULE,
    id: "r",
    delaySeconds: 60,
    gateMode: "REQUIRED",
    gateChannelIds: ["cB", "cC"],
  };

  it("tous les canaux rejoints → SCHEDULED et confirmation", async () => {
    const { deps, st } = makeDeps({ rule });
    const { bot, apiCalls } = makeBot(deps, { "-100200": "member", "-100300": "administrator" });
    await bot.handleUpdate(joinRequest(-100100));
    const m = st.memberships[0]!;
    await bot.handleUpdate(startUpdate(`g${m.code}`));
    expect(m.status).toBe("SCHEDULED");
    expect(m.gateSatisfiedAt).toBeInstanceOf(Date);
    expect(m.approveAt!.getTime() - m.gateSatisfiedAt!.getTime()).toBe(60_000);
    expect(st.canDm).toContainEqual(["m42", true]);
    expect(st.events).toContain("membership.gate_satisfied");
    const reply = apiCalls.filter((c) => c.method === "sendMessage").at(-1)!;
    expect(String(reply.payload.text)).toContain("dans 1 minute");
    expect(reply.payload.reply_markup).toBeUndefined();
  });

  it("canal manquant → liste des manquants avec boutons, statut inchangé", async () => {
    const { deps, st } = makeDeps({ rule });
    const { bot, apiCalls } = makeBot(deps, { "-100200": "member" });
    await bot.handleUpdate(joinRequest(-100100));
    const m = st.memberships[0]!;
    await bot.handleUpdate(startUpdate(`g${m.code}`));
    expect(m.status).toBe("PENDING_GATE");
    const reply = apiCalls.filter((c) => c.method === "sendMessage").at(-1)!;
    expect(String(reply.payload.text)).toContain("Canal C");
    expect(String(reply.payload.text)).not.toContain("Canal B");
    expect(reply.payload.reply_markup).toBeDefined();
  });

  it("code inconnu ou membre différent → message d'erreur", async () => {
    const { deps } = makeDeps({ rule });
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate(startUpdate("gZZZZZZZZ"));
    expect(String(apiCalls.at(-1)!.payload.text)).toMatch(/ne retrouve pas/);
  });

  it("laisse passer un /start ordinaire (pas de payload g…)", async () => {
    const { deps } = makeDeps({ rule });
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate(startUpdate("admin_x"));
    await bot.handleUpdate({
      update_id: 3,
      message: {
        message_id: 1,
        date: 1,
        chat: { id: 42, type: "private", first_name: "Jean" },
        from,
        text: "/start",
        entities: [{ type: "bot_command", offset: 0, length: 6 }],
      },
    });
    expect(apiCalls.filter((c) => c.method === "sendMessage")).toHaveLength(0);
  });
});

describe("textes du bot en HTML Telegram : prénoms et noms de canaux échappés", () => {
  const rule: RuleData = {
    ...IMPLICIT_RULE,
    id: "r_amp",
    delaySeconds: 60,
    gateMode: "REQUIRED",
    gateChannelIds: ["cAmpGate"],
  };
  const tom = { ...from, first_name: "Tom <3" };
  const ampRequest = (): Update => ({
    update_id: 1,
    chat_join_request: {
      chat: { id: -100900, type: "channel", title: chanAmp.title },
      from: tom,
      user_chat_id: 42,
      date: 1_760_000_000,
    },
  });
  const ampStart = (payload: string): Update => {
    const u = startUpdate(payload);
    return { ...u, message: { ...u.message!, from: tom } };
  };

  it("« Tom <3 » demande « Paris & Foot <VIP> » : accueil, « il te manque » et confirmation acceptés par Telegram", async () => {
    const { deps, st } = makeDeps({ rule });
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate(ampRequest());
    const welcome = st.dms[0]!.text;
    expect(welcome).toContain("Tom &lt;3");
    expect(welcome).toContain("<b>Paris &amp; Foot &lt;VIP&gt;</b>");
    expect(validateTelegramHtml(welcome)).toMatchObject({ ok: true });
    // Les boutons ne sont pas du HTML : le nom du canal y reste tel quel.
    expect(st.dms[0]!.buttons[0]![0]!.text).toBe("Rejoindre Roulette & Co");

    const m = st.memberships[0]!;
    await bot.handleUpdate(ampStart(`g${m.code}`));
    const missing = String(apiCalls.filter((c) => c.method === "sendMessage").at(-1)!.payload.text);
    expect(missing).toContain("Roulette &amp; Co");
    expect(validateTelegramHtml(missing)).toMatchObject({ ok: true });

    const joined = makeBot(deps, { "-100901": "member" });
    await joined.bot.handleUpdate(ampStart(`g${m.code}`));
    const ok = String(
      joined.apiCalls.filter((c) => c.method === "sendMessage").at(-1)!.payload.text,
    );
    expect(m.status).toBe("SCHEDULED");
    expect(ok).toContain("Tom &lt;3");
    expect(validateTelegramHtml(ok)).toMatchObject({ ok: true });
  });
});

describe("chat_member", () => {
  const cm = (oldS: string, newS: string, link?: string): Update => ({
    update_id: 5,
    chat_member: {
      chat: { id: -100100, type: "channel", title: "Canal A" },
      from: { id: 42, is_bot: false, first_name: "Jean" },
      date: 1_760_000_100,
      old_chat_member: { status: oldS, user: from } as never,
      new_chat_member: { status: newS, user: from } as never,
      ...(link
        ? {
            invite_link: {
              invite_link: link,
              creator: { id: 111, is_bot: true, first_name: "b" },
              creates_join_request: false,
              is_primary: false,
              is_revoked: false,
            },
          }
        : {}),
    },
  });

  it("entrée effective : joinedAt sur la demande en cours + événement", async () => {
    const { deps, st } = makeDeps();
    const { bot } = makeBot(deps);
    await bot.handleUpdate(joinRequest(-100100));
    await bot.handleUpdate(cm("left", "member"));
    expect(st.memberships[0]).toMatchObject({ status: "APPROVED" });
    expect(st.memberships[0]!.joinedAt).toBeInstanceOf(Date);
    expect(st.events).toContain("membership.joined");
  });

  it("entrée sans demande connue : nouvelle adhésion directe, lien GATE compté", async () => {
    const { deps, st } = makeDeps({ inviteLinkUrl: "https://t.me/+gate" });
    const { bot } = makeBot(deps);
    await bot.handleUpdate(cm("left", "member", "https://t.me/+gate"));
    expect(st.memberships).toHaveLength(1);
    expect(st.memberships[0]!.source).toMatchObject({ joinedDirectly: true });
    expect(deps.incrementInviteLink).toHaveBeenCalledWith("link1", "joined");
  });

  it("canal désactivé : entrées et départs ignorés par le flux d'adhésion", async () => {
    const { deps, st } = makeDeps();
    const { bot } = makeBot(deps);
    const off = cm("left", "member");
    (off.chat_member as { chat: { id: number } }).chat.id = -100400;
    await bot.handleUpdate(off);
    expect(st.memberships).toHaveLength(0);
    expect(st.events).toHaveLength(0);
  });

  it("départ et exclusion", async () => {
    const { deps, st } = makeDeps();
    const { bot } = makeBot(deps);
    await bot.handleUpdate(cm("left", "member"));
    await bot.handleUpdate(cm("member", "left"));
    expect(st.memberships[0]!.status).toBe("LEFT");
    await bot.handleUpdate(cm("left", "member"));
    await bot.handleUpdate(cm("member", "kicked"));
    expect(st.memberships[1]!.status).toBe("KICKED");
    expect(st.events.filter((e) => e === "membership.left")).toHaveLength(1);
    expect(st.events).toContain("membership.kicked");
  });
});

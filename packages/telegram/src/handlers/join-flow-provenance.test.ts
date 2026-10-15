/**
 * Phase 11 : règles d'acceptation selon la provenance, de bout en bout avec des mises à jour Telegram simulées
 * (plusieurs de nos bots, un par canal, comme chez le client) et la vraie résolution des règles.
 *
 * Scénario du client (11 octobre) :
 * - « 🎯 TIR CADRÉ ⚡ » (bot paris sportifs) exige « Zone Interdite 🔞 », puis 1 heure ;
 * - « Zone Interdite 🔞 » (bot rencontres) exige « LA ZONE ROULETTE 🎰 » et « Tir Cadré », puis 5 minutes, avec
 *   l'exception « venu de Tir Cadré → 1 jour » ;
 * - « LA ZONE ROULETTE 🎰 » (bot casino) n'a aucune règle.
 * Telegram répond « left » pour une demande en attente : seule notre demande prouve qu'elle a été faite.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update } from "grammy/types";
import { provenanceOfLink, type ProvenanceLink } from "@linkaffipro/core";
import { botInfoFromRecord } from "../factory";
import type { BotIdentity } from "../ports";
import type { ChannelInfo, InviteLinkInfo, JoinFlowDeps, MembershipInfo } from "../join-flow/deps";
import {
  loadRuleForMembership,
  resolveRuleForProvenance,
  type RuleLoaders,
  type ScopedRuleRow,
} from "../join-flow/rules";
import { resendGateWelcome } from "../join-flow/service";
import { registerJoinFlowHandlers } from "./join-flow";

const bots = {
  sports: {
    id: "bot_sports",
    name: "Sports",
    username: "sportbettingoobot",
    telegramBotId: 222n,
    vertical: "SPORTS",
  },
  dating: {
    id: "bot_dating",
    name: "Dating",
    username: "datingoobot",
    telegramBotId: 333n,
    vertical: "DATING",
  },
  casino: {
    id: "bot_casino",
    name: "Casino",
    username: "casinogamblingoobot",
    telegramBotId: 111n,
    vertical: "CASINO",
  },
} satisfies Record<string, BotIdentity>;
type BotKey = keyof typeof bots;

function channel(
  id: string,
  title: string,
  chat: bigint,
  bot: BotKey,
): ChannelInfo & { bot: BotKey } {
  return {
    id,
    title,
    username: null,
    language: "fr",
    telegramChatId: chat,
    primaryBotId: bots[bot].id,
    isActive: true,
    bot,
  };
}
const TIR = channel("cTir", "🎯 TIR CADRÉ ⚡", -100601n, "sports");
const ZONE = channel("cZone", "Zone Interdite 🔞", -100602n, "dating");
const ROULETTE = channel("cRoulette", "LA ZONE ROULETTE 🎰", -100603n, "casino");
const PLAIN_A = channel("cPlainA", "Rencontres Paris", -100604n, "dating");
const PLAIN_B = channel("cPlainB", "Rencontres Lyon", -100605n, "dating");
const PLAIN_C = channel("cPlainC", "Rencontres Nice", -100606n, "dating");
const CHANNELS = [TIR, ZONE, ROULETTE, PLAIN_A, PLAIN_B, PLAIN_C];

function rule(over: Partial<ScopedRuleRow> & { id: string }): ScopedRuleRow {
  return {
    name: over.id,
    scope: "DEFAULT",
    isDefault: false,
    inviteLinkId: null,
    sourceChannelId: null,
    sourceKind: null,
    sortOrder: 0,
    label: null,
    sendWelcome: true,
    mode: "DELAY",
    delaySeconds: 0,
    gateChannelIds: [],
    gateMode: "NONE",
    reminderAfterMinutes: [60],
    maxReminders: 1,
    expireAfterHours: null,
    expireAction: "KEEP",
    sendAcceptedMessage: true,
    isActive: true,
    ...over,
  };
}

/** Règles du client. */
function clientRules(): Record<string, ScopedRuleRow[]> {
  return {
    [TIR.id]: [
      rule({
        id: "t_def",
        isDefault: true,
        delaySeconds: 3600,
        gateMode: "REQUIRED",
        gateChannelIds: [ZONE.id],
      }),
    ],
    [ZONE.id]: [
      rule({
        id: "z_def",
        isDefault: true,
        delaySeconds: 300,
        gateMode: "REQUIRED",
        gateChannelIds: [ROULETTE.id, TIR.id],
      }),
      rule({
        id: "z_tir",
        scope: "SOURCE_CHANNEL",
        sourceChannelId: TIR.id,
        label: "Venu de « Tir Cadré »",
        delaySeconds: 86_400,
      }),
    ],
    [ROULETTE.id]: [],
    [PLAIN_A.id]: [rule({ id: "a_def", isDefault: true, delaySeconds: 60 })],
    [PLAIN_B.id]: [rule({ id: "b_def", isDefault: true, delaySeconds: 60 })],
    [PLAIN_C.id]: [
      rule({
        id: "c_def",
        isDefault: true,
        delaySeconds: 60,
        gateMode: "REQUIRED",
        gateChannelIds: [ROULETTE.id],
      }),
    ],
  };
}

type Membership = MembershipInfo & {
  expiresAt: Date | null;
  gateSatisfiedAt?: Date;
  joinedAt?: Date;
};
type Dm = {
  botId: string;
  memberId: string;
  kind: string;
  text: string;
  buttons: Array<Array<{ text: string; url?: string; callbackData?: string }>>;
  queuedAt: Date;
};
type Call = { bot: BotKey; method: string; payload: Record<string, unknown> };

type WorldOpts = {
  /** Autres de nos bots administrateurs d'un canal (après son bot principal, comme en production). */
  extraAdmins?: Partial<Record<string, BotKey[]>>;
};

/**
 * Telegram masque la fin d'un lien créé par un autre administrateur que le bot qui reçoit la mise à jour (documentation
 * de l'API Bot, ChatInviteLink.invite_link) : seuls les 4 premiers caractères du code restent visibles.
 */
function masked(url: string): string {
  return url.replace(/^(https:\/\/t\.me\/\+.{0,4}).*$/u, "$1…");
}

/** Monde simulé : nos bots, nos canaux, la base (demandes, liens, messages, événements), Telegram. */
function world(rules = clientRules(), opts: WorldOpts = {}) {
  const links: InviteLinkInfo[] = [
    {
      id: "l_ad_tir",
      kind: "AD_ENTRY",
      name: "Pub TikTok Tir",
      channelId: TIR.id,
      campaignId: null,
      adPlatform: "TIKTOK",
      adCampaignName: null,
      adName: null,
      sourceChannelId: null,
      telegramInviteLink: "https://t.me/+adTir",
    },
    {
      id: "l_meta_zone",
      kind: "AD_ENTRY",
      name: "Pub Meta Zone",
      channelId: ZONE.id,
      campaignId: null,
      adPlatform: "META",
      adCampaignName: null,
      adName: null,
      sourceChannelId: null,
      telegramInviteLink: "https://t.me/+metaZone",
    },
  ];
  const createsJoinRequest: Record<string, boolean> = {};
  /** Bot créateur de chaque lien (identifiant de lien → notre bot). */
  const linkBot: Record<string, BotKey> = {};
  /** Bot créateur de chaque adresse créée par le Telegram simulé. */
  const creatorOfUrl: Record<string, BotKey> = {};
  const adminKeys = (channelId: string): BotKey[] => {
    const c = CHANNELS.find((x) => x.id === channelId)!;
    return [c.bot, ...(opts.extraAdmins?.[channelId] ?? []).filter((k) => k !== c.bot)];
  };
  const botKeyOf = (botId: string) =>
    (Object.keys(bots) as BotKey[]).find((k) => bots[k].id === botId);
  const memberships: Membership[] = [];
  const dms: Dm[] = [];
  const events: Array<{
    type: string;
    channelId?: string | null;
    botId?: string | null;
    payload: Record<string, unknown>;
  }> = [];
  const calls: Call[] = [];
  /** Membres réellement entrés (getChatMember « member ») ; une demande en attente reste « left ». */
  const inside = new Set<string>();
  const channelOf = (chat: unknown) =>
    CHANNELS.find((c) => Number(c.telegramChatId) === Number(chat));

  const loaders: RuleLoaders = {
    ruleById: async (id) =>
      Object.values(rules)
        .flat()
        .find((r) => r.id === id) ?? null,
    channelRules: async (id) => (rules[id] ?? []).filter((r) => r.isActive),
    linkById: async (id) => (links.find((l) => l.id === id) as ProvenanceLink | undefined) ?? null,
  };

  const deps: JoinFlowDeps = {
    upsertMember: async (u) => ({
      memberId: `m${u.id}`,
      languageCode: u.language_code ?? null,
      firstName: u.first_name,
    }),
    findChannelByChatId: async (id) => CHANNELS.find((c) => c.telegramChatId === id) ?? null,
    getChannels: async (ids) =>
      ids
        .map((id) => CHANNELS.find((c) => c.id === id))
        .filter((c): c is (typeof CHANNELS)[number] => !!c),
    actingBotIdFor: async (channelId) => ({
      botId: bots[CHANNELS.find((c) => c.id === channelId)!.bot].id,
    }),
    findInviteLinkByUrl: async (url) => links.find((l) => l.telegramInviteLink === url) ?? null,
    findInviteLinksByPrefix: async ({ channelId, prefix, creatorTelegramId }) =>
      links
        .filter(
          (l) =>
            l.channelId === channelId &&
            l.telegramInviteLink.startsWith(prefix) &&
            linkBot[l.id] !== undefined &&
            bots[linkBot[l.id]!].telegramBotId === creatorTelegramId,
        )
        .map((l) => ({ ...l, isActive: true })),
    resolveRule: async (channelId, link) =>
      resolveRuleForProvenance(
        (rules[channelId] ?? []).filter((r) => r.isActive),
        provenanceOfLink(link),
        channelId,
      ),
    createMembership: async (d) => {
      const m = { ...d, id: `ms${memberships.length + 1}`, remindersSent: 0 } as Membership;
      memberships.push(m);
      return { id: m.id };
    },
    updateMembership: async (id, data) => {
      Object.assign(
        memberships.find((m) => m.id === id)!,
        data,
      );
    },
    findMembershipByCode: async (code) => memberships.find((m) => m.code === code) ?? null,
    findMembershipById: async (id) => memberships.find((m) => m.id === id) ?? null,
    findLatestMembership: async (memberId, channelId) =>
      [...memberships]
        .reverse()
        .find((m) => m.memberId === memberId && m.channelId === channelId) ?? null,
    getRuleForMembership: (m) => loadRuleForMembership(m, loaders),
    lastWelcomeAt: async (memberId, botId) =>
      dms.filter((d) => d.memberId === memberId && d.botId === botId && d.kind === "WELCOME").at(-1)
        ?.queuedAt ?? null,
    incrementInviteLink: async () => undefined,
    // Le plus récent d'abord, comme en base.
    findGateLink: async (src, gateId, o) =>
      [...links]
        .reverse()
        .find(
          (l) =>
            l.kind === "GATE" &&
            l.sourceChannelId === src &&
            l.channelId === gateId &&
            (createsJoinRequest[l.id] ?? true) === (o?.createsJoinRequest ?? true) &&
            (!o?.botId || (linkBot[l.id] && bots[linkBot[l.id]!].id === o.botId)),
        )?.telegramInviteLink ?? null,
    saveGateLink: async ({ sourceChannelId, gate, botId, url, createsJoinRequest: cjr }) => {
      const base = `l_gate_${sourceChannelId}_${gate.id}`;
      let id = base;
      for (let i = 2; links.some((l) => l.id === id); i++) id = `${base}_${i}`;
      const key = botKeyOf(botId);
      if (key) linkBot[id] = key;
      links.push({
        id,
        kind: "GATE",
        name: `gate:${sourceChannelId}`,
        channelId: gate.id,
        campaignId: null,
        adPlatform: null,
        adCampaignName: null,
        adName: null,
        sourceChannelId,
        telegramInviteLink: url,
      });
      createsJoinRequest[id] = cjr;
    },
    requestedChannelIds: async (memberId, ids) =>
      ids.filter((id) => {
        const st = [...memberships]
          .reverse()
          .find((m) => m.memberId === memberId && m.channelId === id)?.status;
        return (
          st === "REQUESTED" || st === "PENDING_GATE" || st === "SCHEDULED" || st === "APPROVED"
        );
      }),
    adminBots: async (channelId) =>
      adminKeys(channelId).map((k) => ({
        botId: bots[k].id,
        username: bots[k].username,
        canInvite: true,
      })),
    apiFor: async (botId) => {
      const key = botKeyOf(botId);
      return key ? grammy[key].api : null;
    },
    warn: () => undefined,
    getMember: async (memberId) => ({ memberId, languageCode: "fr", firstName: "Jean" }),
    getBotIdentity: async (botId) => Object.values(bots).find((b) => b.id === botId) ?? null,
    canWriteTo: async () => true,
    getSequenceText: async () => null,
    enqueueDm: async (i) => {
      dms.push({
        botId: i.botId,
        memberId: i.memberId,
        kind: i.kind,
        text: i.text,
        buttons: i.buttons,
        queuedAt: new Date(),
      });
    },
    setCanDm: async () => undefined,
    recordEvent: async (e) => {
      events.push({
        type: e.type,
        channelId: e.channelId,
        botId: e.botId,
        payload: (e.payload ?? {}) as Record<string, unknown>,
      });
    },
  };

  /** Bot grammY d'un de nos bots : il n'agit (lien, lecture des membres) que dans les canaux qu'il administre. */
  function makeBot(key: BotKey): Bot {
    const bot = new Bot(`${bots[key].telegramBotId}:TEST`, {
      botInfo: botInfoFromRecord(bots[key]),
    });
    bot.api.config.use(async (_prev, method, payload) => {
      const p = (payload ?? {}) as Record<string, unknown>;
      calls.push({ bot: key, method, payload: p });
      const c = channelOf(p.chat_id);
      const isAdmin = !!c && adminKeys(c.id).includes(key);
      if (method === "createChatInviteLink") {
        if (!isAdmin)
          return {
            ok: false,
            error_code: 400,
            description: "Bad Request: not enough rights to manage chat invite links",
          } as never;
        const base = `https://t.me/+${key}${String(p.chat_id).slice(-3)}`;
        let url = base;
        for (let i = 2; creatorOfUrl[url]; i++) url = `${base}n${i}`;
        creatorOfUrl[url] = key;
        return {
          ok: true,
          result: {
            invite_link: url,
            creator: { id: 1, is_bot: true, first_name: "b" },
            creates_join_request: p.creates_join_request === true,
            is_primary: false,
            is_revoked: false,
          },
        } as never;
      }
      if (method === "getChatMember") {
        if (!isAdmin)
          return {
            ok: false,
            error_code: 403,
            description: "Forbidden: bot is not a member of the channel chat",
          } as never;
        const status = inside.has(`${c!.id}:${p.user_id}`) ? "member" : "left";
        return {
          ok: true,
          result: { status, user: { id: Number(p.user_id), is_bot: false, first_name: "x" } },
        } as never;
      }
      return {
        ok: true,
        result: {
          message_id: 1,
          date: 0,
          chat: { id: Number(p.chat_id), type: "private", first_name: "x" },
          text: "ok",
        },
      } as never;
    });
    registerJoinFlowHandlers(bot, bots[key], deps);
    return bot;
  }
  const grammy = {
    sports: makeBot("sports"),
    dating: makeBot("dating"),
    casino: makeBot("casino"),
  };

  let updateId = 1;
  /**
   * Demande d'adhésion d'un utilisateur à un canal, par un lien (gérée par le bot principal du canal). Comme Telegram,
   * un lien créé par un autre de nos bots arrive masqué (fin remplacée par « … »), avec son créateur.
   */
  async function request(c: (typeof CHANNELS)[number], userId: number, url?: string, lang = "fr") {
    const creator = url ? (creatorOfUrl[url] ?? linkBotOfUrl(url)) : undefined;
    const shown = url && creator && creator !== c.bot ? masked(url) : url;
    await grammy[c.bot].handleUpdate({
      update_id: updateId++,
      chat_join_request: {
        chat: { id: Number(c.telegramChatId), type: "channel", title: c.title },
        from: { id: userId, is_bot: false, first_name: `U${userId}`, language_code: lang },
        user_chat_id: userId,
        date: Math.floor(Date.now() / 1000),
        ...(shown
          ? {
              invite_link: {
                invite_link: shown,
                creator: {
                  id: creator ? Number(bots[creator].telegramBotId) : 1,
                  is_bot: true,
                  first_name: "b",
                },
                creates_join_request: true,
                is_primary: false,
                is_revoked: false,
              },
            }
          : {}),
      },
    } as Update);
    return [...memberships]
      .reverse()
      .find((m) => m.memberId === `m${userId}` && m.channelId === c.id)!;
  }
  /** « ✅ J'ai rejoint » : /start g<code> envoyé au bot qui a écrit l'accueil. */
  async function joined(key: BotKey, userId: number, code: string) {
    const before = calls.length;
    await grammy[key].handleUpdate({
      update_id: updateId++,
      message: {
        message_id: updateId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: userId, type: "private", first_name: `U${userId}` },
        from: { id: userId, is_bot: false, first_name: `U${userId}`, language_code: "fr" },
        text: `/start g${code}`,
        entities: [{ type: "bot_command", offset: 0, length: 6 }],
      },
    } as Update);
    const newCalls = calls.slice(before);
    return { reply: newCalls.filter((c) => c.method === "sendMessage").at(-1), calls: newCalls };
  }
  const urlOf = (button: { url?: string } | undefined) => button!.url!;
  function linkBotOfUrl(url: string): BotKey | undefined {
    const l = links.find((x) => x.telegramInviteLink === url);
    return l ? linkBot[l.id] : undefined;
  }
  /** Lien déjà enregistré (avant cette demande), créé par `bot`. */
  function addLink(
    link: Omit<
      InviteLinkInfo,
      "campaignId" | "adCampaignName" | "adName" | "adPlatform" | "name"
    > & { bot: BotKey; createsJoinRequest?: boolean },
  ) {
    const { bot, createsJoinRequest: cjr, ...rest } = link;
    links.push({
      ...rest,
      name: rest.sourceChannelId ? `gate:${rest.sourceChannelId}` : rest.id,
      campaignId: null,
      adPlatform: null,
      adCampaignName: null,
      adName: null,
    });
    linkBot[rest.id] = bot;
    createsJoinRequest[rest.id] = cjr ?? true;
  }
  return {
    deps,
    rules,
    links,
    createsJoinRequest,
    memberships,
    dms,
    events,
    calls,
    inside,
    request,
    joined,
    urlOf,
    addLink,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("scénario du client : Tir Cadré ↔ Zone Interdite (exigences croisées, délai selon la provenance)", () => {
  it("venu d'une pub sur Tir Cadré → bouton Zone Interdite → demande sur Zone (1 jour, court message) → « ✅ J'ai rejoint » accepté grâce à la demande en attente", async () => {
    const w = world();
    const tir = await w.request(TIR, 501, "https://t.me/+adTir");
    expect(tir.status).toBe("PENDING_GATE");
    expect(tir.source.provenance).toEqual({
      type: "AD",
      inviteLinkId: "l_ad_tir",
      sourceChannelId: null,
      adPlatform: "TIKTOK",
      label: "Venu d'une pub TikTok (« Pub TikTok Tir »)",
    });
    expect(tir.source.appliedRule).toEqual({ id: "t_def", scope: "DEFAULT", label: null });

    // Accueil complet du bot de Tir Cadré : lien vers Zone créé directement par le bot de Zone (celui qui recevra la
    // demande), AVEC demande d'adhésion.
    const welcome = w.dms.filter((d) => d.memberId === "m501");
    expect(welcome).toHaveLength(1);
    expect(welcome[0]).toMatchObject({ botId: "bot_sports", kind: "WELCOME" });
    expect(welcome[0]!.buttons.map((r) => r[0]!.text)).toEqual([
      "Rejoindre Zone Interdite 🔞",
      "✅ J'ai rejoint",
    ]);
    const created = w.calls.filter((c) => c.method === "createChatInviteLink");
    expect(created.map((c) => [c.bot, c.payload.creates_join_request])).toEqual([["dating", true]]);
    const gateUrl = w.urlOf(welcome[0]!.buttons[0]![0]);
    expect(w.createsJoinRequest["l_gate_cTir_cZone"]).toBe(true);

    // Le membre clique « Rejoindre Zone Interdite » : demande sur Zone, venue de Tir Cadré → exception 1 jour.
    const zone = await w.request(ZONE, 501, gateUrl);
    expect(zone.status).toBe("SCHEDULED");
    expect(zone.approvalRuleId).toBe("z_tir");
    expect(zone.approveAt!.getTime() - zone.requestedAt.getTime()).toBe(86_400_000);
    expect(zone.source.provenance).toMatchObject({
      type: "GATE",
      sourceChannelId: TIR.id,
      label: "Venu de « 🎯 TIR CADRÉ ⚡ » (canal obligatoire)",
    });
    expect(zone.source.appliedRule).toEqual({
      id: "z_tir",
      scope: "SOURCE_CHANNEL",
      label: "Venu de « Tir Cadré »",
    });
    const requested = w.events.find(
      (e) => e.type === "membership.requested" && e.channelId === ZONE.id,
    );
    expect(requested?.payload).toMatchObject({
      membershipId: zone.id,
      provenance: { type: "GATE", sourceChannelId: TIR.id },
      appliedRule: { id: "z_tir", scope: "SOURCE_CHANNEL" },
    });
    // Court message du bot de Zone (jamais un second accueil complet), sans bouton.
    const short = w.dms.filter((d) => d.memberId === "m501" && d.botId === "bot_dating");
    expect(short).toHaveLength(1);
    expect(short[0]).toMatchObject({ kind: "WELCOME", buttons: [] });
    expect(short[0]!.text).toBe(
      "Ta demande pour <b>Zone Interdite 🔞</b> est bien reçue, accès dans 1 jour.",
    );

    // « ✅ J'ai rejoint » sur Tir Cadré : Telegram dirait « left » (demande en attente), notre demande suffit.
    const { reply, calls } = await w.joined("sports", 501, tir.code);
    expect(calls.filter((c) => c.method === "getChatMember")).toEqual([]);
    expect(tir.status).toBe("SCHEDULED");
    expect(tir.approveAt!.getTime() - tir.gateSatisfiedAt!.getTime()).toBe(3_600_000);
    expect(String(reply!.payload.text)).toBe(
      "C'est bon U501, tu seras accepté dans <b>🎯 TIR CADRÉ ⚡</b> dans 1 heure.",
    );
    // Un seul accueil complet en tout, aucune boucle.
    expect(w.dms.filter((d) => d.memberId === "m501" && d.buttons.length > 0)).toHaveLength(1);
  });

  it("venu d'ailleurs sur Zone Interdite → Roulette (sans règle : entrée directe) et Tir Cadré (règle par défaut sans canaux) → « ✅ J'ai rejoint » → acceptée 5 minutes après le clic", async () => {
    const w = world();
    const zone = await w.request(ZONE, 502, "https://t.me/+inconnu");
    expect(zone.status).toBe("PENDING_GATE");
    expect(zone.inviteLinkId).toBeNull();
    expect(zone.source.provenance).toMatchObject({
      type: "UNKNOWN",
      label: "Venu d'un autre lien",
    });
    expect(zone.source.appliedRule).toEqual({ id: "z_def", scope: "DEFAULT", label: null });
    const welcome = w.dms.find((d) => d.memberId === "m502")!;
    expect(welcome.buttons.map((r) => r[0]!.text)).toEqual([
      "Rejoindre LA ZONE ROULETTE 🎰",
      "Rejoindre 🎯 TIR CADRÉ ⚡",
      "✅ J'ai rejoint",
    ]);

    // Roulette n'a aucune règle : la personne venue du bouton entre tout de suite, sans aucun message.
    const roulette = await w.request(ROULETTE, 502, w.urlOf(welcome.buttons[0]![0]));
    expect(roulette.status).toBe("SCHEDULED");
    expect(roulette.approveAt!.getTime()).toBe(roulette.requestedAt.getTime());
    expect(roulette.approvalRuleId).toBeNull();
    expect(roulette.source).toMatchObject({
      noRule: "IMMEDIATE",
      appliedRule: null,
      provenance: { type: "GATE", sourceChannelId: ZONE.id },
    });
    expect(w.dms.filter((d) => d.botId === "bot_casino")).toEqual([]);

    // Tir Cadré exige Zone, mais la personne vient de Zone : règle par défaut sans canal imposé, délai 1 heure.
    const tir = await w.request(TIR, 502, w.urlOf(welcome.buttons[1]![0]));
    expect(tir.status).toBe("SCHEDULED");
    expect(tir.approveAt!.getTime() - tir.requestedAt.getTime()).toBe(3_600_000);
    expect(tir.source.appliedRule).toEqual({
      id: "t_def",
      scope: "DEFAULT",
      label: null,
      noGates: true,
    });
    const fromTir = w.dms.filter((d) => d.botId === "bot_sports" && d.memberId === "m502");
    expect(fromTir).toHaveLength(1);
    expect(fromTir[0]!.text).toBe(
      "Ta demande pour <b>🎯 TIR CADRÉ ⚡</b> est bien reçue, accès dans 1 heure.",
    );
    expect(fromTir[0]!.buttons).toEqual([]);
    // Jamais un canal que l'accueil n'a pas demandé : rien à renvoyer pour Tir Cadré.
    expect(await resendGateWelcome(w.deps, tir.id)).toEqual({ status: "not_pending" });

    // « ✅ J'ai rejoint » sur Zone : les deux demandes en attente comptent, acceptation 5 minutes après le clic.
    const { reply, calls } = await w.joined("dating", 502, zone.code);
    expect(calls.filter((c) => c.method === "getChatMember")).toEqual([]);
    expect(zone.status).toBe("SCHEDULED");
    expect(zone.approveAt!.getTime() - zone.gateSatisfiedAt!.getTime()).toBe(300_000);
    expect(String(reply!.payload.text)).toContain(
      "tu seras accepté dans <b>Zone Interdite 🔞</b> dans 5 minutes",
    );
    expect(
      w.events
        .filter((e) => e.type === "membership.gate_satisfied")
        .map((e) => e.payload.membershipId),
    ).toEqual([zone.id]);
    expect(w.dms.filter((d) => d.memberId === "m502" && d.buttons.length > 0)).toHaveLength(1);
  });

  it("avec l'exception de la reprise (« venu du bouton → tout de suite, sans message ») : aucun message de Tir Cadré, entrée tout de suite", async () => {
    const rules = clientRules();
    rules[TIR.id]!.push(
      rule({
        id: "t_d7",
        scope: "SOURCE_KIND",
        sourceKind: "GATE",
        mode: "IMMEDIATE",
        sendWelcome: false,
        sendAcceptedMessage: false,
        label: "Venu du bouton « canal à rejoindre » d'un de nos canaux",
      }),
    );
    const w = world(rules);
    await w.request(ZONE, 503, "https://t.me/+metaZone");
    const welcome = w.dms.find((d) => d.memberId === "m503")!;
    const tir = await w.request(TIR, 503, w.urlOf(welcome.buttons[1]![0]));
    expect(tir).toMatchObject({ status: "SCHEDULED", approvalRuleId: "t_d7" });
    expect(tir.approveAt!.getTime()).toBe(tir.requestedAt.getTime());
    expect(w.dms.filter((d) => d.botId === "bot_sports")).toEqual([]);
  });

  it("demande retirée ou refusée dans le canal obligatoire : plus comptée, Telegram vérifie", async () => {
    const w = world();
    const zone = await w.request(ZONE, 504);
    const welcome = w.dms.find((d) => d.memberId === "m504")!;
    const roulette = await w.request(ROULETTE, 504, w.urlOf(welcome.buttons[0]![0]));
    await w.request(TIR, 504, w.urlOf(welcome.buttons[1]![0]));
    roulette.status = "DECLINED";
    const r1 = await w.joined("dating", 504, zone.code);
    expect(zone.status).toBe("PENDING_GATE");
    expect(r1.calls.filter((c) => c.method === "getChatMember").map((c) => c.bot)).toEqual([
      "casino",
    ]);
    expect(String(r1.reply!.payload.text)).toContain("LA ZONE ROULETTE");
    // Entrée réelle (getChatMember « member ») : accepté.
    w.inside.add(`${ROULETTE.id}:504`);
    await w.joined("dating", 504, zone.code);
    expect(zone.status).toBe("SCHEDULED");
  });
});

describe("message à l'arrivée : court message, aucun message, anti-doublon", () => {
  it("anti-doublon : un même bot n'envoie pas deux accueils à la même personne en 10 minutes (événement journalisé), puis de nouveau", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-11T10:00:00Z"));
    const w = world();
    await w.request(PLAIN_A, 505);
    expect(w.dms.filter((d) => d.memberId === "m505")).toHaveLength(1);
    vi.setSystemTime(new Date("2026-10-11T10:02:00Z"));
    const b = await w.request(PLAIN_B, 505);
    expect(w.dms.filter((d) => d.memberId === "m505")).toHaveLength(1);
    expect(w.events.find((e) => e.type === "membership.welcome_skipped")?.payload).toMatchObject({
      membershipId: b.id,
      reason: "duplicate",
      kind: "full",
    });
    expect(b.status).toBe("SCHEDULED");
    // Un accueil avec des canaux à rejoindre n'est jamais tu (ses boutons sont nécessaires pour entrer).
    vi.setSystemTime(new Date("2026-10-11T10:03:00Z"));
    await w.request(PLAIN_C, 505);
    expect(w.dms.filter((d) => d.memberId === "m505")).toHaveLength(2);
    expect(w.dms.at(-1)!.buttons.at(-1)![0]!.text).toBe("✅ J'ai rejoint");
    // Plus de 10 minutes après le dernier accueil : de nouveau envoyé.
    vi.setSystemTime(new Date("2026-10-11T10:14:00Z"));
    await w.request(PLAIN_A, 505);
    expect(w.dms.filter((d) => d.memberId === "m505")).toHaveLength(3);
  });

  it("exception « sans message » (accueil coupé par l'équipe) : aucun message, demande planifiée", async () => {
    const rules = clientRules();
    rules[PLAIN_A.id]!.push(
      rule({
        id: "a_meta",
        scope: "SOURCE_KIND",
        sourceKind: "AD_META",
        sendWelcome: false,
        delaySeconds: 600,
      }),
    );
    const w = world(rules);
    w.links.push({
      ...w.links[1]!,
      id: "l_meta_a",
      channelId: PLAIN_A.id,
      telegramInviteLink: "https://t.me/+metaA",
    });
    const m = await w.request(PLAIN_A, 506, "https://t.me/+metaA");
    expect(m).toMatchObject({ status: "SCHEDULED", approvalRuleId: "a_meta" });
    expect(w.dms).toEqual([]);
  });

  it("exception à valider à la main pour une personne venue d'un canal obligatoire : court message « examinée par l'équipe », dans sa langue", async () => {
    const rules = clientRules();
    rules[ZONE.id]![1] = { ...rules[ZONE.id]![1]!, mode: "MANUAL" };
    const w = world(rules);
    const tir = await w.request(TIR, 507, "https://t.me/+adTir", "en");
    const gateUrl = w.urlOf(w.dms.find((d) => d.memberId === "m507")!.buttons[0]![0]);
    const zone = await w.request(ZONE, 507, gateUrl, "en");
    expect(zone.status).toBe("REQUESTED");
    expect(w.dms.at(-1)!.text).toBe(
      "Your request for <b>Zone Interdite 🔞</b> has been received, it will be reviewed by the team.",
    );
    // La demande à valider compte quand même comme faite pour Tir Cadré.
    await w.joined("sports", 507, tir.code);
    expect(tir.status).toBe("SCHEDULED");
  });
});

describe("délai après « ✅ J'ai rejoint » (le délai démarre au clic)", () => {
  it("1 jour : annoncé « dans 1 jour » ; tout de suite : « immédiatement » ; un nouveau clic annonce le temps restant", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-11T10:00:00Z"));
    const rules = clientRules();
    rules[PLAIN_C.id] = [
      rule({
        id: "c_day",
        isDefault: true,
        delaySeconds: 86_400,
        gateMode: "REQUIRED",
        gateChannelIds: [ROULETTE.id],
      }),
    ];
    const w = world(rules);
    const m = await w.request(PLAIN_C, 508);
    w.inside.add(`${ROULETTE.id}:508`);
    vi.setSystemTime(new Date("2026-10-11T12:00:00Z"));
    const r = await w.joined("dating", 508, m.code);
    expect(m.gateSatisfiedAt!.toISOString()).toBe("2026-10-11T12:00:00.000Z");
    expect(m.approveAt!.toISOString()).toBe("2026-10-12T12:00:00.000Z");
    expect(String(r.reply!.payload.text)).toContain("dans 1 jour");
    vi.setSystemTime(new Date("2026-10-12T00:00:00Z"));
    const again = await w.joined("dating", 508, m.code);
    expect(String(again.reply!.payload.text)).toContain("dans 12 heures");
    expect(m.approveAt!.toISOString()).toBe("2026-10-12T12:00:00.000Z");

    rules[PLAIN_C.id] = [
      rule({
        id: "c_now",
        isDefault: true,
        mode: "IMMEDIATE",
        gateMode: "REQUIRED",
        gateChannelIds: [ROULETTE.id],
      }),
    ];
    const now = await w.request(PLAIN_C, 509);
    w.inside.add(`${ROULETTE.id}:509`);
    const r2 = await w.joined("dating", 509, now.code);
    expect(now.approveAt!.getTime()).toBe(now.gateSatisfiedAt!.getTime());
    expect(String(r2.reply!.payload.text)).toContain("immédiatement");
  });

  it("validation à la main avec des canaux à rejoindre : ni l'accueil ni la réponse au clic n'annoncent une heure d'acceptation, la demande attend l'équipe", async () => {
    // Le formulaire peut enregistrer un délai même quand l'équipe valide à la main (ici 1 jour) : il ne sert à rien.
    const rules = clientRules();
    rules[PLAIN_C.id] = [
      rule({
        id: "c_manual",
        isDefault: true,
        mode: "MANUAL",
        delaySeconds: 86_400,
        gateMode: "REQUIRED",
        gateChannelIds: [ROULETTE.id],
      }),
    ];
    const w = world(rules);
    const m = await w.request(PLAIN_C, 511);
    expect(m.status).toBe("REQUESTED");
    const welcome = w.dms.find((d) => d.memberId === "m511")!;
    expect(welcome.text).toBe(
      "Salut U511 ! Pour rejoindre <b>Rencontres Nice</b>, rejoins d'abord nos canaux partenaires ci-dessous, puis appuie sur ✅ J'ai rejoint. Ton accès est validé par l'équipe.",
    );

    w.inside.add(`${ROULETTE.id}:511`);
    const r = await w.joined("dating", 511, m.code);
    expect(String(r.reply!.payload.text)).toBe(
      "C'est bon U511, ta demande pour <b>Rencontres Nice</b> sera examinée par l'équipe.",
    );
    // Rien n'est planifié : la demande attend l'équipe, les canaux rejoints sont notés.
    expect(m.status).toBe("REQUESTED");
    expect(m.approveAt).toBeNull();
    expect(m.gateSatisfiedAt).toBeInstanceOf(Date);
    // Un second clic donne la même réponse (jamais « immédiatement »).
    const again = await w.joined("dating", 511, m.code);
    expect(String(again.reply!.payload.text)).toBe(String(r.reply!.payload.text));

    // Texte de l'équipe (« Ce que dit le bot », modèle par défaut des canaux) : {delai} devient « par l'équipe ».
    w.deps.getSequenceText = async (_c, _b, trigger) =>
      trigger === "GATE_SATISFIED"
        ? {
            texts: { fr: "Parfait {prenom} ! Tu seras accepté dans <b>{canal}</b> {delai}." },
            buttons: [],
            mediaAssetId: null,
          }
        : null;
    const custom = await w.joined("dating", 511, m.code);
    expect(String(custom.reply!.payload.text)).toBe(
      "Parfait U511 ! Tu seras accepté dans <b>Rencontres Nice</b> par l'équipe.",
    );
  });
});

describe("entrée directe (chat_member) : provenance enregistrée", () => {
  it("ancien lien du bouton « canal à rejoindre » à entrée directe : provenance « venu de Tir Cadré »", async () => {
    const w = world();
    w.links.push({
      id: "l_old",
      kind: "GATE",
      name: `gate:${TIR.id}`,
      channelId: ZONE.id,
      campaignId: null,
      adPlatform: null,
      adCampaignName: null,
      adName: null,
      sourceChannelId: TIR.id,
      telegramInviteLink: "https://t.me/+ancien",
    });
    const user = { id: 510, is_bot: false, first_name: "U510" };
    // Le bot de Zone reçoit l'entrée.
    const deps = w.deps;
    const bot = new Bot("333:TEST", { botInfo: botInfoFromRecord(bots.dating) });
    bot.api.config.use(async () => ({ ok: true, result: true }) as never);
    registerJoinFlowHandlers(bot, bots.dating, deps);
    await bot.handleUpdate({
      update_id: 99,
      chat_member: {
        chat: { id: Number(ZONE.telegramChatId), type: "channel", title: ZONE.title },
        from: user,
        date: 1_760_000_000,
        old_chat_member: { status: "left", user },
        new_chat_member: { status: "member", user },
        invite_link: {
          invite_link: "https://t.me/+ancien",
          creator: { id: 1, is_bot: true, first_name: "b" },
          creates_join_request: false,
          is_primary: false,
          is_revoked: false,
        },
      },
    } as Update);
    const m = w.memberships.find((x) => x.memberId === "m510")!;
    expect(m.status).toBe("APPROVED");
    expect(m.source).toMatchObject({
      joinedDirectly: true,
      appliedRule: null,
      provenance: {
        type: "GATE",
        sourceChannelId: TIR.id,
        inviteLinkId: "l_old",
        label: "Venu de « 🎯 TIR CADRÉ ⚡ » (canal obligatoire)",
      },
    });
  });
});

describe("canal à rejoindre administré par plusieurs de nos bots (Telegram masque la fin d'un lien créé par un autre bot)", () => {
  /** Exception de la reprise (D7) sur Tir Cadré : venu du bouton « canal à rejoindre » → tout de suite, sans message. */
  function rulesWithD7() {
    const rules = clientRules();
    rules[TIR.id]!.push(
      rule({
        id: "t_d7",
        scope: "SOURCE_KIND",
        sourceKind: "GATE",
        mode: "IMMEDIATE",
        sendWelcome: false,
        sendAcceptedMessage: false,
        label: "Venu du bouton « canal à rejoindre » d'un de nos canaux",
      }),
    );
    return rules;
  }
  // Production (11 octobre) : le bot rencontres a été ajouté administrateur de Roulette et de Tir Cadré, dont les bots
  // principaux restent casino et paris sportifs.
  const extraAdmins = { [ROULETTE.id]: ["dating" as const], [TIR.id]: ["dating" as const] };

  it("liens créés par le bot qui traite les demandes de chaque canal à rejoindre : provenance retrouvée, exception D7 et entrée directe appliquées", async () => {
    const w = world(rulesWithD7(), { extraAdmins });
    await w.request(ZONE, 520);
    const welcome = w.dms.find((d) => d.memberId === "m520")!;
    expect(
      w.calls
        .filter((c) => c.method === "createChatInviteLink")
        .map((c) => [c.bot, c.payload.chat_id, c.payload.creates_join_request]),
    ).toEqual([
      ["casino", Number(ROULETTE.telegramChatId), true],
      ["sports", Number(TIR.telegramChatId), true],
    ]);

    // Roulette (aucune règle) : venue du bouton de Zone → entrée tout de suite, sans message.
    const roulette = await w.request(ROULETTE, 520, w.urlOf(welcome.buttons[0]![0]));
    expect(roulette.source.telegramInviteLink).not.toContain("…");
    expect(roulette).toMatchObject({ status: "SCHEDULED", approvalRuleId: null });
    expect(roulette.source).toMatchObject({
      noRule: "IMMEDIATE",
      provenance: { type: "GATE", sourceChannelId: ZONE.id },
    });
    // Tir Cadré : exception de la reprise, tout de suite et sans message (aucun accueil complet de plus).
    const tir = await w.request(TIR, 520, w.urlOf(welcome.buttons[1]![0]));
    expect(tir).toMatchObject({ status: "SCHEDULED", approvalRuleId: "t_d7" });
    expect(tir.approveAt!.getTime()).toBe(tir.requestedAt.getTime());
    expect(w.dms.filter((d) => d.memberId === "m520").map((d) => d.botId)).toEqual(["bot_dating"]);
  });

  it("lien créé par un autre de nos bots (avant la correction, ou bot principal changé depuis) : Telegram en masque la fin, la provenance est retrouvée par son début et son créateur", async () => {
    const w = world(rulesWithD7(), { extraAdmins });
    w.addLink({
      id: "l_zone_tir_dating",
      kind: "GATE",
      channelId: TIR.id,
      sourceChannelId: ZONE.id,
      telegramInviteLink: "https://t.me/+datiZoneVersTir",
      bot: "dating",
    });
    const tir = await w.request(TIR, 521, "https://t.me/+datiZoneVersTir");
    // Le bot paris sportifs n'a reçu que le début du lien.
    expect(tir.source.telegramInviteLink).toBe("https://t.me/+dati…");
    expect(tir.inviteLinkId).toBe("l_zone_tir_dating");
    expect(tir.source.provenance).toMatchObject({
      type: "GATE",
      sourceChannelId: ZONE.id,
      inviteLinkId: "l_zone_tir_dating",
    });
    expect(tir).toMatchObject({ status: "SCHEDULED", approvalRuleId: "t_d7" });
    expect(w.dms.filter((d) => d.memberId === "m521")).toEqual([]);

    // Deux liens de ce bot commencent pareil dans ce canal : jamais une provenance devinée (règle par défaut).
    w.addLink({
      id: "l_a_tir_dating",
      kind: "GATE",
      channelId: TIR.id,
      sourceChannelId: PLAIN_A.id,
      telegramInviteLink: "https://t.me/+datiAutre",
      bot: "dating",
    });
    const unknown = await w.request(TIR, 522, "https://t.me/+datiZoneVersTir");
    expect(unknown.inviteLinkId).toBeNull();
    expect(unknown.source.provenance).toMatchObject({ type: "UNKNOWN" });
  });

  it("entrée directe (chat_member) par un lien masqué : provenance retrouvée de la même façon", async () => {
    const w = world(clientRules(), { extraAdmins });
    w.addLink({
      id: "l_zone_tir_old",
      kind: "GATE",
      channelId: TIR.id,
      sourceChannelId: ZONE.id,
      telegramInviteLink: "https://t.me/+datiAncienDirect",
      bot: "dating",
      createsJoinRequest: false,
    });
    const user = { id: 523, is_bot: false, first_name: "U523" };
    const bot = new Bot("222:TEST", { botInfo: botInfoFromRecord(bots.sports) });
    bot.api.config.use(async () => ({ ok: true, result: true }) as never);
    registerJoinFlowHandlers(bot, bots.sports, w.deps);
    await bot.handleUpdate({
      update_id: 523,
      chat_member: {
        chat: { id: Number(TIR.telegramChatId), type: "channel", title: TIR.title },
        from: user,
        date: 1_760_000_000,
        old_chat_member: { status: "left", user },
        new_chat_member: { status: "member", user },
        invite_link: {
          invite_link: "https://t.me/+dati…",
          creator: { id: Number(bots.dating.telegramBotId), is_bot: true, first_name: "b" },
          creates_join_request: false,
          is_primary: false,
          is_revoked: false,
        },
      },
    } as Update);
    const m = w.memberships.find((x) => x.memberId === "m523")!;
    expect(m).toMatchObject({ status: "APPROVED", inviteLinkId: "l_zone_tir_old" });
    expect(m.source.provenance).toMatchObject({ type: "GATE", sourceChannelId: ZONE.id });
  });
});

describe("« ✅ J'ai rejoint » d'une demande enregistrée avant la mise en ligne (anciens liens à entrée directe)", () => {
  it("l'ancien lien enregistré à l'accueil n'est plus proposé (révoqué au bout de 7 jours) : un nouveau lien avec demande d'adhésion le remplace", async () => {
    const w = world();
    const OLD_ROULETTE = "https://t.me/+ANCIEN_LIEN_DIRECT_REVOQUE";
    const OLD_TIR = "https://t.me/+ANCIEN_TIR_DIRECT";
    w.addLink({
      id: "l_old_roulette",
      kind: "GATE",
      channelId: ROULETTE.id,
      sourceChannelId: ZONE.id,
      telegramInviteLink: OLD_ROULETTE,
      bot: "casino",
      createsJoinRequest: false,
    });
    w.addLink({
      id: "l_old_tir",
      kind: "GATE",
      channelId: TIR.id,
      sourceChannelId: ZONE.id,
      telegramInviteLink: OLD_TIR,
      bot: "sports",
      createsJoinRequest: false,
    });
    const zone = {
      id: "ms_old",
      code: "OLDREQ01",
      memberId: "m524",
      channelId: ZONE.id,
      status: "PENDING_GATE" as const,
      requestedAt: new Date(Date.now() - 3_600_000),
      approveAt: null,
      expiresAt: null,
      userChatId: 524n,
      inviteLinkId: null,
      approvalRuleId: "z_def",
      remindersSent: 1,
      source: {
        gates: [
          { channelId: ROULETTE.id, title: ROULETTE.title, url: OLD_ROULETTE },
          { channelId: TIR.id, title: TIR.title, url: OLD_TIR },
        ],
        gateLinksMissing: [],
        startUrl: "https://t.me/datingoobot?start=gOLDREQ01",
        botId: "bot_dating",
      },
    };
    w.memberships.push(zone);

    const { reply } = await w.joined("dating", 524, "OLDREQ01");
    expect(zone.status).toBe("PENDING_GATE");
    const kb = reply!.payload.reply_markup as {
      inline_keyboard: Array<Array<{ text: string; url: string }>>;
    };
    const urls = kb.inline_keyboard.map((r) => r[0]!.url);
    expect(urls).not.toContain(OLD_ROULETTE);
    expect(urls).not.toContain(OLD_TIR);
    expect(kb.inline_keyboard.map((r) => r[0]!.text)).toEqual([
      "Rejoindre LA ZONE ROULETTE 🎰",
      "Rejoindre 🎯 TIR CADRÉ ⚡",
      "✅ J'ai rejoint",
    ]);
    const created = w.calls.filter((c) => c.method === "createChatInviteLink");
    expect(created.map((c) => [c.bot, c.payload.creates_join_request])).toEqual([
      ["casino", true],
      ["sports", true],
    ]);
    // La demande garde les nouveaux liens (rappels, « Renvoyer l'accueil »).
    expect((zone.source.gates as Array<{ url: string }>).map((g) => g.url)).toEqual(
      urls.slice(0, 2),
    );
    // Second clic : les nouveaux liens sont réutilisés, aucune création de plus.
    await w.joined("dating", 524, "OLDREQ01");
    expect(w.calls.filter((c) => c.method === "createChatInviteLink")).toHaveLength(2);
  });
});

/**
 * Phase 15 : demande d'adhésion par le lien d'une source d'une page d'atterrissage (lien LANDING), mises à jour Telegram
 * simulées, vraie résolution des règles selon la provenance (phase 11) :
 * - provenance LANDING enregistrée sur la demande (page, source, texte « Venu de la page « Promo » (source « tk01 ») ») ;
 * - exceptions « la page Promo » (LANDING_PAGE) et « une page d'atterrissage (toutes) » (LANDING_ANY) ;
 * - compteurs du lien comme les autres liens ; accueil normal, comme une pub ;
 * - la phase 14 reste vraie : validation automatique dès que les canaux obligatoires sont rejoints, joignabilité.
 */
import { describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update } from "grammy/types";
import { provenanceOfLink } from "@linkaffipro/core";
import { botInfoFromRecord } from "../factory";
import type { BotIdentity } from "../ports";
import type { ChannelInfo, InviteLinkInfo, JoinFlowDeps, MembershipInfo } from "../join-flow/deps";
import {
  loadRuleForMembership,
  resolveRuleForProvenance,
  type RuleLoaders,
  type ScopedRuleRow,
} from "../join-flow/rules";
import type { BotStateLike } from "../join-flow/reachability";
import { registerJoinFlowHandlers } from "./join-flow";

const identity: BotIdentity = {
  id: "bot_casino",
  name: "Casino",
  username: "casinobot",
  telegramBotId: 111n,
  vertical: "CASINO",
};
const channel = (id: string, title: string, chatId: bigint): ChannelInfo => ({
  id,
  title,
  username: null,
  language: "fr",
  telegramChatId: chatId,
  primaryBotId: identity.id,
  isActive: true,
});
const VIP = channel("cVip", "Casino VIP 🎰", -100801n);
const BONUS = channel("cBonus", "Bonus du jour", -100802n);
const CHANNELS = [VIP, BONUS];

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
    reminderAfterMinutes: [4, 60],
    maxReminders: 2,
    expireAfterHours: null,
    expireAction: "KEEP",
    sendAcceptedMessage: true,
    isActive: true,
    ...over,
  };
}

/** Canal VIP : par défaut 1 heure ; page « Promo » : canal Bonus obligatoire puis 1 minute ; autres pages : 10 minutes. */
const RULES: Record<string, ScopedRuleRow[]> = {
  [VIP.id]: [
    rule({ id: "r_def", isDefault: true, delaySeconds: 3600 }),
    rule({
      id: "r_page",
      scope: "SOURCE_KIND",
      sourceKind: "LANDING_PAGE",
      landingPageId: "pPromo",
      label: "Venu de la page « Promo »",
      delaySeconds: 60,
      gateMode: "REQUIRED",
      gateChannelIds: [BONUS.id],
    }),
    rule({
      id: "r_pages",
      scope: "SOURCE_KIND",
      sourceKind: "LANDING_ANY",
      label: "Venu d'une page d'atterrissage",
      delaySeconds: 600,
      sortOrder: 1,
    }),
    // Une pub n'est pas une page : cette exception ne doit jamais s'appliquer aux pages.
    rule({
      id: "r_ads",
      scope: "SOURCE_KIND",
      sourceKind: "AD_ANY",
      label: "Venu d'une pub",
      delaySeconds: 5,
      sortOrder: 2,
    }),
  ],
  [BONUS.id]: [rule({ id: "r_bonus", isDefault: true })],
};

const landingLink = (
  id: string,
  pageId: string | null,
  pageName: string | null,
  sourceKey: string,
): InviteLinkInfo => ({
  id,
  kind: "LANDING",
  name: `${pageName ?? "page"}-${sourceKey}`,
  channelId: VIP.id,
  campaignId: "C1",
  adPlatform: null,
  adCampaignName: null,
  adName: null,
  sourceChannelId: null,
  telegramInviteLink: `https://t.me/+${id}`,
  landingPageId: pageId,
  landingSource: sourceKey,
  landingPageName: pageName,
  isActive: true,
});
const LINKS: InviteLinkInfo[] = [
  landingLink("lPromoTk01", "pPromo", "Promo", "tk01"),
  landingLink("lPromoDef", "pPromo", "Promo", ""),
  landingLink("lAutre", "pAutre", "Soirée", "exo1"),
];

type Membership = MembershipInfo & { gateSatisfiedAt?: Date; expiresAt?: Date | null };

function makeWorld(
  opts: { members?: Record<string, string>; botStates?: Record<string, BotStateLike> } = {},
) {
  const members = { ...opts.members };
  const st = {
    memberships: [] as Membership[],
    dms: [] as Array<{ kind: string; text: string; chatId: bigint | null }>,
    events: [] as Array<{ type: string; payload: Record<string, unknown> }>,
    increments: [] as Array<[string, string]>,
    botStates: { ...opts.botStates } as Record<string, BotStateLike>,
  };
  const loaders: RuleLoaders = {
    ruleById: async (id) =>
      Object.values(RULES)
        .flat()
        .find((r) => r.id === id) ?? null,
    channelRules: async (id) => (RULES[id] ?? []).filter((r) => r.isActive),
    linkById: async (id) => LINKS.find((l) => l.id === id) ?? null,
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
    actingBotIdFor: async () => ({ botId: identity.id }),
    findInviteLinkByUrl: async (url) => LINKS.find((l) => l.telegramInviteLink === url) ?? null,
    resolveRule: async (channelId, link) =>
      resolveRuleForProvenance(
        await loaders.channelRules(channelId),
        provenanceOfLink(link),
        channelId,
      ),
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
    scheduleReminder: async () => undefined,
    botState: async (memberId, botId) => st.botStates[`${memberId}:${botId}`] ?? null,
    findMembershipByCode: async (code) => st.memberships.find((m) => m.code === code) ?? null,
    findMembershipById: async (id) => st.memberships.find((m) => m.id === id) ?? null,
    findLatestMembership: async (memberId, channelId) =>
      [...st.memberships]
        .reverse()
        .find((m) => m.memberId === memberId && m.channelId === channelId) ?? null,
    getRuleForMembership: (m) => loadRuleForMembership(m, loaders),
    lastWelcomeAt: async () => null,
    incrementInviteLink: async (id, field) => {
      st.increments.push([id, field]);
    },
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
    adminBots: async () => [{ botId: identity.id, username: identity.username, canInvite: true }],
    apiFor: async () => null,
    warn: () => undefined,
    getMember: async (memberId) => ({ memberId, languageCode: "fr", firstName: "Jean" }),
    getBotIdentity: async (id) => (id === identity.id ? identity : null),
    canWriteTo: async () => false,
    getSequenceText: async () => null,
    enqueueDm: async (i) => {
      st.dms.push({ kind: i.kind, text: i.text, chatId: i.chatId });
      return { outboundMessageId: `om${st.dms.length}` };
    },
    setCanDm: async (m, b, v) => {
      st.botStates[`${m}:${b}`] = { canDm: v, startedAt: v ? new Date() : null, blockedAt: null };
    },
    recordEvent: async (e) => {
      st.events.push({ type: e.type, payload: (e.payload ?? {}) as Record<string, unknown> });
    },
  };
  const bot = new Bot("111:TEST", { botInfo: botInfoFromRecord(identity) });
  bot.api.config.use(async (_prev, method, payload) => {
    const p = payload as Record<string, unknown>;
    if (method === "getChatMember") {
      const chat = CHANNELS.find((c) => Number(c.telegramChatId) === Number(p.chat_id));
      const status = members[`${chat?.id}:${p.user_id}`] ?? "left";
      return {
        ok: true,
        result: { status, user: { id: p.user_id, is_bot: false, first_name: "Jean" } },
      } as never;
    }
    if (method === "sendMessage")
      return {
        ok: true,
        result: { message_id: 7, date: 1, chat: { id: 42, type: "private" }, text: "" },
      } as never;
    return { ok: true, result: true } as never;
  });
  registerJoinFlowHandlers(bot, identity, deps, {
    upsertChannel: vi.fn(async () => ({ channelId: "c_new", created: false })),
    findChannelId: vi.fn(async () => null),
    setChannelAdmin: vi.fn(async () => undefined),
    revokeChannelAdmin: vi.fn(async () => undefined),
    listOurBotTelegramIds: vi.fn(async () => [111n]),
  });
  return { bot, st, members };
}

const nowSec = () => Math.floor(Date.now() / 1000);
const from = (id = 42) => ({ id, is_bot: false, first_name: "Jean", language_code: "fr" });

function joinRequest(c: ChannelInfo, link: string | null, userId = 42): Update {
  return {
    update_id: 1,
    chat_join_request: {
      chat: { id: Number(c.telegramChatId), type: "channel", title: c.title },
      from: from(userId),
      user_chat_id: userId,
      date: nowSec(),
      ...(link
        ? {
            invite_link: {
              invite_link: link,
              creator: { id: 111, is_bot: true, first_name: "Casino" },
              creates_join_request: true,
              is_primary: false,
              is_revoked: false,
            },
          }
        : {}),
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

const vipOf = (st: { memberships: Membership[] }) =>
  st.memberships.find((m) => m.channelId === VIP.id)!;

describe("demande par le lien d'une page d'atterrissage", () => {
  it("source tk01 de la page Promo : provenance LANDING, exception « la page Promo », compteur du lien", async () => {
    const { bot, st } = makeWorld();
    await bot.handleUpdate(joinRequest(VIP, "https://t.me/+lPromoTk01"));
    const m = vipOf(st);
    expect(m.inviteLinkId).toBe("lPromoTk01");
    expect(m.approvalRuleId).toBe("r_page");
    expect(m.status).toBe("PENDING_GATE");
    expect(m.source.provenance).toEqual({
      type: "LANDING",
      inviteLinkId: "lPromoTk01",
      sourceChannelId: null,
      adPlatform: null,
      landing: { pageId: "pPromo", sourceKey: "tk01" },
      label: "Venu de la page « Promo » (source « tk01 »)",
    });
    expect(m.source.appliedRule).toEqual({
      id: "r_page",
      scope: "SOURCE_KIND",
      label: "Venu de la page « Promo »",
    });
    expect(m.source.inviteLink).toMatchObject({
      id: "lPromoTk01",
      kind: "LANDING",
      campaignId: "C1",
      landingPageId: "pPromo",
      landingSource: "tk01",
    });
    expect(st.increments).toEqual([["lPromoTk01", "requests"]]);
    // Accueil normal (comme une pub), envoyé dans les 5 minutes où Telegram laisse le bot écrire.
    const welcome = st.dms.filter((d) => d.kind === "WELCOME");
    expect(welcome).toHaveLength(1);
    expect(welcome[0]!.chatId).toBe(42n);
    const requested = st.events.find((e) => e.type === "membership.requested")!;
    expect(requested.payload.provenance).toMatchObject({
      type: "LANDING",
      landing: { pageId: "pPromo", sourceKey: "tk01" },
    });
  });

  it("phase 14 : la personne rejoint le canal Bonus → validée automatiquement, acceptée 1 minute après", async () => {
    const { bot, st, members } = makeWorld();
    await bot.handleUpdate(joinRequest(VIP, "https://t.me/+lPromoTk01"));
    expect(vipOf(st).status).toBe("PENDING_GATE");
    members["cBonus:42"] = "member";
    await bot.handleUpdate(joined(BONUS));
    const m = vipOf(st);
    expect(m.status).toBe("SCHEDULED");
    expect(m.approveAt!.getTime() - m.gateSatisfiedAt!.getTime()).toBe(60_000);
    expect(
      st.events.filter((e) => e.type === "membership.gate_satisfied")[0]!.payload,
    ).toMatchObject({ auto: true, trigger: "joined" });
  });

  it("lien par défaut de la page (sans ?src=) : même exception, source par défaut gardée", async () => {
    const { bot, st } = makeWorld();
    await bot.handleUpdate(joinRequest(VIP, "https://t.me/+lPromoDef"));
    const m = vipOf(st);
    expect(m.approvalRuleId).toBe("r_page");
    expect(m.source.provenance).toMatchObject({
      landing: { pageId: "pPromo", sourceKey: "" },
      label: "Venu de la page « Promo »",
    });
  });

  it("autre page : exception « une page d'atterrissage (toutes) », jamais l'exception des pubs", async () => {
    const { bot, st } = makeWorld();
    await bot.handleUpdate(joinRequest(VIP, "https://t.me/+lAutre"));
    const m = vipOf(st);
    expect(m.approvalRuleId).toBe("r_pages");
    expect(m.status).toBe("SCHEDULED");
    expect(m.approveAt!.getTime() - m.requestedAt.getTime()).toBe(600_000);
    expect(m.source.provenance).toMatchObject({
      type: "LANDING",
      label: "Venu de la page « Soirée » (source « exo1 »)",
    });
  });

  it("demande sans lien : règle par défaut, aucun compteur", async () => {
    const { bot, st } = makeWorld();
    await bot.handleUpdate(joinRequest(VIP, null));
    expect(vipOf(st).approvalRuleId).toBe("r_def");
    expect(st.increments).toEqual([]);
  });
});

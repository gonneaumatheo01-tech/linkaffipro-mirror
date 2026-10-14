/**
 * Phase 13 : membres amenés par un affilié Link Affi, de bout en bout avec des mises à jour Telegram simulées (demande
 * d'adhésion, entrée, départ) et la vraie résolution des règles selon la provenance :
 * - la demande par le lien d'affilié rattache le membre (premier affilié gagne) ;
 * - l'exception « un affilié précis » / « n'importe quel affilié » s'applique ;
 * - les événements pour Link Affi partent aux bons moments (demande, acceptation hors plateforme, entrée, départ),
 *   avec l'identifiant de la demande (jamais deux identifiants pour le même fait).
 */
import { describe, expect, it } from "vitest";
import { Bot } from "grammy";
import type { Update } from "grammy/types";
import type { EmitLinkaffiEventInput } from "@linkaffipro/queue";
import { botInfoFromRecord } from "../factory";
import type { BotIdentity } from "../ports";
import type {
  ChannelInfo,
  InviteLinkInfo,
  JoinFlowDeps,
  MemberAffiliate,
  MembershipInfo,
} from "../join-flow/deps";
import { resolveRuleForProvenance, type ScopedRuleRow } from "../join-flow/rules";
import { provenanceOfLink } from "@linkaffipro/core";
import { registerJoinFlowHandlers } from "./join-flow";

const identity: BotIdentity = {
  id: "bot_1",
  name: "CasinoBot",
  username: "casinobot",
  telegramBotId: 111n,
  vertical: "CASINO",
};
const CHAN: ChannelInfo = {
  id: "cA",
  title: "Canal Roulette",
  username: null,
  language: "fr",
  telegramChatId: -100100n,
  primaryBotId: "bot_1",
  isActive: true,
};
const OTHER: ChannelInfo = { ...CHAN, id: "cB", title: "Canal Paris", telegramChatId: -100200n };

function link(over: Partial<InviteLinkInfo> & { id: string }): InviteLinkInfo {
  return {
    kind: "LINKAFFI",
    name: over.id,
    channelId: CHAN.id,
    campaignId: null,
    adPlatform: null,
    adCampaignName: null,
    adName: null,
    sourceChannelId: null,
    telegramInviteLink: `https://t.me/+${over.id}`,
    linkaffiCampaignKey: null,
    linkaffiCampaignName: null,
    linkaffiAffiliateId: null,
    linkaffiAffiliateName: null,
    attributionDays: null,
    ...over,
  };
}
const PAUL = link({
  id: "paul",
  name: "Paul — Telegram",
  linkaffiCampaignKey: "paulTG01",
  linkaffiCampaignName: "Paul — Telegram",
  linkaffiAffiliateId: "aff-paul",
  linkaffiAffiliateName: "Paul",
});
const MARC = link({
  id: "marc",
  name: "Marc — Telegram",
  linkaffiCampaignKey: "marcTG01",
  linkaffiCampaignName: "Marc — Telegram",
  linkaffiAffiliateId: "aff-marc",
  linkaffiAffiliateName: "Marc",
});
const MARC_B = link({
  ...MARC,
  id: "marcB",
  channelId: OTHER.id,
  telegramInviteLink: "https://t.me/+marcB",
  linkaffiCampaignKey: "marcTG02",
});
/** Campagne de Paul désactivée par Link Affi, lien resté valable chez Telegram (révocation refusée). */
const PAUL_OFF = link({
  ...PAUL,
  id: "paulOff",
  telegramInviteLink: "https://t.me/+paulOff",
  linkaffiCampaignKey: "paulTG09",
  isActive: false,
});
const AD = link({ id: "ad", kind: "AD_ENTRY", adPlatform: "TIKTOK", name: "Pub TikTok" });
const LINKS = [PAUL, MARC, MARC_B, PAUL_OFF, AD];

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
    sendWelcome: false,
    mode: "DELAY",
    delaySeconds: 60,
    gateChannelIds: [],
    gateMode: "NONE",
    reminderAfterMinutes: [],
    maxReminders: 0,
    expireAfterHours: null,
    expireAction: "KEEP",
    sendAcceptedMessage: false,
    isActive: true,
    ...over,
  };
}
/** Canal A : 1 minute par défaut ; affilié Paul → 10 minutes ; n'importe quel autre affilié → 1 heure. */
const RULES: Record<string, ScopedRuleRow[]> = {
  [CHAN.id]: [
    rule({ id: "def", isDefault: true }),
    rule({
      id: "any",
      scope: "SOURCE_KIND",
      sourceKind: "LINKAFFI_ANY",
      label: "N'importe quel affilié",
      delaySeconds: 3600,
      sortOrder: 20,
    }),
    rule({
      id: "paul",
      scope: "SOURCE_KIND",
      sourceKind: "LINKAFFI_AFFILIATE",
      linkaffiAffiliateId: "aff-paul",
      label: "Affilié Paul",
      delaySeconds: 600,
      sortOrder: 10,
    }),
  ],
  [OTHER.id]: [rule({ id: "defB", isDefault: true })],
};

type Membership = MembershipInfo & { joinedAt?: Date; leftAt?: Date };

function world(opts: { inChannelForTelegram?: number[] } = {}) {
  const memberships: Membership[] = [];
  const members = new Map<string, MemberAffiliate>();
  const emitted: EmitLinkaffiEventInput[] = [];
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const deps: JoinFlowDeps = {
    upsertMember: async (u) => {
      const id = `m${u.id}`;
      if (!members.has(id))
        members.set(id, { campaignKey: null, affiliateId: null, attributionEndsAt: null });
      return { memberId: id, languageCode: "fr", firstName: u.first_name };
    },
    findChannelByChatId: async (id) => [CHAN, OTHER].find((c) => c.telegramChatId === id) ?? null,
    getChannels: async (ids) => [CHAN, OTHER].filter((c) => ids.includes(c.id)),
    actingBotIdFor: async () => ({ botId: identity.id }),
    findInviteLinkByUrl: async (url) => LINKS.find((l) => l.telegramInviteLink === url) ?? null,
    resolveRule: async (channelId, l) =>
      resolveRuleForProvenance(RULES[channelId] ?? [], provenanceOfLink(l), channelId),
    createMembership: async (d) => {
      const m: Membership = { ...d, id: `ms${memberships.length + 1}`, remindersSent: 0 };
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
    getRuleForMembership: async () => {
      throw new Error("inutile ici");
    },
    lastWelcomeAt: async () => null,
    incrementInviteLink: async () => undefined,
    findGateLink: async () => null,
    saveGateLink: async () => undefined,
    adminBots: async () => [],
    apiFor: async () => null,
    getMember: async () => null,
    getBotIdentity: async () => identity,
    canWriteTo: async () => false,
    getSequenceText: async () => null,
    enqueueDm: async () => undefined,
    setCanDm: async () => undefined,
    recordEvent: async (e) => {
      events.push({ type: e.type, payload: (e.payload ?? {}) as Record<string, unknown> });
    },
    getMemberAffiliate: async (id) => members.get(id) ?? null,
    attributeAffiliate: async (input) => {
      const cur = members.get(input.memberId);
      if (!cur || cur.campaignKey || cur.affiliateId) return false;
      members.set(input.memberId, {
        campaignKey: input.campaignKey,
        affiliateId: input.affiliateId,
        attributionEndsAt: input.endsAt,
      });
      return true;
    },
    emitLinkaffiEvent: async (input) => {
      emitted.push(input);
      return { status: "queued", eventId: `lap_${input.type}_${input.sourceId}` };
    },
  };
  const bot = new Bot("111:TEST", { botInfo: botInfoFromRecord(identity) });
  const apiCalls: string[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    const p = payload as Record<string, unknown>;
    apiCalls.push(method);
    if (method === "getChatMember")
      return {
        ok: true,
        result: {
          status: opts.inChannelForTelegram?.includes(Number(p.user_id)) ? "member" : "left",
          user: { id: Number(p.user_id), is_bot: false, first_name: "x" },
        },
      } as never;
    return { ok: true, result: true } as never;
  });
  registerJoinFlowHandlers(bot, identity, deps);
  return { bot, deps, memberships, members, emitted, events, apiCalls };
}

let updateId = 1;
const NOW = Math.floor(Date.now() / 1000);

function joinRequest(user: number, l: InviteLinkInfo, chat = CHAN, date = NOW): Update {
  return {
    update_id: updateId++,
    chat_join_request: {
      chat: { id: Number(chat.telegramChatId), type: "channel", title: chat.title },
      from: { id: user, is_bot: false, first_name: `U${user}`, language_code: "fr" },
      user_chat_id: user,
      date,
      invite_link: {
        invite_link: l.telegramInviteLink,
        creator: { id: 111, is_bot: true, first_name: "bot" },
        creates_join_request: true,
        is_primary: false,
        is_revoked: false,
      },
    },
  } as Update;
}

function chatMember(
  user: number,
  from: string,
  to: string,
  l: InviteLinkInfo | null,
  chat = CHAN,
): Update {
  const u = { id: user, is_bot: false, first_name: `U${user}` };
  return {
    update_id: updateId++,
    chat_member: {
      chat: { id: Number(chat.telegramChatId), type: "channel", title: chat.title },
      from: u,
      date: NOW + 5,
      old_chat_member: { status: from, user: u },
      new_chat_member: { status: to, user: u },
      ...(l
        ? {
            invite_link: {
              invite_link: l.telegramInviteLink,
              creator: { id: 111, is_bot: true, first_name: "bot" },
              creates_join_request: true,
              is_primary: false,
              is_revoked: false,
            },
          }
        : {}),
    },
  } as Update;
}

describe("demande d'adhésion par le lien d'un affilié Link Affi", () => {
  it("rattache le membre, garde la provenance et envoie « demande » pour Link Affi", async () => {
    const w = world();
    await w.bot.handleUpdate(joinRequest(501, PAUL));
    expect(w.members.get("m501")).toEqual({
      campaignKey: "paulTG01",
      affiliateId: "aff-paul",
      attributionEndsAt: null,
    });
    const m = w.memberships[0]!;
    expect(m.inviteLinkId).toBe("paul");
    expect(m.source).toMatchObject({
      provenance: {
        type: "LINKAFFI",
        inviteLinkId: "paul",
        linkaffi: {
          campaignKey: "paulTG01",
          campaignName: "Paul — Telegram",
          affiliateId: "aff-paul",
          affiliateName: "Paul",
        },
        label: "Venu de l'affilié « Paul » (campagne « Paul — Telegram »)",
      },
    });
    expect(w.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["membership.requested", "member.affiliate_attributed"]),
    );
    expect(w.emitted).toEqual([
      {
        type: "join_requested",
        sourceId: m.id,
        memberId: "m501",
        channelId: "cA",
        occurredAt: new Date(NOW * 1000),
      },
    ]);
    // Personne déjà dans le canal ? Demandé à Telegram, une fois.
    expect(w.apiCalls.filter((c) => c === "getChatMember")).toHaveLength(1);
  });

  it("exception « un affilié précis » : Paul → 10 minutes ; « n'importe quel affilié » : Marc → 1 heure", async () => {
    const w = world();
    await w.bot.handleUpdate(joinRequest(502, PAUL));
    await w.bot.handleUpdate(joinRequest(503, MARC));
    const [paul, marc] = w.memberships;
    expect(paul!.approvalRuleId).toBe("paul");
    expect(paul!.approveAt!.getTime() - paul!.requestedAt.getTime()).toBe(600_000);
    expect(marc!.approvalRuleId).toBe("any");
    expect(marc!.approveAt!.getTime() - marc!.requestedAt.getTime()).toBe(3_600_000);
    // Lien d'une pub : règle par défaut, aucune attribution.
    await w.bot.handleUpdate(joinRequest(504, AD));
    expect(w.memberships[2]!.approvalRuleId).toBe("def");
    expect(w.members.get("m504")?.campaignKey).toBeNull();
    expect(w.events.filter((e) => e.type.includes("affiliate")).map((e) => e.type)).toEqual([
      "member.affiliate_attributed",
      "member.affiliate_attributed",
    ]);
  });

  it("second affilié : le premier reste, la décision est journalisée", async () => {
    const w = world();
    await w.bot.handleUpdate(joinRequest(505, PAUL));
    await w.bot.handleUpdate(joinRequest(505, MARC_B, OTHER));
    expect(w.members.get("m505")?.campaignKey).toBe("paulTG01");
    const refused = w.events.find((e) => e.type === "membership.affiliate_not_attributed");
    expect(refused?.payload).toMatchObject({
      reason: "already_attributed",
      campaignKey: "marcTG02",
      currentCampaignKey: "paulTG01",
    });
  });

  it("lien d'une campagne désactivée par Link Affi : la demande suit sa règle, sans rattachement", async () => {
    const w = world();
    await w.bot.handleUpdate(joinRequest(507, PAUL_OFF));
    // Pas rattaché : un affilié valable pourra encore l'amener plus tard (premier affilié gagne).
    expect(w.members.get("m507")?.campaignKey).toBeNull();
    const m = w.memberships[0]!;
    expect(m.inviteLinkId).toBe("paulOff");
    // L'admission ne change pas : provenance et exception « affilié Paul » gardées.
    expect(m.approvalRuleId).toBe("paul");
    expect(m.source).toMatchObject({ provenance: { type: "LINKAFFI", inviteLinkId: "paulOff" } });
    expect(
      w.events.find((e) => e.type === "membership.affiliate_not_attributed")?.payload,
    ).toMatchObject({ reason: "link_disabled", campaignKey: "paulTG09" });
    expect(w.events.some((e) => e.type === "member.affiliate_attributed")).toBe(false);
    // Plus tard, le lien valable d'un autre affilié le rattache.
    await w.bot.handleUpdate(joinRequest(507, MARC_B, OTHER));
    expect(w.members.get("m507")?.campaignKey).toBe("marcTG02");
  });

  it("personne déjà dans le canal : aucune attribution", async () => {
    const w = world({ inChannelForTelegram: [506] });
    await w.bot.handleUpdate(joinRequest(506, PAUL));
    expect(w.members.get("m506")?.campaignKey).toBeNull();
    expect(
      w.events.find((e) => e.type === "membership.affiliate_not_attributed")?.payload,
    ).toMatchObject({
      reason: "already_member",
    });
  });
});

describe("entrée et départ d'un membre d'affilié", () => {
  it("demande acceptée hors de la plateforme puis entrée : « acceptée » et « entrée » avec l'identifiant de la demande", async () => {
    const w = world();
    await w.bot.handleUpdate(joinRequest(510, PAUL));
    const ms = w.memberships[0]!.id;
    await w.bot.handleUpdate(chatMember(510, "left", "member", PAUL));
    expect(w.emitted.map((e) => [e.type, e.sourceId])).toEqual([
      ["join_requested", ms],
      ["join_approved", ms],
      ["joined", ms],
    ]);
    // Telegram date l'entrée à la seconde : « entrée » strictement après « acceptée » (ordre du parcours chez Link Affi).
    const approvedAt = w.emitted[1]!.occurredAt!.getTime();
    expect(approvedAt).toBe((NOW + 5) * 1000);
    expect(w.emitted[2]!.occurredAt!.getTime()).toBe(approvedAt + 1);
    // Pas de seconde décision d'attribution à l'entrée.
    expect(w.events.filter((e) => e.type === "member.affiliate_attributed")).toHaveLength(1);
    await w.bot.handleUpdate(chatMember(510, "member", "left", null));
    expect(w.emitted.at(-1)).toMatchObject({ type: "left", sourceId: ms, channelId: "cA" });
  });

  it("entrée après une acceptation déjà enregistrée : seulement « entrée »", async () => {
    const w = world();
    await w.bot.handleUpdate(joinRequest(511, PAUL));
    w.memberships[0]!.status = "APPROVED";
    await w.bot.handleUpdate(chatMember(511, "left", "member", PAUL));
    expect(w.emitted.map((e) => e.type)).toEqual(["join_requested", "joined"]);
  });

  it("acceptation enregistrée dans la même seconde que l'entrée : « entrée » et départ datés après elle", async () => {
    const w = world();
    await w.bot.handleUpdate(joinRequest(514, PAUL));
    const ms = w.memberships[0]!;
    // Acceptée par le site ou le worker à la milliseconde, dans la seconde où Telegram date l'entrée (NOW + 5).
    const approvedAt = new Date((NOW + 5) * 1000 + 384);
    Object.assign(ms, { status: "APPROVED", approvedAt });
    await w.bot.handleUpdate(chatMember(514, "left", "member", PAUL));
    const joined = w.emitted.find((e) => e.type === "joined")!;
    expect(joined.occurredAt).toEqual(new Date(approvedAt.getTime() + 1));
    // Même date dans la demande (rendue à Link Affi par `GET /members`).
    expect(ms.joinedAt).toEqual(joined.occurredAt);
    // Départ dans la même seconde : jamais avant l'entrée.
    await w.bot.handleUpdate(chatMember(514, "member", "left", null));
    const left = w.emitted.find((e) => e.type === "left")!;
    expect(left.occurredAt).toEqual(new Date(approvedAt.getTime() + 2));
    expect(ms.leftAt).toEqual(left.occurredAt);
  });

  it("acceptation ancienne : l'entrée garde la date donnée par Telegram", async () => {
    const w = world();
    await w.bot.handleUpdate(joinRequest(516, PAUL));
    Object.assign(w.memberships[0]!, {
      status: "APPROVED",
      approvedAt: new Date((NOW - 3600) * 1000),
    });
    await w.bot.handleUpdate(chatMember(516, "left", "member", PAUL));
    expect(w.emitted.find((e) => e.type === "joined")!.occurredAt).toEqual(
      new Date((NOW + 5) * 1000),
    );
  });

  it("membre parti puis revenu par le lien du même affilié : toujours à lui, rien de faux au journal", async () => {
    const w = world();
    await w.bot.handleUpdate(joinRequest(515, PAUL));
    w.memberships[0]!.status = "APPROVED";
    await w.bot.handleUpdate(chatMember(515, "left", "member", PAUL));
    await w.bot.handleUpdate(chatMember(515, "member", "left", null));
    await w.bot.handleUpdate(joinRequest(515, PAUL, CHAN, NOW + 60));
    expect(w.members.get("m515")?.campaignKey).toBe("paulTG01");
    expect(w.events.filter((e) => e.type === "membership.affiliate_not_attributed")).toEqual([]);
    expect(w.events.filter((e) => e.type === "member.affiliate_attributed")).toHaveLength(1);
    // La nouvelle demande part quand même pour Link Affi (membre de sa campagne, sur son canal).
    const second = w.memberships.at(-1)!;
    expect(second.id).not.toBe(w.memberships[0]!.id);
    expect(w.emitted.at(-1)).toMatchObject({ type: "join_requested", sourceId: second.id });
  });

  it("entrée directe par le lien d'un affilié (sans demande) : rattaché, puis « entrée »", async () => {
    const w = world();
    await w.bot.handleUpdate(chatMember(512, "left", "member", PAUL));
    expect(w.members.get("m512")?.campaignKey).toBe("paulTG01");
    const ms = w.memberships[0]!;
    expect(ms.status).toBe("APPROVED");
    expect(w.emitted).toEqual([
      expect.objectContaining({ type: "joined", sourceId: ms.id, memberId: "m512" }),
    ]);
    expect(w.events.find((e) => e.type === "member.affiliate_attributed")?.payload).toMatchObject({
      stage: "join",
    });
  });

  it("exclusion d'un membre : « parti » pour Link Affi", async () => {
    const w = world();
    await w.bot.handleUpdate(chatMember(513, "left", "member", PAUL));
    await w.bot.handleUpdate(chatMember(513, "member", "kicked", null));
    expect(w.emitted.map((e) => e.type)).toEqual(["joined", "left"]);
  });
});

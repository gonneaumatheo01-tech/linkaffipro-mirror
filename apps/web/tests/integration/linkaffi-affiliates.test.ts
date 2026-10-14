/**
 * Phase 13 (moteur) : membres amenés par un affilié Link Affi, de bout en bout sur la base réelle avec des mises à jour
 * Telegram simulées (webhook) et l'API Telegram simulée (aucun appel réseau, aucun appel à Link Affi) :
 * demande par le lien d'affilié → membre rattaché, « demande » enregistrée pour Link Affi ; acceptation depuis le site →
 * « acceptée » ; entrée → « entrée » ; clic d'offre → lien avec `&tg=`, clé sur le clic, « offer_clicked » ; second
 * affilié → rien ne change ; personne déjà dans le canal → pas d'attribution ; refus → « refusée » ; départ → « parti ».
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type * as QueueClient from "../../../../packages/queue/src/client";
import { prisma } from "@linkaffipro/db";
import { getOrCreateBot, prismaTelegramDeps } from "@linkaffipro/telegram";
import type { InlineKeyboardMarkup } from "grammy/types";
import { POST } from "@/app/api/telegram/[botId]/route";
import {
  capturedJobs,
  createBotAndChannel,
  ctx,
  flushAfter,
  resetDb,
  webhookRequest,
} from "./helpers";

// Ajout à la file `linkaffi-events` (emitLinkaffiEvent) : capturé en mémoire, jamais le Redis local.
vi.mock("../../../../packages/queue/src/client", async (importOriginal) => {
  const orig = await importOriginal<typeof QueueClient>();
  return {
    ...orig,
    enqueue: async (
      name: string,
      data: Record<string, unknown>,
      opts: Record<string, unknown> = {},
    ) => {
      (globalThis.__jobs ??= []).push({ queue: name, data, opts });
      return { id: opts.jobId };
    },
    getRedis: () => {
      throw new Error("Redis indisponible dans ce test");
    },
    getQueue: () => {
      throw new Error("getQueue indisponible dans ce test");
    },
  };
});

// « Accepter » / « Refuser » depuis le site : API Telegram simulée.
const telegram = vi.hoisted(() => ({ calls: [] as Array<{ method: string; args: unknown[] }> }));
vi.mock("grammy", async (importOriginal) => {
  const orig = await importOriginal<typeof import("grammy")>();
  class FakeApi {
    constructor(_token: string) {}
    async approveChatJoinRequest(...args: unknown[]) {
      telegram.calls.push({ method: "approveChatJoinRequest", args });
      return true;
    }
    async declineChatJoinRequest(...args: unknown[]) {
      telegram.calls.push({ method: "declineChatJoinRequest", args });
      return true;
    }
  }
  return { ...orig, Api: FakeApi };
});

const CHAT_A = -100_913_001n;
const CHAT_B = -100_913_002n;
const PAUL_URL = "https://t.me/+PaulRoulette01";
const MARC_URL = "https://t.me/+MarcParis01";
const OFFER_KEY = "47eb8mwc";
const ids = { bot: "", a: "", b: "", paulLink: "", marcLink: "", paulRule: "", post: "" };
/** Statut renvoyé par getChatMember (simulé) par identifiant Telegram ; « left » par défaut. */
const inChannel = new Map<number, string>();
let updateId = 1000;
/** Titre réel du canal (le webhook met à jour le titre enregistré d'après la mise à jour). */
const titleOf = (chat: bigint) => (chat === CHAT_A ? "Canal Roulette 🎰" : "Canal Paris");

function joinRequest(
  user: number,
  url: string,
  chat: bigint,
  date = Math.floor(Date.now() / 1000) - 5,
) {
  return {
    update_id: updateId++,
    chat_join_request: {
      chat: { id: Number(chat), type: "channel", title: titleOf(chat) },
      from: {
        id: user,
        is_bot: false,
        first_name: `Nora${user}`,
        username: `nora${user}`,
        language_code: "fr",
      },
      user_chat_id: user,
      date,
      invite_link: {
        invite_link: url,
        creator: { id: 111, is_bot: true, first_name: "Bot test" },
        creates_join_request: true,
        is_primary: false,
        is_revoked: false,
      },
    },
  };
}

function chatMember(
  user: number,
  from: string,
  to: string,
  url: string | null,
  chat = CHAT_A,
  date = Math.floor(Date.now() / 1000),
) {
  const u = { id: user, is_bot: false, first_name: `Nora${user}` };
  return {
    update_id: updateId++,
    chat_member: {
      chat: { id: Number(chat), type: "channel", title: titleOf(chat) },
      from: u,
      date,
      old_chat_member: { status: from, user: u },
      new_chat_member: { status: to, user: u },
      ...(url
        ? {
            invite_link: {
              invite_link: url,
              creator: { id: 111, is_bot: true, first_name: "Bot test" },
              creates_join_request: true,
              is_primary: false,
              is_revoked: false,
            },
          }
        : {}),
    },
  };
}

function start(user: number, payload: string) {
  return {
    update_id: updateId++,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: user, type: "private", first_name: `Nora${user}` },
      from: { id: user, is_bot: false, first_name: `Nora${user}`, language_code: "fr" },
      text: `/start ${payload}`,
      entities: [{ type: "bot_command", offset: 0, length: 6 }],
    },
  };
}

const sent: Array<Record<string, unknown>> = [];

async function webhook(update: unknown) {
  const res = await POST(webhookRequest(update), ctx({ botId: ids.bot }));
  expect(res.status).toBe(200);
  await flushAfter();
}

async function memberOf(user: number) {
  return prisma.member.findUniqueOrThrow({ where: { telegramUserId: BigInt(user) } });
}

async function lastMembership(user: number, channelId: string) {
  const m = await memberOf(user);
  return prisma.membership.findFirstOrThrow({
    where: { memberId: m.id, channelId },
    orderBy: { requestedAt: "desc" },
  });
}

beforeAll(async () => {
  await resetDb();
  await prisma.linkaffiEvent.deleteMany();
  const { bot, channel } = await createBotAndChannel({
    chatId: CHAT_A,
    title: "Canal Roulette 🎰",
  });
  ids.bot = bot.id;
  ids.a = channel.id;
  const b = await prisma.channel.create({
    data: {
      telegramChatId: CHAT_B,
      title: "Canal Paris",
      type: "CHANNEL",
      language: "fr",
      primaryBotId: bot.id,
      isTest: true,
    },
  });
  ids.b = b.id;
  await prisma.channelBotAdmin.create({
    data: {
      channelId: b.id,
      botId: bot.id,
      rights: { status: "administrator", can_invite_users: true },
    },
  });
  const paul = await prisma.inviteLink.create({
    data: {
      channelId: ids.a,
      botId: bot.id,
      telegramInviteLink: PAUL_URL,
      name: "Paul — Telegram",
      kind: "LINKAFFI",
      linkaffiCampaignKey: "paulTG01",
      linkaffiCampaignName: "Paul — Telegram",
      linkaffiAffiliateId: "aff-paul",
      linkaffiAffiliateName: "Paul",
    },
  });
  ids.paulLink = paul.id;
  ids.marcLink = (
    await prisma.inviteLink.create({
      data: {
        channelId: ids.b,
        botId: bot.id,
        telegramInviteLink: MARC_URL,
        name: "Marc — Telegram",
        kind: "LINKAFFI",
        linkaffiCampaignKey: "marcTG01",
        linkaffiCampaignName: "Marc — Telegram",
        linkaffiAffiliateId: "aff-marc",
        linkaffiAffiliateName: "Marc",
      },
    })
  ).id;
  const ruleBase = {
    mode: "DELAY" as const,
    gateMode: "NONE" as const,
    gateChannelIds: [],
    reminderAfterMinutes: [],
    maxReminders: 0,
    sendWelcome: false,
    sendAcceptedMessage: false,
  };
  for (const channelId of [ids.a, ids.b])
    await prisma.approvalRule.create({
      data: { ...ruleBase, channelId, name: "Par défaut", isDefault: true, delaySeconds: 60 },
    });
  // Exception de la phase 13 : venu de l'affilié Paul → 10 minutes.
  ids.paulRule = (
    await prisma.approvalRule.create({
      data: {
        ...ruleBase,
        channelId: ids.a,
        name: "Affilié Paul",
        scope: "SOURCE_KIND",
        sourceKind: "LINKAFFI_AFFILIATE",
        linkaffiAffiliateId: "aff-paul",
        label: "Venu de l'affilié « Paul »",
        delaySeconds: 600,
        sortOrder: 10,
      },
    })
  ).id;
  const program = await prisma.affiliateProgram.create({
    data: { name: "Casino", source: "LINKAFFI", externalId: "cas-aff" },
  });
  const offer = await prisma.affiliateCampaign.create({
    data: {
      programId: program.id,
      externalId: "camp-aff",
      campaignKey: OFFER_KEY,
      name: "Offre casino",
      trackingUrlTemplate: `https://linkaffi.me/go/${OFFER_KEY}?sub_id={subid}`,
    },
  });
  ids.post = (
    await prisma.post.create({
      data: {
        code: "AFFPOST1",
        channelId: ids.a,
        botId: bot.id,
        status: "SENT",
        text: "Bonus",
        sentAt: new Date(),
      },
    })
  ).id;
  await prisma.trackingLink.create({
    data: {
      slug: "affoff01",
      kind: "OFFER",
      destinationTemplate: offer.trackingUrlTemplate,
      label: "Offre",
      affiliateCampaignId: offer.id,
      postId: ids.post,
      channelId: ids.a,
    },
  });
  await prisma.trackingLink.create({
    data: {
      slug: "autre001",
      kind: "OFFER",
      destinationTemplate: "https://casino.example/promo?s={subid}",
      label: "Autre adresse",
      channelId: ids.a,
    },
  });
  const api = getOrCreateBot(bot, prismaTelegramDeps).api;
  api.config.use(async (_prev, method, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    if (method === "getChatMember")
      return {
        ok: true,
        result: {
          status: inChannel.get(Number(p.user_id)) ?? "left",
          user: { id: Number(p.user_id), is_bot: false, first_name: "x" },
        },
      } as never;
    if (method === "sendMessage") {
      sent.push(p);
      return {
        ok: true,
        result: {
          message_id: sent.length,
          date: 0,
          chat: { id: Number(p.chat_id), type: "private" },
          text: "",
        },
      } as never;
    }
    return { ok: true, result: true } as never;
  });
});

afterAll(async () => {
  await prisma.linkaffiEvent.deleteMany();
  await resetDb();
});

describe("membre amené par un affilié Link Affi (webhook, base réelle)", () => {
  it("demande par le lien de Paul : membre rattaché, règle de l'affilié, « demande » enregistrée pour Link Affi", async () => {
    const requestedAt = Math.floor(Date.now() / 1000) - 5;
    await webhook(joinRequest(7001, PAUL_URL, CHAT_A, requestedAt));
    const member = await memberOf(7001);
    expect(member).toMatchObject({
      linkaffiCampaignKey: "paulTG01",
      linkaffiAffiliateId: "aff-paul",
      affiliateInviteLinkId: ids.paulLink,
      affiliateAttributionEndsAt: null,
    });
    expect(member.affiliateAttributedAt?.getTime()).toBe(requestedAt * 1000);

    const ms = await lastMembership(7001, ids.a);
    expect(ms.inviteLinkId).toBe(ids.paulLink);
    expect(ms.approvalRuleId).toBe(ids.paulRule);
    expect(ms.approveAt!.getTime() - ms.requestedAt.getTime()).toBe(600_000);
    expect(ms.source).toMatchObject({
      provenance: {
        type: "LINKAFFI",
        inviteLinkId: ids.paulLink,
        linkaffi: { campaignKey: "paulTG01", affiliateId: "aff-paul", affiliateName: "Paul" },
        label: "Venu de l'affilié « Paul » (campagne « Paul — Telegram »)",
      },
      appliedRule: { id: ids.paulRule, scope: "SOURCE_KIND" },
    });

    const attributed = await prisma.event.findFirst({
      where: { memberId: member.id, type: "member.affiliate_attributed" },
    });
    expect(attributed?.payload).toMatchObject({
      membershipId: ms.id,
      inviteLinkId: ids.paulLink,
      campaignKey: "paulTG01",
      affiliateId: "aff-paul",
      stage: "request",
    });

    const eventId = `lap_join_requested_${ms.id}`;
    const row = await prisma.linkaffiEvent.findUniqueOrThrow({ where: { eventId } });
    expect(row).toMatchObject({
      type: "join_requested",
      campaignKey: "paulTG01",
      memberId: member.id,
      channelId: ids.a,
      status: "PENDING",
      attempts: 0,
    });
    expect(row.body).toEqual({
      eventId,
      type: "join_requested",
      occurredAt: new Date(requestedAt * 1000).toISOString(),
      campaignKey: "paulTG01",
      channel: { id: ids.a, title: "Canal Roulette 🎰" },
      member: {
        telegramUserId: "7001",
        username: "nora7001",
        firstName: "Nora7001",
        languageCode: "fr",
      },
      data: {},
    });
    expect(capturedJobs("linkaffi-events")).toContainEqual({
      queue: "linkaffi-events",
      data: { type: "deliver", eventId },
      opts: { jobId: `linkaffi-event:${eventId}` },
    });
  });

  it("acceptation depuis le site : « acceptée », une seule fois même si on clique deux fois", async () => {
    const { approveNow } = await import("@/lib/approval/telegram");
    const ms = await lastMembership(7001, ids.a);
    expect(await approveNow(ms.id, "user-test")).toEqual({ ok: true });
    expect(await approveNow(ms.id, "user-test")).toEqual({ ok: true });
    const rows = await prisma.linkaffiEvent.findMany({ where: { type: "join_approved" } });
    expect(rows.map((r) => r.eventId)).toEqual([`lap_join_approved_${ms.id}`]);
  });

  it("entrée dans le canal : « entrée », sans seconde attribution", async () => {
    await webhook(chatMember(7001, "left", "member", PAUL_URL));
    const ms = await lastMembership(7001, ids.a);
    expect(ms.joinedAt).not.toBeNull();
    expect(
      await prisma.linkaffiEvent.findUnique({ where: { eventId: `lap_joined_${ms.id}` } }),
    ).not.toBeNull();
    // Acceptation déjà enregistrée : pas de second « acceptée ».
    expect(await prisma.linkaffiEvent.count({ where: { type: "join_approved" } })).toBe(1);
    const member = await memberOf(7001);
    expect(
      await prisma.event.count({
        where: { memberId: member.id, type: "member.affiliate_attributed" },
      }),
    ).toBe(1);
  });

  it("clic d'offre : lien Link Affi avec `&tg=`, clé sur le clic, « offer_clicked » avec sub-ID et clé de l'offre", async () => {
    await webhook(start(7001, "oaffoff01_AFFPOST1"));
    const member = await memberOf(7001);
    const click = await prisma.click.findFirstOrThrow({
      where: { memberId: member.id },
      orderBy: { createdAt: "desc" },
    });
    expect(click.destination).toBe(
      `https://linkaffi.me/go/${OFFER_KEY}?sub_id=${click.subId}&tg=paulTG01`,
    );
    expect(click.linkaffiTelegramCampaignKey).toBe("paulTG01");
    const reply = sent.at(-1)!;
    expect((reply.reply_markup as InlineKeyboardMarkup).inline_keyboard[0]![0]).toMatchObject({
      url: click.destination,
    });
    const row = await prisma.linkaffiEvent.findUniqueOrThrow({
      where: { eventId: `lap_offer_clicked_${click.id}` },
    });
    expect(row.body).toMatchObject({
      type: "offer_clicked",
      campaignKey: "paulTG01",
      channel: { id: ids.a, title: "Canal Roulette 🎰" },
      member: { telegramUserId: "7001" },
      data: { subId: click.subId, offerCampaignKey: OFFER_KEY },
    });
  });

  it("bouton vers une autre adresse : jamais de `tg`", async () => {
    await webhook(start(7001, "oautre001"));
    const member = await memberOf(7001);
    const click = await prisma.click.findFirstOrThrow({
      where: { memberId: member.id },
      orderBy: { createdAt: "desc" },
    });
    expect(click.destination).toBe(`https://casino.example/promo?s=${click.subId}`);
    expect(click.linkaffiTelegramCampaignKey).toBeNull();
  });

  it("second affilié (lien de Marc, autre canal) : Paul reste, décision journalisée, rien pour Link Affi", async () => {
    await webhook(joinRequest(7001, MARC_URL, CHAT_B));
    const member = await memberOf(7001);
    expect(member.linkaffiCampaignKey).toBe("paulTG01");
    expect(member.linkaffiAffiliateId).toBe("aff-paul");
    const refused = await prisma.event.findFirst({
      where: { memberId: member.id, type: "membership.affiliate_not_attributed" },
    });
    expect(refused?.payload).toMatchObject({
      reason: "already_attributed",
      campaignKey: "marcTG01",
      currentCampaignKey: "paulTG01",
    });
    const ms = await lastMembership(7001, ids.b);
    expect(
      await prisma.linkaffiEvent.count({ where: { eventId: `lap_join_requested_${ms.id}` } }),
    ).toBe(0);
  });

  it("personne déjà dans le canal (demande acceptée, ou membre selon Telegram) : pas d'attribution", async () => {
    const already = await prisma.member.create({
      data: { telegramUserId: 7002n, firstName: "Déjà" },
    });
    await prisma.membership.create({
      data: {
        code: "aff-deja-1",
        memberId: already.id,
        channelId: ids.a,
        status: "APPROVED",
        requestedAt: new Date(Date.now() - 86_400_000),
      },
    });
    await webhook(joinRequest(7002, PAUL_URL, CHAT_A));
    inChannel.set(7003, "member");
    await webhook(joinRequest(7003, PAUL_URL, CHAT_A));
    for (const user of [7002, 7003]) {
      const m = await memberOf(user);
      expect(m.linkaffiCampaignKey).toBeNull();
      const ev = await prisma.event.findFirst({
        where: { memberId: m.id, type: "membership.affiliate_not_attributed" },
      });
      expect(ev?.payload).toMatchObject({ reason: "already_member", campaignKey: "paulTG01" });
      expect(await prisma.linkaffiEvent.count({ where: { memberId: m.id } })).toBe(0);
    }
  });

  it("campagne désactivée par Link Affi (lien resté valable chez Telegram) : demande admise, aucun rattachement", async () => {
    const offUrl = "https://t.me/+PaulFerme01";
    await prisma.inviteLink.create({
      data: {
        channelId: ids.a,
        botId: ids.bot,
        telegramInviteLink: offUrl,
        name: "Paul — ancienne campagne",
        kind: "LINKAFFI",
        linkaffiCampaignKey: "paulTG09",
        linkaffiCampaignName: "Paul — ancienne campagne",
        linkaffiAffiliateId: "aff-paul",
        linkaffiAffiliateName: "Paul",
        isActive: false,
      },
    });
    await webhook(joinRequest(7010, offUrl, CHAT_A));
    const m = await memberOf(7010);
    expect(m).toMatchObject({
      linkaffiCampaignKey: null,
      linkaffiAffiliateId: null,
      affiliateInviteLinkId: null,
    });
    const ms = await lastMembership(7010, ids.a);
    // Admission inchangée : provenance de l'affilié et son exception (10 minutes).
    expect(ms.approvalRuleId).toBe(ids.paulRule);
    expect(ms.source).toMatchObject({ provenance: { type: "LINKAFFI" } });
    const ev = await prisma.event.findFirst({
      where: { memberId: m.id, type: "membership.affiliate_not_attributed" },
    });
    expect(ev?.payload).toMatchObject({ reason: "link_disabled", campaignKey: "paulTG09" });
    expect(await prisma.linkaffiEvent.count({ where: { memberId: m.id } })).toBe(0);
  });

  it("membre sans affilié qui clique une offre : lien d'origine, rien pour Link Affi", async () => {
    await webhook(start(7004, "oaffoff01_AFFPOST1"));
    const m = await memberOf(7004);
    const click = await prisma.click.findFirstOrThrow({ where: { memberId: m.id } });
    expect(click.destination).toBe(`https://linkaffi.me/go/${OFFER_KEY}?sub_id=${click.subId}`);
    expect(click.linkaffiTelegramCampaignKey).toBeNull();
    expect(await prisma.linkaffiEvent.count({ where: { memberId: m.id } })).toBe(0);
  });

  it("refus depuis le site : « refusée »", async () => {
    await webhook(joinRequest(7005, PAUL_URL, CHAT_A));
    const ms = await lastMembership(7005, ids.a);
    const { declineNow } = await import("@/lib/approval/telegram");
    expect(await declineNow(ms.id, "user-test")).toEqual({ ok: true });
    const row = await prisma.linkaffiEvent.findUniqueOrThrow({
      where: { eventId: `lap_join_declined_${ms.id}` },
    });
    expect(row).toMatchObject({
      type: "join_declined",
      campaignKey: "paulTG01",
      status: "PENDING",
    });
  });

  it("départ du canal : « parti », une seule fois", async () => {
    await webhook(chatMember(7001, "member", "left", null));
    await webhook(chatMember(7001, "member", "left", null));
    const ms = await lastMembership(7001, ids.a);
    expect(ms.status).toBe("LEFT");
    expect(await prisma.linkaffiEvent.count({ where: { eventId: `lap_left_${ms.id}` } })).toBe(1);
    const member = await memberOf(7001);
    // Parcours complet de ce membre sur le canal de sa campagne, tel que Link Affi le recevra.
    const types = (
      await prisma.linkaffiEvent.findMany({
        where: { memberId: member.id },
        orderBy: { createdAt: "asc" },
      })
    ).map((r) => r.type);
    expect(types).toEqual([
      "join_requested",
      "join_approved",
      "joined",
      "offer_clicked",
      "offer_clicked",
      "left",
    ]);
  });

  it("acceptation depuis le site puis entrée dans la même seconde : « acceptée » avant « entrée » pour Link Affi", async () => {
    const { approveNow } = await import("@/lib/approval/telegram");
    const { loadLinkaffiCampaignMembers } = await import("@/lib/integrations/linkaffi/members");
    await webhook(joinRequest(7020, PAUL_URL, CHAT_A));
    const ms = await lastMembership(7020, ids.a);
    expect(await approveNow(ms.id, "user-test")).toEqual({ ok: true });
    const approvedAt = (await prisma.membership.findUniqueOrThrow({ where: { id: ms.id } }))
      .approvedAt!;
    // Telegram date l'entrée à la seconde (tronquée) où l'acceptation a eu lieu.
    await webhook(
      chatMember(7020, "left", "member", PAUL_URL, CHAT_A, Math.floor(approvedAt.getTime() / 1000)),
    );
    const accepted = await prisma.linkaffiEvent.findUniqueOrThrow({
      where: { eventId: `lap_join_approved_${ms.id}` },
    });
    // Même date pour la demande acceptée et pour Link Affi.
    expect(accepted.occurredAt).toEqual(approvedAt);
    const joined = await prisma.linkaffiEvent.findUniqueOrThrow({
      where: { eventId: `lap_joined_${ms.id}` },
    });
    expect(joined.occurredAt.getTime()).toBe(approvedAt.getTime() + 1);
    // Rattrapage par Link Affi (`GET /members`, trié par date) : le parcours dans l'ordre, dates cohérentes.
    const payload = (await loadLinkaffiCampaignMembers("paulTG01", null))!;
    expect(
      payload.events.filter((e) => e.member.telegramUserId === "7020").map((e) => e.type),
    ).toEqual(["join_requested", "join_approved", "joined"]);
    const view = payload.members.find((m) => m.telegramUserId === "7020")!;
    expect(view.status).toBe("joined");
    expect(view.approvedAt).toBe(approvedAt.toISOString());
    expect(view.joinedAt).toBe(joined.occurredAt.toISOString());
  });

  it("acceptée hors de la plateforme : « acceptée » puis « entrée », strictement dans cet ordre", async () => {
    const { loadLinkaffiCampaignMembers } = await import("@/lib/integrations/linkaffi/members");
    await webhook(joinRequest(7021, PAUL_URL, CHAT_A));
    const date = Math.floor(Date.now() / 1000);
    await webhook(chatMember(7021, "left", "member", PAUL_URL, CHAT_A, date));
    const payload = (await loadLinkaffiCampaignMembers("paulTG01", null))!;
    expect(
      payload.events
        .filter((e) => e.member.telegramUserId === "7021")
        .map((e) => [e.type, e.occurredAt]),
    ).toEqual([
      ["join_requested", expect.any(String)],
      ["join_approved", new Date(date * 1000).toISOString()],
      ["joined", new Date(date * 1000 + 1).toISOString()],
    ]);
  });
});

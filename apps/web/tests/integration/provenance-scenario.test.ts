/**
 * Phase 11 par la vraie route du webhook (base réelle) : provenance et règle appliquée enregistrées sur la demande et
 * dans le journal, court message pour une personne venue d'un canal obligatoire, lien du bouton « canal à rejoindre »
 * avec demande d'adhésion (l'ancien lien à entrée directe n'est plus proposé, ni affiché comme prêt dans
 * « Vérifier les liens »), « ✅ J'ai rejoint » satisfait par une demande en attente.
 *
 * Scénario du client : « 🎯 TIR CADRÉ ⚡ » exige « Zone Interdite 🔞 » ; « Zone Interdite 🔞 » exige
 * « LA ZONE ROULETTE 🎰 » et « Tir Cadré » (puis 5 minutes), sauf venu de Tir Cadré → 1 jour.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { Api } from "grammy";
import { prisma } from "@linkaffipro/db";
import { getOrCreateBot, prismaTelegramDeps } from "@linkaffipro/telegram";
import { POST } from "@/app/api/telegram/[botId]/route";
import { entryRuleFromRow } from "@/lib/channels/entry-rule";
import { loadGateLinkView } from "@/lib/channels/gate-links-server";
import {
  createTestBot,
  ctx,
  flushAfter,
  resetDb,
  webhookRequest,
  type TelegramCall,
} from "./helpers";

const ZONE = -1001600000001n;
const ROULETTE = -1001600000002n;
const TIR = -1001600000003n;
const AD_TIR = "https://t.me/+PubTikTokTir";
const OLD_GATE = "https://t.me/+AncienTirVersZone";
const TITLES: Record<string, string> = {
  [String(ZONE)]: "Zone Interdite 🔞",
  [String(ROULETTE)]: "LA ZONE ROULETTE 🎰",
  [String(TIR)]: "🎯 TIR CADRÉ ⚡",
};

type Buttons = Array<Array<{ text: string; url: string }>>;

/**
 * Telegram simulé : un bot ne crée un lien et ne lit les membres que dans les canaux qu'il administre (un ou plusieurs
 * de nos bots par canal).
 */
function install(
  api: Api,
  selfId: number,
  admins: Map<number, number | readonly number[]>,
): TelegramCall[] {
  const calls: TelegramCall[] = [];
  let next = 1;
  api.config.use(async (_prev, method, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    calls.push({ method, payload: p });
    const chat = Number(p.chat_id);
    const isAdmin = [admins.get(chat)].flat().includes(selfId);
    if (method === "createChatInviteLink") {
      if (!isAdmin)
        return {
          ok: false,
          error_code: 400,
          description: "Bad Request: not enough rights to manage chat invite links",
        } as never;
      return {
        ok: true,
        result: {
          invite_link: `https://t.me/+w${selfId}c${String(chat).slice(-2)}n${next++}`,
          creator: { id: selfId, is_bot: true, first_name: "b" },
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
      // Une demande d'adhésion en attente : Telegram répond « left ».
      return {
        ok: true,
        result: { status: "left", user: { id: Number(p.user_id), is_bot: false, first_name: "x" } },
      } as never;
    }
    if (/^send(Message|Photo|Video|Animation|Document)$/.test(method))
      return {
        ok: true,
        result: {
          message_id: next++,
          date: Math.floor(Date.now() / 1000),
          chat: { id: chat, type: "private" },
          text: p.text ?? "",
        },
      } as never;
    return { ok: true, result: true } as never;
  });
  return calls;
}

let updateId = 1;
/** Demande d'adhésion ; `creator` : identifiant Telegram du bot qui a créé le lien (Telegram le transmet). */
function joinRequest(chatId: bigint, userId: number, link?: string, creator = 1) {
  return {
    update_id: updateId++,
    chat_join_request: {
      chat: { id: Number(chatId), type: "channel", title: TITLES[String(chatId)] },
      from: { id: userId, is_bot: false, first_name: `Membre${userId}`, language_code: "fr" },
      user_chat_id: userId,
      date: Math.floor(Date.now() / 1000) - 5,
      ...(link
        ? {
            invite_link: {
              invite_link: link,
              creator: { id: creator, is_bot: true, first_name: "b" },
              creates_join_request: true,
              is_primary: false,
              is_revoked: false,
            },
          }
        : {}),
    },
  };
}
function startCommand(userId: number, code: string) {
  return {
    update_id: updateId++,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: userId, type: "private", first_name: `Membre${userId}` },
      from: { id: userId, is_bot: false, first_name: `Membre${userId}`, language_code: "fr" },
      text: `/start g${code}`,
      entities: [{ type: "bot_command", offset: 0, length: 6 }],
    },
  };
}

describe("phase 11 par le webhook : règles selon la provenance (base réelle)", () => {
  const admins = new Map<number, number>([
    [Number(ZONE), 333],
    [Number(ROULETTE), 111],
    [Number(TIR), 222],
  ]);
  const ids = { zone: "", roulette: "", tir: "", exception: "", tirRule: "" };
  const bots: Record<"dating" | "casino" | "sports", { id: string; n: number }> = {} as never;
  const calls: Record<string, TelegramCall[]> = {};

  async function post(bot: keyof typeof bots, update: unknown) {
    const res = await POST(
      webhookRequest(update, `secret-${bots[bot].n}`),
      ctx({ botId: bots[bot].id }),
    );
    expect(res.status).toBe(200);
    await flushAfter();
  }
  async function channel(chatId: bigint, botId: string) {
    const c = await prisma.channel.create({
      data: {
        telegramChatId: chatId,
        title: TITLES[String(chatId)]!,
        language: "fr",
        primaryBotId: botId,
        isTest: true,
      },
    });
    await prisma.channelBotAdmin.create({
      data: { channelId: c.id, botId, rights: { status: "administrator", can_invite_users: true } },
    });
    return c.id;
  }
  const latest = (tgId: number, channelId: string) =>
    prisma.membership.findFirstOrThrow({
      where: { member: { telegramUserId: BigInt(tgId) }, channelId },
      orderBy: { requestedAt: "desc" },
    });

  beforeAll(async () => {
    await resetDb();
    for (const [key, n, vertical] of [
      ["dating", 333, "DATING"],
      ["casino", 111, "CASINO"],
      ["sports", 222, "SPORTS"],
    ] as const) {
      const b = await createTestBot(n, vertical);
      bots[key] = { id: b.id, n };
      calls[key] = install(getOrCreateBot(b, prismaTelegramDeps).api, n, admins);
    }
    ids.zone = await channel(ZONE, bots.dating.id);
    ids.roulette = await channel(ROULETTE, bots.casino.id);
    ids.tir = await channel(TIR, bots.sports.id);
    const tirRule = await prisma.approvalRule.create({
      data: {
        channelId: ids.tir,
        name: "Règle par défaut",
        isDefault: true,
        scope: "DEFAULT",
        mode: "IMMEDIATE",
        gateMode: "REQUIRED",
        gateChannelIds: [ids.zone],
        reminderAfterMinutes: [],
        maxReminders: 0,
      },
    });
    ids.tirRule = tirRule.id;
    await prisma.approvalRule.create({
      data: {
        channelId: ids.zone,
        name: "Règle par défaut",
        isDefault: true,
        scope: "DEFAULT",
        mode: "DELAY",
        delaySeconds: 300,
        gateMode: "REQUIRED",
        gateChannelIds: [ids.roulette, ids.tir],
        reminderAfterMinutes: [],
        maxReminders: 0,
      },
    });
    const ex = await prisma.approvalRule.create({
      data: {
        channelId: ids.zone,
        name: "Venu de « Tir Cadré »",
        label: "Venu de « Tir Cadré »",
        scope: "SOURCE_CHANNEL",
        sourceChannelId: ids.tir,
        sortOrder: 10,
        mode: "DELAY",
        delaySeconds: 86_400,
      },
    });
    ids.exception = ex.id;
    await prisma.inviteLink.create({
      data: {
        channelId: ids.tir,
        botId: bots.sports.id,
        telegramInviteLink: AD_TIR,
        name: "Pub TikTok Tir",
        kind: "AD_ENTRY",
        adPlatform: "TIKTOK",
      },
    });
    // Ancien lien du bouton de Tir Cadré vers Zone (entrée directe, avant la phase 11).
    await prisma.inviteLink.create({
      data: {
        channelId: ids.zone,
        botId: bots.dating.id,
        telegramInviteLink: OLD_GATE,
        name: `gate:${ids.tir}`,
        kind: "GATE",
        createsJoinRequest: false,
        sourceChannelId: ids.tir,
      },
    });
  });

  it("« Vérifier les liens » : l'ancien lien à entrée directe n'est pas affiché comme prêt", async () => {
    const rule = await prisma.approvalRule.findUniqueOrThrow({ where: { id: ids.tirRule } });
    const view = await loadGateLinkView(ids.tir, entryRuleFromRow(rule));
    expect(view!.rows.map((r) => [r.title, r.state])).toEqual([["Zone Interdite 🔞", "pending"]]);
  });

  it("pub sur Tir Cadré → accueil avec un nouveau lien vers Zone (demande d'adhésion) → demande sur Zone : provenance, exception 1 jour, court message", async () => {
    await post("sports", joinRequest(TIR, 8001, AD_TIR));
    const tir = await latest(8001, ids.tir);
    expect(tir.status).toBe("PENDING_GATE");
    expect(tir.source).toMatchObject({
      provenance: {
        type: "AD",
        adPlatform: "TIKTOK",
        sourceChannelId: null,
        label: "Venu d'une pub TikTok (« Pub TikTok Tir »)",
      },
      appliedRule: { id: ids.tirRule, scope: "DEFAULT", label: null },
    });
    const welcome = await prisma.outboundMessage.findFirstOrThrow({
      where: { memberId: tir.memberId, kind: "WELCOME" },
    });
    const buttons = welcome.buttons as Buttons;
    expect(buttons[0]![0]!.url).not.toBe(OLD_GATE);
    const link = await prisma.inviteLink.findUniqueOrThrow({
      where: { telegramInviteLink: buttons[0]![0]!.url },
    });
    expect(link).toMatchObject({
      kind: "GATE",
      channelId: ids.zone,
      sourceChannelId: ids.tir,
      botId: bots.dating.id,
      createsJoinRequest: true,
    });
    expect(calls.dating!.find((c) => c.method === "createChatInviteLink")?.payload).toMatchObject({
      chat_id: Number(ZONE),
      creates_join_request: true,
    });
    // L'interface suit : le lien est maintenant prêt.
    const rule = await prisma.approvalRule.findUniqueOrThrow({ where: { id: ids.tirRule } });
    expect((await loadGateLinkView(ids.tir, entryRuleFromRow(rule)))!.rows[0]!.state).toBe("ok");

    await post("dating", joinRequest(ZONE, 8001, link.telegramInviteLink));
    const zone = await latest(8001, ids.zone);
    expect(zone).toMatchObject({
      status: "SCHEDULED",
      approvalRuleId: ids.exception,
      inviteLinkId: link.id,
    });
    expect(zone.approveAt!.getTime() - zone.requestedAt.getTime()).toBe(86_400_000);
    expect(zone.source).toMatchObject({
      provenance: {
        type: "GATE",
        sourceChannelId: ids.tir,
        inviteLinkId: link.id,
        label: "Venu de « 🎯 TIR CADRÉ ⚡ » (canal obligatoire)",
      },
      appliedRule: { id: ids.exception, scope: "SOURCE_CHANNEL", label: "Venu de « Tir Cadré »" },
    });
    const event = await prisma.event.findFirstOrThrow({
      where: { type: "membership.requested", channelId: ids.zone },
    });
    expect(event.payload).toMatchObject({
      membershipId: zone.id,
      provenance: { type: "GATE" },
      appliedRule: { id: ids.exception },
    });
    const short = await prisma.outboundMessage.findFirstOrThrow({
      where: { memberId: zone.memberId, botId: bots.dating.id },
    });
    expect(short).toMatchObject({
      kind: "WELCOME",
      text: "Ta demande pour <b>Zone Interdite 🔞</b> est bien reçue, accès dans 1 jour.",
      buttons: [],
    });

    // « ✅ J'ai rejoint » sur Tir Cadré : Telegram répond « left », la demande en attente sur Zone suffit.
    const before = { dating: calls.dating!.length, sports: calls.sports!.length };
    await post("sports", startCommand(8001, tir.code));
    const after = [...calls.dating!.slice(before.dating), ...calls.sports!.slice(before.sports)];
    expect(after.filter((c) => c.method === "getChatMember")).toEqual([]);
    const reply = after.filter((c) => c.method === "sendMessage").at(-1)!;
    expect(String(reply.payload.text)).toBe(
      "C'est bon Membre8001, tu seras accepté dans <b>🎯 TIR CADRÉ ⚡</b> immédiatement.",
    );
    expect((await latest(8001, ids.tir)).status).toBe("SCHEDULED");
  });

  it("venu de Zone sur Tir Cadré (exigences croisées) : Zone n'est pas redemandé, aucun accueil complet de plus", async () => {
    await post("dating", joinRequest(ZONE, 8002));
    const zone = await latest(8002, ids.zone);
    expect(zone.status).toBe("PENDING_GATE");
    const welcome = await prisma.outboundMessage.findFirstOrThrow({
      where: { memberId: zone.memberId, kind: "WELCOME" },
    });
    const tirUrl = (welcome.buttons as Buttons)[1]![0]!.url;
    await post("sports", joinRequest(TIR, 8002, tirUrl));
    const tir = await latest(8002, ids.tir);
    // Règle par défaut de Tir Cadré, sans le canal Zone (d'où vient la personne) : entrée tout de suite.
    expect(tir).toMatchObject({ status: "SCHEDULED", approvalRuleId: ids.tirRule });
    expect(tir.source).toMatchObject({
      appliedRule: { id: ids.tirRule, scope: "DEFAULT", noGates: true },
      provenance: { type: "GATE", sourceChannelId: ids.zone },
    });
    const fromTir = await prisma.outboundMessage.findMany({
      where: { memberId: zone.memberId, botId: bots.sports.id },
    });
    expect(fromTir.map((m) => [m.text, m.buttons])).toEqual([
      ["Ta demande pour <b>🎯 TIR CADRÉ ⚡</b> est bien reçue, accès immédiatement.", []],
    ]);
  });
});

describe("canal à rejoindre administré par plusieurs de nos bots : Telegram masque la fin d'un lien créé par un autre bot (base réelle)", () => {
  // Production (11 octobre) : le bot rencontres a été ajouté administrateur de Roulette et de Tir Cadré, dont les bots
  // principaux restent casino et paris sportifs.
  const admins = new Map<number, number[]>([
    [Number(ZONE), [333]],
    [Number(ROULETTE), [111, 333]],
    [Number(TIR), [222, 333]],
  ]);
  const OLD_DATING_LINK = "https://t.me/+DatiZoneVersTirAncien";
  const ids = { zone: "", roulette: "", tir: "", tirD7: "", oldLink: "", zoneRule: "" };
  const bots: Record<"dating" | "casino" | "sports", { id: string; n: number }> = {} as never;
  const calls: Record<string, TelegramCall[]> = {};

  async function post(bot: keyof typeof bots, update: unknown) {
    const res = await POST(
      webhookRequest(update, `secret-${bots[bot].n}`),
      ctx({ botId: bots[bot].id }),
    );
    expect(res.status).toBe(200);
    await flushAfter();
  }
  async function channel(chatId: bigint, adminBots: string[]) {
    const c = await prisma.channel.create({
      data: {
        telegramChatId: chatId,
        title: TITLES[String(chatId)]!,
        language: "fr",
        primaryBotId: adminBots[0]!,
        isTest: true,
      },
    });
    // Le bot principal d'abord, le bot rencontres ajouté ensuite (comme en production).
    for (const [i, botId] of adminBots.entries())
      await prisma.channelBotAdmin.create({
        data: {
          channelId: c.id,
          botId,
          rights: { status: "administrator", can_invite_users: true },
          detectedAt: new Date(Date.now() - (10 - i) * 60_000),
        },
      });
    return c.id;
  }
  const latest = (tgId: number, channelId: string) =>
    prisma.membership.findFirstOrThrow({
      where: { member: { telegramUserId: BigInt(tgId) }, channelId },
      orderBy: { requestedAt: "desc" },
    });

  beforeAll(async () => {
    await resetDb();
    for (const [key, n, vertical] of [
      ["dating", 333, "DATING"],
      ["casino", 111, "CASINO"],
      ["sports", 222, "SPORTS"],
    ] as const) {
      const b = await createTestBot(n, vertical);
      bots[key] = { id: b.id, n };
      calls[key] = install(getOrCreateBot(b, prismaTelegramDeps).api, n, admins);
    }
    ids.zone = await channel(ZONE, [bots.dating.id]);
    ids.roulette = await channel(ROULETTE, [bots.casino.id, bots.dating.id]);
    ids.tir = await channel(TIR, [bots.sports.id, bots.dating.id]);
    const zoneRule = await prisma.approvalRule.create({
      data: {
        channelId: ids.zone,
        name: "Règle par défaut",
        isDefault: true,
        scope: "DEFAULT",
        mode: "DELAY",
        delaySeconds: 300,
        gateMode: "REQUIRED",
        gateChannelIds: [ids.roulette, ids.tir],
        reminderAfterMinutes: [],
        maxReminders: 0,
      },
    });
    ids.zoneRule = zoneRule.id;
    await prisma.approvalRule.create({
      data: {
        channelId: ids.tir,
        name: "Règle par défaut",
        isDefault: true,
        scope: "DEFAULT",
        mode: "IMMEDIATE",
        gateMode: "REQUIRED",
        gateChannelIds: [ids.zone],
        reminderAfterMinutes: [],
        maxReminders: 0,
      },
    });
    // Exception de la reprise (`pnpm db:phase11`) : venu du bouton « canal à rejoindre » → tout de suite, sans message.
    const d7 = await prisma.approvalRule.create({
      data: {
        channelId: ids.tir,
        name: "Venu du bouton « canal à rejoindre » d'un de nos canaux",
        label: "Venu du bouton « canal à rejoindre » d'un de nos canaux",
        scope: "SOURCE_KIND",
        sourceKind: "GATE",
        sortOrder: 10,
        mode: "IMMEDIATE",
        delaySeconds: 0,
        gateMode: "NONE",
        gateChannelIds: [],
        sendWelcome: false,
        sendAcceptedMessage: false,
        reminderAfterMinutes: [],
        maxReminders: 0,
      },
    });
    ids.tirD7 = d7.id;
    // Lien de Zone vers Tir Cadré créé par le bot rencontres avant la correction (avec demande d'adhésion).
    const old = await prisma.inviteLink.create({
      data: {
        channelId: ids.tir,
        botId: bots.dating.id,
        telegramInviteLink: OLD_DATING_LINK,
        name: `gate:${ids.zone}`,
        kind: "GATE",
        createsJoinRequest: true,
        sourceChannelId: ids.zone,
      },
    });
    ids.oldLink = old.id;
  });

  it("accueil de Zone : liens créés par le bot de chaque canal à rejoindre (jamais par le bot rencontres), provenance retrouvée, exception D7 et entrée directe appliquées", async () => {
    await post("dating", joinRequest(ZONE, 8101));
    const zone = await latest(8101, ids.zone);
    expect(zone.status).toBe("PENDING_GATE");
    expect(calls.dating!.filter((c) => c.method === "createChatInviteLink")).toEqual([]);
    const created = await prisma.inviteLink.findMany({
      where: { kind: "GATE", sourceChannelId: ids.zone, id: { not: ids.oldLink } },
      orderBy: { createdAt: "asc" },
    });
    expect(created.map((l) => [l.channelId, l.botId, l.createsJoinRequest])).toEqual([
      [ids.roulette, bots.casino.id, true],
      [ids.tir, bots.sports.id, true],
    ]);
    const welcome = await prisma.outboundMessage.findFirstOrThrow({
      where: { memberId: zone.memberId, kind: "WELCOME" },
    });
    const urls = (welcome.buttons as Buttons).map((r) => r[0]!.url);
    expect(urls.slice(0, 2)).toEqual(created.map((l) => l.telegramInviteLink));
    expect(urls).not.toContain(OLD_DATING_LINK);

    // Roulette (aucune règle) : venue du bouton de Zone, lien entier (créé par le bot casino) → entrée tout de suite.
    await post("casino", joinRequest(ROULETTE, 8101, urls[0], 111));
    const roulette = await latest(8101, ids.roulette);
    expect(roulette).toMatchObject({
      status: "SCHEDULED",
      approvalRuleId: null,
      inviteLinkId: created[0]!.id,
    });
    expect(roulette.source).toMatchObject({
      noRule: "IMMEDIATE",
      provenance: { type: "GATE", sourceChannelId: ids.zone },
    });
    // Tir Cadré : exception de la reprise, sans aucun message.
    await post("sports", joinRequest(TIR, 8101, urls[1], 222));
    const tir = await latest(8101, ids.tir);
    expect(tir).toMatchObject({ status: "SCHEDULED", approvalRuleId: ids.tirD7 });
    expect(
      await prisma.outboundMessage.count({
        where: { memberId: zone.memberId, botId: { in: [bots.casino.id, bots.sports.id] } },
      }),
    ).toBe(0);
  });

  it("lien créé par le bot rencontres, reçu masqué par le bot paris sportifs : retrouvé par son début et son créateur ; créateur inconnu : provenance inconnue", async () => {
    await post("sports", joinRequest(TIR, 8102, "https://t.me/+Dati…", 333));
    const tir = await latest(8102, ids.tir);
    expect(tir).toMatchObject({
      status: "SCHEDULED",
      approvalRuleId: ids.tirD7,
      inviteLinkId: ids.oldLink,
    });
    expect(tir.source).toMatchObject({
      telegramInviteLink: "https://t.me/+Dati…",
      provenance: { type: "GATE", sourceChannelId: ids.zone, inviteLinkId: ids.oldLink },
      appliedRule: { id: ids.tirD7, scope: "SOURCE_KIND" },
    });
    expect(await prisma.outboundMessage.count({ where: { memberId: tir.memberId } })).toBe(0);
    expect(
      (await prisma.inviteLink.findUniqueOrThrow({ where: { id: ids.oldLink } })).requests,
    ).toBe(1);

    // Même début, mais un créateur qui n'est pas un de nos bots : jamais deviné, règle par défaut.
    await post("sports", joinRequest(TIR, 8103, "https://t.me/+Dati…", 999));
    const other = await latest(8103, ids.tir);
    expect(other).toMatchObject({ status: "PENDING_GATE", inviteLinkId: null });
    expect(other.source).toMatchObject({ provenance: { type: "UNKNOWN" } });
  });

  it("« ✅ J'ai rejoint » d'une demande d'avant la mise en ligne : l'ancien lien à entrée directe enregistré n'est plus proposé, le lien avec demande d'adhésion le remplace", async () => {
    const OLD_DIRECT = "https://t.me/+AncienDirectZoneVersRoulette";
    await prisma.inviteLink.create({
      data: {
        channelId: ids.roulette,
        botId: bots.casino.id,
        telegramInviteLink: OLD_DIRECT,
        name: `gate:${ids.zone}`,
        kind: "GATE",
        createsJoinRequest: false,
        sourceChannelId: ids.zone,
        createdAt: new Date(Date.now() - 86_400_000),
      },
    });
    const member = await prisma.member.create({
      data: { telegramUserId: 8104n, firstName: "Membre8104", languageCode: "fr" },
    });
    const m = await prisma.membership.create({
      data: {
        code: "ancien8104",
        memberId: member.id,
        channelId: ids.zone,
        status: "PENDING_GATE",
        approvalRuleId: ids.zoneRule,
        requestedAt: new Date(Date.now() - 3_600_000),
        source: {
          gates: [{ channelId: ids.roulette, title: TITLES[String(ROULETTE)], url: OLD_DIRECT }],
          gateLinksMissing: [],
          startUrl: "https://t.me/bot_333?start=gancien8104",
          botId: bots.dating.id,
        },
      },
    });
    const before = calls.dating!.length;
    await post("dating", startCommand(8104, m.code));
    const reply = calls
      .dating!.slice(before)
      .filter((c) => c.method === "sendMessage")
      .at(-1)!;
    const kb = reply.payload.reply_markup as { inline_keyboard: Buttons };
    const urls = kb.inline_keyboard.map((r) => r[0]!.url);
    expect(urls).not.toContain(OLD_DIRECT);
    const fresh = await prisma.inviteLink.findFirstOrThrow({
      where: {
        kind: "GATE",
        sourceChannelId: ids.zone,
        channelId: ids.roulette,
        createsJoinRequest: true,
        botId: bots.casino.id,
      },
    });
    expect(urls[0]).toBe(fresh.telegramInviteLink);
    expect(kb.inline_keyboard.map((r) => r[0]!.text)).toEqual([
      "Rejoindre LA ZONE ROULETTE 🎰",
      "Rejoindre 🎯 TIR CADRÉ ⚡",
      "✅ J'ai rejoint",
    ]);
    const saved = await prisma.membership.findUniqueOrThrow({ where: { id: m.id } });
    expect(saved.status).toBe("PENDING_GATE");
    expect(
      ((saved.source as { gates: Array<{ url: string }> }).gates ?? []).map((g) => g.url),
    ).toEqual(urls.slice(0, 2));
  });
});

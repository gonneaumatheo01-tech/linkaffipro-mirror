/**
 * Phase 11 sur base réelle : le scénario exact du client, de la demande jusqu'à l'acceptation par le worker (horloge
 * simulée en reculant les dates enregistrées).
 *
 * - « 🎯 TIR CADRÉ ⚡ » (bot paris sportifs) exige « Zone Interdite 🔞 », puis tout de suite ;
 * - « Zone Interdite 🔞 » (bot rencontres) exige « LA ZONE ROULETTE 🎰 » et « Tir Cadré », puis 5 minutes, avec
 *   l'exception « venu de Tir Cadré → 1 jour » ;
 * - « LA ZONE ROULETTE 🎰 » (bot casino) n'a aucune règle ;
 * - la reprise D7 (`pnpm db:phase11`) a ajouté « venu du bouton « canal à rejoindre » → tout de suite, sans message » sur
 *   Zone et Tir Cadré (canaux obligatoires avec une règle par défaut).
 * Telegram répond « left » pour une demande en attente : seule notre demande prouve qu'elle a été faite.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { encrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { getOrCreateBot, prismaTelegramDeps } from "@linkaffipro/telegram";
import type { Api, Bot } from "grammy";
import type { Update } from "grammy/types";
import {
  createGateExceptions,
  GATE_EXCEPTIONS_KEY,
} from "../../../../packages/db/prisma/phase11-gate-exceptions";
import { apiForBot } from "../../src/approvals/telegram-actions";
import { processApprovals } from "../../src/processors/approvals";
import { fakeJob, resetDb, type TelegramCall } from "./helpers";

const ZONE = -1001300000001n;
const ROULETTE = -1001300000002n;
const TIR = -1001300000003n;
const AD_TIR = "https://t.me/+PubTikTokTirCadre";
const OLD_GATE = "https://t.me/+AncienLienZoneVersTir";

type Buttons = Array<Array<{ text: string; url: string }>>;

/** Telegram simulé bot par bot : un bot ne crée un lien et ne lit les membres que là où il est administrateur. */
function installWorld(
  api: Api,
  selfId: number,
  admins: Map<number, number>,
  inside: Set<string>,
): TelegramCall[] {
  const calls: TelegramCall[] = [];
  let next = 1;
  api.config.use(async (_prev, method, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    calls.push({ method, payload: p });
    const chat = Number(p.chat_id);
    const isAdmin = admins.get(chat) === selfId;
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
          invite_link: `https://t.me/+s${selfId}c${String(chat).slice(-2)}n${next++}`,
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
      const user = Number(p.user_id);
      return {
        ok: true,
        result: {
          status: inside.has(`${chat}:${user}`) ? "member" : "left",
          user: { id: user, is_bot: false, first_name: "x" },
        },
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

function join(chatId: bigint, title: string, userId: number, link?: string): Update {
  return {
    update_id: userId * 10 + Math.floor(Math.random() * 9),
    chat_join_request: {
      chat: { id: Number(chatId), type: "channel", title },
      from: { id: userId, is_bot: false, first_name: `U${userId}`, language_code: "fr" },
      user_chat_id: userId,
      date: Math.floor(Date.now() / 1000) - 5,
      ...(link
        ? {
            invite_link: {
              invite_link: link,
              creator: { id: 1, is_bot: true, first_name: "b" },
              creates_join_request: true,
              is_primary: false,
              is_revoked: false,
            },
          }
        : {}),
    },
  } as Update;
}
function start(userId: number, code: string): Update {
  return {
    update_id: userId * 100 + Math.floor(Math.random() * 99),
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: userId, type: "private", first_name: `U${userId}` },
      from: { id: userId, is_bot: false, first_name: `U${userId}`, language_code: "fr" },
      text: `/start g${code}`,
      entities: [{ type: "bot_command", offset: 0, length: 6 }],
    },
  } as Update;
}

/** Horloge simulée : avance de `ms` en reculant toutes les dates enregistrées des demandes et des messages. */
async function travel(ms: number) {
  await prisma.$executeRaw`UPDATE "Membership" SET "requestedAt" = "requestedAt" - (${ms} * interval '1 millisecond'), "approveAt" = "approveAt" - (${ms} * interval '1 millisecond'), "gateSatisfiedAt" = "gateSatisfiedAt" - (${ms} * interval '1 millisecond')`;
  await prisma.$executeRaw`UPDATE "OutboundMessage" SET "queuedAt" = "queuedAt" - (${ms} * interval '1 millisecond')`;
}

describe("scénario du client (phase 11) : Tir Cadré ↔ Zone Interdite, de la demande à l'acceptation par le worker", () => {
  const admins = new Map<number, number>([
    [Number(ZONE), 333],
    [Number(ROULETTE), 111],
    [Number(TIR), 222],
  ]);
  const inside = new Set<string>();
  const ids = { zone: "", roulette: "", tir: "", zoneFromTir: "" };
  const botIds = { dating: "", casino: "", sports: "" };
  const tg: Record<"dating" | "casino" | "sports", Bot> = {} as never;
  const calls: Record<string, TelegramCall[]> = {};
  /** Appels du worker (acceptations), tous bots confondus. */
  const workerCalls: TelegramCall[][] = [];
  const approvals = () => workerCalls.flat().filter((c) => c.method === "approveChatJoinRequest");

  async function makeBot(n: number, vertical: "CASINO" | "SPORTS" | "DATING") {
    return prisma.bot.create({
      data: {
        name: `Bot ${n}`,
        username: `bot_${n}`,
        telegramBotId: BigInt(n),
        tokenEncrypted: encrypt(`${n}:TEST-TOKEN-${"x".repeat(30)}`),
        vertical,
        webhookSecret: `secret-${n}`,
      },
    });
  }
  async function makeChannel(chatId: bigint, title: string, botId: string) {
    const c = await prisma.channel.create({
      data: {
        telegramChatId: chatId,
        title,
        type: "CHANNEL",
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
  const memberOf = async (tgId: number) =>
    prisma.member.findUniqueOrThrow({ where: { telegramUserId: BigInt(tgId) } });
  const latest = async (tgId: number, channelId: string) =>
    prisma.membership.findFirstOrThrow({
      where: { member: { telegramUserId: BigInt(tgId) }, channelId },
      orderBy: { requestedAt: "desc" },
    });
  const tick = () => processApprovals(fakeJob({ type: "tick" as const }));
  const reminders = () => processApprovals(fakeJob({ type: "reminders" as const }));

  beforeAll(async () => {
    await resetDb();
    await prisma.setting.deleteMany({ where: { key: GATE_EXCEPTIONS_KEY } });
    const dating = await makeBot(333, "DATING");
    const casino = await makeBot(111, "CASINO");
    const sports = await makeBot(222, "SPORTS");
    Object.assign(botIds, { dating: dating.id, casino: casino.id, sports: sports.id });
    ids.zone = await makeChannel(ZONE, "Zone Interdite 🔞", dating.id);
    ids.roulette = await makeChannel(ROULETTE, "LA ZONE ROULETTE 🎰", casino.id);
    ids.tir = await makeChannel(TIR, "🎯 TIR CADRÉ ⚡", sports.id);
    await prisma.approvalRule.create({
      data: {
        channelId: ids.tir,
        name: "Règle par défaut",
        isDefault: true,
        scope: "DEFAULT",
        mode: "IMMEDIATE",
        delaySeconds: 0,
        gateMode: "REQUIRED",
        gateChannelIds: [ids.zone],
        reminderAfterMinutes: [],
        maxReminders: 0,
      },
    });
    // Zone : rappels « tout de suite » puis après 1 minute, pour vérifier qu'une personne qui attend son délai n'est jamais relancée.
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
        reminderAfterMinutes: [0, 1],
        maxReminders: 2,
      },
    });
    // Reprise D7 avant l'exception de l'équipe (ordre réel : déploiement, puis réglage par le client).
    const d7 = await createGateExceptions(prisma as unknown as PrismaClient);
    expect(d7.created.map((c) => c.channelId).sort()).toEqual([ids.tir, ids.zone].sort());
    expect(d7.withoutDefault.map((c) => c.channelId)).toEqual([ids.roulette]);
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
        gateMode: "NONE",
        gateChannelIds: [],
        reminderAfterMinutes: [],
        maxReminders: 0,
      },
    });
    ids.zoneFromTir = ex.id;
    await prisma.inviteLink.create({
      data: {
        channelId: ids.tir,
        botId: sports.id,
        telegramInviteLink: AD_TIR,
        name: "Pub TikTok Tir",
        kind: "AD_ENTRY",
        adPlatform: "TIKTOK",
      },
    });
    // Ancien lien du bouton « canal à rejoindre » (entrée directe, avant la phase 11) : plus jamais proposé.
    await prisma.inviteLink.create({
      data: {
        channelId: ids.tir,
        botId: sports.id,
        telegramInviteLink: OLD_GATE,
        name: `gate:${ids.zone}`,
        kind: "GATE",
        createsJoinRequest: false,
        sourceChannelId: ids.zone,
      },
    });

    for (const [key, rec, n] of [
      ["dating", dating, 333],
      ["casino", casino, 111],
      ["sports", sports, 222],
    ] as const) {
      tg[key] = getOrCreateBot(rec, prismaTelegramDeps);
      calls[key] = installWorld(tg[key].api, n, admins, inside);
      workerCalls.push(installWorld(apiForBot(rec), n, admins, inside));
    }
  });

  it("venu d'une pub sur Tir Cadré : bouton Zone Interdite → demande sur Zone (1 jour, court message) → « ✅ J'ai rejoint » accepté grâce à la demande en attente", async () => {
    await tg.sports.handleUpdate(join(TIR, "🎯 TIR CADRÉ ⚡", 7001, AD_TIR));
    const member = await memberOf(7001);
    let tir = await latest(7001, ids.tir);
    expect(tir.status).toBe("PENDING_GATE");
    expect(tir.source).toMatchObject({
      provenance: {
        type: "AD",
        adPlatform: "TIKTOK",
        label: "Venu d'une pub TikTok (« Pub TikTok Tir »)",
      },
      appliedRule: { scope: "DEFAULT", label: null },
    });

    // Lien vers Zone créé par le bot de Zone, avec demande d'adhésion, mémorisé comme tel.
    const welcome = await prisma.outboundMessage.findFirstOrThrow({
      where: { memberId: member.id, kind: "WELCOME", botId: botIds.sports },
    });
    const buttons = welcome.buttons as Buttons;
    expect(buttons.map((r) => r[0]!.text)).toEqual([
      "Rejoindre Zone Interdite 🔞",
      "✅ J'ai rejoint",
    ]);
    const gateLink = await prisma.inviteLink.findFirstOrThrow({
      where: { kind: "GATE", sourceChannelId: ids.tir, channelId: ids.zone },
    });
    expect(gateLink).toMatchObject({
      botId: botIds.dating,
      createsJoinRequest: true,
      telegramInviteLink: buttons[0]![0]!.url,
    });
    expect(
      calls.dating!.find((c) => c.method === "createChatInviteLink")?.payload.creates_join_request,
    ).toBe(true);

    // Demande sur Zone par ce lien : exception « venu de Tir Cadré » (plus précise que l'exception de la reprise).
    await tg.dating.handleUpdate(
      join(ZONE, "Zone Interdite 🔞", 7001, gateLink.telegramInviteLink),
    );
    let zone = await latest(7001, ids.zone);
    expect(zone).toMatchObject({
      status: "SCHEDULED",
      approvalRuleId: ids.zoneFromTir,
      inviteLinkId: gateLink.id,
    });
    expect(zone.approveAt!.getTime() - zone.requestedAt.getTime()).toBe(86_400_000);
    expect(zone.source).toMatchObject({
      provenance: {
        type: "GATE",
        sourceChannelId: ids.tir,
        inviteLinkId: gateLink.id,
        label: "Venu de « 🎯 TIR CADRÉ ⚡ » (canal obligatoire)",
      },
      appliedRule: { id: ids.zoneFromTir, scope: "SOURCE_CHANNEL", label: "Venu de « Tir Cadré »" },
    });
    const requested = await prisma.event.findFirstOrThrow({
      where: { type: "membership.requested", channelId: ids.zone, memberId: member.id },
    });
    expect(requested.payload).toMatchObject({
      membershipId: zone.id,
      provenance: { type: "GATE", sourceChannelId: ids.tir },
      appliedRule: { id: ids.zoneFromTir },
    });
    const short = await prisma.outboundMessage.findMany({
      where: { memberId: member.id, botId: botIds.dating },
    });
    expect(short.map((s) => [s.kind, s.text, s.buttons])).toEqual([
      [
        "WELCOME",
        "Ta demande pour <b>Zone Interdite 🔞</b> est bien reçue, accès dans 1 jour.",
        [],
      ],
    ]);
    expect(
      (await prisma.inviteLink.findUniqueOrThrow({ where: { id: gateLink.id } })).requests,
    ).toBe(1);

    // « ✅ J'ai rejoint » sur Tir Cadré : Telegram dirait « left », la demande en attente sur Zone suffit.
    const before = calls.sports!.length;
    await tg.sports.handleUpdate(start(7001, tir.code));
    expect(calls.sports!.slice(before).filter((c) => c.method === "getChatMember")).toEqual([]);
    tir = await latest(7001, ids.tir);
    expect(tir.status).toBe("SCHEDULED");
    expect(tir.approveAt!.getTime()).toBe(tir.gateSatisfiedAt!.getTime());
    const reply = calls.sports!.filter((c) => c.method === "sendMessage").at(-1)!;
    expect(String(reply.payload.text)).toBe(
      "C'est bon U7001, tu seras accepté dans <b>🎯 TIR CADRÉ ⚡</b> immédiatement.",
    );

    // Worker : Tir Cadré accepté tout de suite, Zone attend 1 jour.
    expect(await tick()).toEqual({ claimed: 1, approved: 1 });
    expect((await latest(7001, ids.tir)).status).toBe("APPROVED");
    expect(approvals().map((c) => c.payload)).toEqual([{ chat_id: Number(TIR), user_id: 7001 }]);
    expect(await reminders()).toEqual({ sent: 0 });
    await travel(23 * 3_600_000);
    expect(await tick()).toEqual({ claimed: 0, approved: 0 });
    await travel(3_600_000 + 1_000);
    expect(await tick()).toEqual({ claimed: 1, approved: 1 });
    zone = await latest(7001, ids.zone);
    expect(zone.status).toBe("APPROVED");
    expect(approvals().map((c) => c.payload)).toEqual([
      { chat_id: Number(ZONE), user_id: 7001 },
      { chat_id: Number(TIR), user_id: 7001 },
    ]);

    // Un seul accueil complet en tout (aucune boucle), un court message. « Accepté » : seulement par le bot que la
    // personne a démarré (« ✅ J'ai rejoint » sur Tir Cadré) ; pour Zone, sa demande date d'un jour et elle n'a jamais
    // démarré le bot de Zone : Telegram refuserait, rien n'est envoyé (phase 14).
    const all = await prisma.outboundMessage.findMany({
      where: { memberId: member.id },
      orderBy: { queuedAt: "asc" },
    });
    expect(
      all.filter((d) => d.kind === "WELCOME" && (d.buttons as Buttons).length > 0),
    ).toHaveLength(1);
    expect(all.filter((d) => d.kind === "ACCEPTED").map((d) => d.botId)).toEqual([botIds.sports]);
    const skipped = await prisma.event.findMany({
      where: { memberId: member.id, type: "dm.skipped_unreachable", botId: botIds.dating },
    });
    expect(skipped.map((e) => e.payload)).toEqual([
      { membershipId: zone.id, kind: "ACCEPTED", reason: "never_started" },
    ]);
  });

  it("venu d'un autre lien sur Zone : accueil avec Roulette et Tir Cadré → demandes dans ces canaux (sans règle / reprise) → « ✅ J'ai rejoint » → acceptée 5 minutes après le clic, jamais relancée pendant l'attente", async () => {
    await tg.dating.handleUpdate(
      join(ZONE, "Zone Interdite 🔞", 7002, "https://t.me/+LienQueLaPlateformeNaPasCree"),
    );
    const member = await memberOf(7002);
    await prisma.memberBotState.create({
      data: { memberId: member.id, botId: botIds.dating, canDm: true, startedAt: new Date() },
    });
    let zone = await latest(7002, ids.zone);
    expect(zone).toMatchObject({ status: "PENDING_GATE", inviteLinkId: null });
    expect(zone.source).toMatchObject({
      provenance: { type: "UNKNOWN", label: "Venu d'un autre lien" },
      appliedRule: { scope: "DEFAULT" },
    });
    const welcome = await prisma.outboundMessage.findFirstOrThrow({
      where: { memberId: member.id, kind: "WELCOME" },
    });
    const buttons = welcome.buttons as Buttons;
    expect(buttons.map((r) => r[0]!.text)).toEqual([
      "Rejoindre LA ZONE ROULETTE 🎰",
      "Rejoindre 🎯 TIR CADRÉ ⚡",
      "✅ J'ai rejoint",
    ]);
    // Jamais l'ancien lien à entrée directe : un nouveau lien avec demande d'adhésion.
    expect(buttons[1]![0]!.url).not.toBe(OLD_GATE);
    const toTir = await prisma.inviteLink.findFirstOrThrow({
      where: { telegramInviteLink: buttons[1]![0]!.url },
    });
    expect(toTir).toMatchObject({
      kind: "GATE",
      sourceChannelId: ids.zone,
      channelId: ids.tir,
      createsJoinRequest: true,
      botId: botIds.sports,
    });

    // Rappel avant le clic : liens avec demande d'adhésion (jamais l'ancien lien).
    expect(await reminders()).toEqual({ sent: 1 });
    const reminder = await prisma.outboundMessage.findFirstOrThrow({
      where: { memberId: member.id, kind: "GATE_REMINDER" },
    });
    expect((reminder.buttons as Buttons).map((r) => r[0]!.url)).toEqual(
      buttons.map((r) => r[0]!.url),
    );

    // Roulette (aucune règle) : entrée tout de suite, sans aucun message.
    await tg.casino.handleUpdate(join(ROULETTE, "LA ZONE ROULETTE 🎰", 7002, buttons[0]![0]!.url));
    const roulette = await latest(7002, ids.roulette);
    expect(roulette).toMatchObject({ status: "SCHEDULED", approvalRuleId: null });
    expect(roulette.source).toMatchObject({
      noRule: "IMMEDIATE",
      appliedRule: null,
      provenance: { type: "GATE", sourceChannelId: ids.zone },
    });
    // Tir Cadré : exception de la reprise (venu du bouton → tout de suite, sans message).
    await tg.sports.handleUpdate(join(TIR, "🎯 TIR CADRÉ ⚡", 7002, buttons[1]![0]!.url));
    // Phase 14 : les deux canaux obligatoires sont « rejoints » (demandes à nous) : Zone passe en acceptation programmée
    // sans attendre « ✅ J'ai rejoint ».
    const autoZone = await latest(7002, ids.zone);
    expect(autoZone.status).toBe("SCHEDULED");
    expect(
      (
        await prisma.event.findFirstOrThrow({
          where: { memberId: member.id, type: "membership.gate_satisfied", channelId: ids.zone },
        })
      ).payload,
    ).toMatchObject({ membershipId: zone.id, auto: true, trigger: "join_request" });
    const tir = await latest(7002, ids.tir);
    expect(tir).toMatchObject({ status: "SCHEDULED" });
    expect(tir.source).toMatchObject({
      appliedRule: {
        scope: "SOURCE_KIND",
        label: "Venu du bouton « canal à rejoindre » d'un de nos canaux",
      },
    });
    expect(
      await prisma.outboundMessage.count({
        where: { memberId: member.id, botId: { in: [botIds.casino, botIds.sports] } },
      }),
    ).toBe(0);

    // Worker : Roulette et Tir Cadré acceptés sans message « accepté » (comme les anciens liens à entrée directe).
    expect(await tick()).toEqual({ claimed: 2, approved: 2 });
    expect((await latest(7002, ids.roulette)).status).toBe("APPROVED");
    expect((await latest(7002, ids.tir)).status).toBe("APPROVED");
    expect(
      await prisma.outboundMessage.count({ where: { memberId: member.id, kind: "ACCEPTED" } }),
    ).toBe(0);
    const approvedEvents = await prisma.event.count({
      where: { memberId: member.id, type: "membership.approved" },
    });
    expect(approvedEvents).toBe(2);

    // « ✅ J'ai rejoint » sur Zone : les deux demandes (acceptées) comptent, sans appel à getChatMember.
    const before = calls.dating!.length;
    await tg.dating.handleUpdate(start(7002, zone.code));
    expect(calls.dating!.slice(before).filter((c) => c.method === "getChatMember")).toEqual([]);
    zone = await latest(7002, ids.zone);
    expect(zone.status).toBe("SCHEDULED");
    expect(zone.approveAt!.getTime() - zone.gateSatisfiedAt!.getTime()).toBe(300_000);
    const reply = calls.dating!.filter((c) => c.method === "sendMessage").at(-1)!;
    expect(String(reply.payload.text)).toBe(
      "C'est bon U7002, tu seras accepté dans <b>Zone Interdite 🔞</b> dans 5 minutes.",
    );

    // Pendant l'attente : jamais relancée (rappel suivant dû, mais la personne a déjà cliqué), pas encore acceptée.
    await travel(2 * 60_000);
    expect(await reminders()).toEqual({ sent: 0 });
    expect(await tick()).toEqual({ claimed: 0, approved: 0 });
    await travel(3 * 60_000 + 1_000);
    expect(await tick()).toEqual({ claimed: 1, approved: 1 });
    expect((await latest(7002, ids.zone)).status).toBe("APPROVED");

    // Un seul accueil complet, aucun double accueil ; un seul rappel, puis le message « Canaux rejoints » (phase 14 :
    // la personne a démarré le bot, il peut lui écrire).
    const welcomes = await prisma.outboundMessage.findMany({
      where: { memberId: member.id, kind: "WELCOME" },
    });
    expect(welcomes).toHaveLength(1);
    const gateMessages = await prisma.outboundMessage.findMany({
      where: { memberId: member.id, kind: "GATE_REMINDER" },
      orderBy: { queuedAt: "asc" },
    });
    expect(gateMessages.map((d) => d.text.startsWith("C'est bon"))).toEqual([false, true]);
    expect(gateMessages[1]!.text).toBe(
      "C'est bon U7002, tu seras accepté dans <b>Zone Interdite 🔞</b> dans 5 minutes.",
    );
  });

  it("la reprise D7 ne se refait jamais : relancée, elle ne crée ni ne modifie aucune règle", async () => {
    const before = await prisma.approvalRule.findMany({ orderBy: { id: "asc" } });
    const again = await createGateExceptions(prisma as unknown as PrismaClient);
    expect(again.alreadyDone).toBe(true);
    expect(await prisma.approvalRule.findMany({ orderBy: { id: "asc" } })).toEqual(before);
  });
});

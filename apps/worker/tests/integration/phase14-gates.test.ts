/**
 * Phase 14 sur base réelle (demandes bloquées sur « Attend les canaux ») : validation automatique par les mises à jour
 * Telegram simulées, filet du worker et rattrapage unique (`pnpm db:phase14`), rappel à 4 minutes à l'heure, rappels
 * tardifs et « Accepté » seulement aux personnes joignables, erreurs « can't initiate » / « blocked by the user »,
 * acceptation par la file telegram-send, alerte « bot bloqué après l'accueil ».
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import { createBot, GATE_BACKFILL_KEY, prismaTelegramDeps } from "@linkaffipro/telegram";
import type { Api, Bot } from "grammy";
import type { Update } from "grammy/types";
import { phase14GateBackfill } from "../../../../packages/db/prisma/phase14-gates";
import { resetGateSweepMemory } from "../../src/approvals/gate-sweep";
import { approveMembership, apiForBot } from "../../src/approvals/telegram-actions";
import { syncBotBlockedRateAlerts } from "../../src/maintenance/blocked-rate";
import { processApprovals } from "../../src/processors/approvals";
import { processTelegramSend } from "../../src/processors/telegram-send";
import { apiForBot as sendingApiForBot } from "../../src/sending/api";
import { sendDm } from "../../src/sending/send-dm";
import { capturedJobs, fakeJob, resetDb, type TelegramCall } from "./helpers";
import { encrypt } from "@linkaffipro/core";

const ZONE = -1001500000001n;
const ROULETTE = -1001500000002n;
const TIR = -1001500000003n;
const BOT_ID = 151n;

type Buttons = Array<Array<{ text: string; url?: string; callbackData?: string }>>;

/** Telegram simulé : membres de chaque canal, erreurs forcées des envois privés. */
function installWorld(
  api: Api,
  members: Map<number, Set<number>>,
  dmFailures: Map<number, { error_code: number; description: string }> = new Map(),
): TelegramCall[] {
  const calls: TelegramCall[] = [];
  let nextId = 9000;
  api.config.use(async (_prev, method, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    calls.push({ method, payload: p });
    if (method === "getChatMember") {
      const user = Number(p.user_id);
      return {
        ok: true,
        result: {
          status: members.get(Number(p.chat_id))?.has(user) ? "member" : "left",
          user: { id: user, is_bot: false, first_name: "x" },
        },
      } as never;
    }
    if (method === "createChatInviteLink")
      return {
        ok: true,
        result: {
          invite_link: `https://t.me/+p14${String(p.chat_id).slice(-3)}`,
          creator: { id: Number(BOT_ID), is_bot: true, first_name: "b" },
          creates_join_request: true,
          is_primary: false,
          is_revoked: false,
        },
      } as never;
    if (/^send(Message|Photo)$/.test(method)) {
      const fail = dmFailures.get(Number(p.chat_id));
      if (fail) return { ok: false, ...fail } as never;
      return {
        ok: true,
        result: {
          message_id: nextId++,
          date: Math.floor(Date.now() / 1000),
          chat: { id: Number(p.chat_id), type: "private" },
          text: String(p.text ?? ""),
        },
      } as never;
    }
    return { ok: true, result: true } as never;
  });
  return calls;
}

/** Titres des canaux (une mise à jour Telegram renomme le canal chez nous si son titre change). */
const TITLES: Record<string, string> = {
  [String(ZONE)]: "Zone Interdite 🔞",
  [String(ROULETTE)]: "LA ZONE ROULETTE 🎰",
  [String(TIR)]: "🎯 TIR CADRÉ ⚡",
};

function join(chatId: bigint, userId: number, date = Math.floor(Date.now() / 1000)): Update {
  return {
    update_id: userId + Number(chatId % 1000n),
    chat_join_request: {
      chat: { id: Number(chatId), type: "channel", title: TITLES[String(chatId)] },
      from: { id: userId, is_bot: false, first_name: `U${userId}`, language_code: "fr" },
      user_chat_id: userId,
      date,
    },
  } as Update;
}

function pressed(userId: number, data: string): Update {
  const chat = { id: userId, type: "private" as const, first_name: `U${userId}` };
  return {
    update_id: userId * 7,
    callback_query: {
      id: `cb${userId}`,
      from: { id: userId, is_bot: false, first_name: `U${userId}`, language_code: "fr" },
      chat_instance: "ci",
      data,
      message: { message_id: 3, date: Math.floor(Date.now() / 1000), chat, text: "Accueil" },
    },
  } as Update;
}

describe("phase 14 : demandes en attente des canaux (base réelle)", () => {
  const ids = { bot: "", zone: "", roulette: "", tir: "", rule: "" };
  const members = new Map<number, Set<number>>([
    [Number(ZONE), new Set()],
    [Number(ROULETTE), new Set()],
    [Number(TIR), new Set()],
  ]);
  const dmFailures = new Map<number, { error_code: number; description: string }>();
  let bot: Bot;
  let botCalls: TelegramCall[] = [];
  let workerCalls: TelegramCall[] = [];
  let sendCalls: TelegramCall[] = [];

  const memberOf = (tg: number) =>
    prisma.member.findUniqueOrThrow({ where: { telegramUserId: BigInt(tg) } });
  const zoneOf = async (tg: number) =>
    prisma.membership.findFirstOrThrow({
      where: { member: { telegramUserId: BigInt(tg) }, channelId: ids.zone },
      orderBy: { requestedAt: "desc" },
    });
  async function pendingZone(tg: number, ageMs: number, over: Record<string, unknown> = {}) {
    const member = await prisma.member.upsert({
      where: { telegramUserId: BigInt(tg) },
      create: { telegramUserId: BigInt(tg), firstName: `U${tg}` },
      update: {},
    });
    return prisma.membership.create({
      data: {
        code: `p14${tg}${Math.floor(Math.random() * 1e4)}`.slice(0, 12),
        memberId: member.id,
        channelId: ids.zone,
        status: "PENDING_GATE",
        approvalRuleId: ids.rule,
        userChatId: BigInt(tg),
        requestedAt: new Date(Date.now() - ageMs),
        source: { botId: ids.bot, appliedRule: { id: ids.rule, scope: "DEFAULT", label: null } },
        ...over,
      },
    });
  }

  beforeAll(async () => {
    await resetDb();
    await prisma.setting.deleteMany({ where: { key: GATE_BACKFILL_KEY } });
    await prisma.alert.deleteMany({ where: { kind: "bot_blocked_rate" } });
    const b = await prisma.bot.create({
      data: {
        name: "Bot rencontres",
        username: "womendatingoobot",
        telegramBotId: BOT_ID,
        tokenEncrypted: encrypt(`${BOT_ID}:TEST-TOKEN-${"x".repeat(30)}`),
        vertical: "DATING",
        webhookSecret: "s-p14",
      },
    });
    ids.bot = b.id;
    const channel = async (chatId: bigint, title: string) => {
      const c = await prisma.channel.create({
        data: {
          telegramChatId: chatId,
          title,
          type: "CHANNEL",
          language: "fr",
          primaryBotId: b.id,
        },
      });
      await prisma.channelBotAdmin.create({
        data: {
          channelId: c.id,
          botId: b.id,
          rights: { status: "administrator", can_invite_users: true },
        },
      });
      return c.id;
    };
    ids.zone = await channel(ZONE, "Zone Interdite 🔞");
    ids.roulette = await channel(ROULETTE, "LA ZONE ROULETTE 🎰");
    ids.tir = await channel(TIR, "🎯 TIR CADRÉ ⚡");
    ids.rule = (
      await prisma.approvalRule.create({
        data: {
          channelId: ids.zone,
          name: "Règle par défaut",
          isDefault: true,
          mode: "DELAY",
          delaySeconds: 300,
          gateMode: "REQUIRED",
          gateChannelIds: [ids.roulette, ids.tir],
          reminderAfterMinutes: [4, 60],
          maxReminders: 2,
        },
      })
    ).id;
    for (const c of [ids.roulette, ids.tir])
      await prisma.approvalRule.create({
        data: {
          channelId: c,
          name: "Immédiat",
          isDefault: true,
          mode: "IMMEDIATE",
          gateMode: "NONE",
          gateChannelIds: [],
          reminderAfterMinutes: [],
          maxReminders: 0,
        },
      });
    bot = createBot(b, prismaTelegramDeps);
    botCalls = installWorld(bot.api, members);
    workerCalls = installWorld(apiForBot(b), members);
    sendCalls = installWorld((await sendingApiForBot(b.id)).api, members, dmFailures);
    resetGateSweepMemory();
  });

  afterAll(async () => {
    await prisma.setting.deleteMany({ where: { key: GATE_BACKFILL_KEY } });
    await prisma.alert.deleteMany({ where: { kind: "bot_blocked_rate" } });
  });

  it("demande dans le 2e canal obligatoire → acceptation programmée, sans « ✅ J'ai rejoint »", async () => {
    await bot.handleUpdate(join(ZONE, 1401));
    let zone = await zoneOf(1401);
    expect(zone.status).toBe("PENDING_GATE");
    const welcome = await prisma.outboundMessage.findFirstOrThrow({
      where: { memberId: zone.memberId, kind: "WELCOME" },
    });
    expect((welcome.buttons as Buttons).at(-1)).toEqual([
      { text: "✅ J'ai rejoint", callbackData: `g:${zone.code}` },
    ]);
    // Rappel à 4 minutes : tâche différée propre à la demande (file approvals).
    const reminderJob = capturedJobs("approvals").find(
      (j) => j.data.type === "reminder" && j.data.membershipId === zone.id,
    );
    expect(reminderJob?.opts.jobId).toBe(`reminder:${zone.id}:0`);
    expect(Number(reminderJob?.opts.delay)).toBeGreaterThan(3 * 60_000);
    expect(Number(reminderJob?.opts.delay)).toBeLessThanOrEqual(4 * 60_000);

    await bot.handleUpdate(join(ROULETTE, 1401));
    expect((await zoneOf(1401)).status).toBe("PENDING_GATE");
    await bot.handleUpdate(join(TIR, 1401));
    zone = await zoneOf(1401);
    expect(zone.status).toBe("SCHEDULED");
    expect(zone.approveAt!.getTime() - zone.gateSatisfiedAt!.getTime()).toBe(300_000);
    const ev = await prisma.event.findFirstOrThrow({
      where: { type: "membership.gate_satisfied", memberId: zone.memberId },
    });
    expect(ev.payload).toMatchObject({
      membershipId: zone.id,
      auto: true,
      trigger: "join_request",
    });
    const done = await prisma.outboundMessage.findFirstOrThrow({
      where: { memberId: zone.memberId, kind: "GATE_REMINDER" },
    });
    expect(done.text).toBe(
      "C'est bon U1401, tu seras accepté dans <b>Zone Interdite 🔞</b> dans 5 minutes.",
    );
    // Le rappel à 4 minutes ne part plus : la demande n'attend plus les canaux.
    expect(
      await processApprovals(fakeJob({ type: "reminder" as const, membershipId: zone.id })),
    ).toEqual({
      sent: false,
    });
  });

  it("entrée directe dans un canal obligatoire, puis bouton à rappel : acceptation programmée, message modifié", async () => {
    await bot.handleUpdate(join(ZONE, 1402, Math.floor(Date.now() / 1000) - 3600));
    members.get(Number(ROULETTE))!.add(1402);
    const user = { id: 1402, is_bot: false, first_name: "U1402" };
    // Entrée dans Tir (sans demande) : Roulette vérifiée par Telegram, Tir connu par la mise à jour.
    await bot.handleUpdate({
      update_id: 14020,
      chat_member: {
        chat: { id: Number(TIR), type: "channel", title: TITLES[String(TIR)] },
        from: user,
        date: Math.floor(Date.now() / 1000),
        old_chat_member: { status: "left", user },
        new_chat_member: { status: "member", user },
      },
    } as Update);
    const zone = await zoneOf(1402);
    expect(zone.status).toBe("SCHEDULED");
    // Demande d'une heure, bot jamais démarré : pas de « Canaux rejoints » (Telegram refuserait).
    expect(
      await prisma.outboundMessage.count({
        where: { memberId: zone.memberId, kind: "GATE_REMINDER" },
      }),
    ).toBe(0);
    expect(
      (
        await prisma.event.findFirstOrThrow({
          where: { type: "dm.skipped_unreachable", memberId: zone.memberId },
        })
      ).payload,
    ).toEqual({ membershipId: zone.id, kind: "GATE_SATISFIED", reason: "never_started" });

    // Bouton « ✅ J'ai rejoint » pressé ensuite (demande déjà programmée) : la réponse s'affiche dans une fenêtre, les
    // boutons devenus inutiles disparaissent du message, la personne devient joignable.
    const before = botCalls.length;
    await bot.handleUpdate(pressed(1402, `g:${zone.code}`));
    const after = botCalls.slice(before);
    expect(after.find((c) => c.method === "answerCallbackQuery")?.payload).toMatchObject({
      text: expect.stringMatching(/^C'est bon U1402/),
      show_alert: true,
    });
    expect(after.filter((c) => c.method === "editMessageText")).toEqual([]);
    expect(after.find((c) => c.method === "editMessageReplyMarkup")?.payload).toMatchObject({
      chat_id: 1402,
      message_id: 3,
      reply_markup: { inline_keyboard: [] },
    });
    const state = await prisma.memberBotState.findUniqueOrThrow({
      where: { memberId_botId: { memberId: zone.memberId, botId: ids.bot } },
    });
    expect(state).toMatchObject({ canDm: true, blockedAt: null });
    expect(state.startedAt).toBeInstanceOf(Date);
  });

  it("rattrapage unique : le premier passage du filet vérifie toutes les demandes en attente (même anciennes), une seule fois", async () => {
    // Ancienne demande (10 jours) : les deux canaux rejoints sans « J'ai rejoint » (constat du 15 octobre).
    const old = await pendingZone(1403, 10 * 86_400_000);
    members.get(Number(ROULETTE))!.add(1403);
    members.get(Number(TIR))!.add(1403);
    // Demande récente : un seul canal rejoint.
    const half = await pendingZone(1404, 30 * 60_000);
    members.get(Number(ROULETTE))!.add(1404);

    const r = (await processApprovals(fakeJob({ type: "gate-sweep" as const }))) as {
      backfill: {
        satisfied: number;
        satisfiedIds: string[];
        stillPending: number;
        alreadyDone: boolean;
      };
    };
    expect(r.backfill).toMatchObject({ alreadyDone: false, satisfied: 1, stillPending: 1 });
    expect(r.backfill.satisfiedIds).toEqual([old.id]);
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: old.id } })).status).toBe(
      "SCHEDULED",
    );
    expect(
      (
        await prisma.event.findFirstOrThrow({
          where: { type: "membership.gate_satisfied", memberId: old.memberId },
        })
      ).payload,
    ).toMatchObject({ auto: true, trigger: "backfill" });
    const marker = await prisma.setting.findUniqueOrThrow({ where: { key: GATE_BACKFILL_KEY } });
    expect(marker.value).toMatchObject({ satisfied: 1, by: "worker", stillPending: 1 });

    // `pnpm db:phase14` ensuite : déjà fait, rien n'est touché, même résultat.
    const again = await phase14GateBackfill();
    expect(again).toMatchObject({ alreadyDone: true, satisfied: 1, by: "worker" });
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: half.id } })).status).toBe(
      "PENDING_GATE",
    );

    // Filet ordinaire ensuite : la demande récente passe dès que le 2e canal est rejoint.
    members.get(Number(TIR))!.add(1404);
    const sweep = (await processApprovals(fakeJob({ type: "gate-sweep" as const }))) as {
      satisfied: string[];
    };
    expect(sweep.satisfied).toEqual([half.id]);
    // Nouveau passage forcé du script : plus rien à valider (sans risque).
    const forced = await phase14GateBackfill({ force: true });
    expect(forced).toMatchObject({ alreadyDone: false, satisfied: 0, by: "script" });
  });

  it("filet : une demande de plus de 7 jours n'est plus revue toutes les 2 minutes", async () => {
    const tooOld = await pendingZone(1405, 8 * 86_400_000);
    members.get(Number(ROULETTE))!.add(1405);
    members.get(Number(TIR))!.add(1405);
    const sweep = (await processApprovals(fakeJob({ type: "gate-sweep" as const }))) as {
      satisfied: string[];
    };
    expect(sweep.satisfied).toEqual([]);
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: tooOld.id } })).status).toBe(
      "PENDING_GATE",
    );
    await prisma.membership.update({ where: { id: tooOld.id }, data: { status: "EXPIRED" } });
  });

  it("rappel à 4 minutes parti à l'heure (une seule fois), rappel d'1 heure seulement aux personnes joignables", async () => {
    const m = await pendingZone(1406, 4 * 60_000 + 1_000);
    expect(
      await processApprovals(fakeJob({ type: "reminder" as const, membershipId: m.id })),
    ).toEqual({
      sent: true,
    });
    const reminder = await prisma.outboundMessage.findFirstOrThrow({
      where: { memberId: m.memberId, kind: "GATE_REMINDER" },
    });
    expect(reminder.chatId).toBe(1406n);
    expect((reminder.buttons as Buttons).at(-1)).toEqual([
      { text: "✅ J'ai rejoint", callbackData: `g:${m.code}` },
    ]);
    // Le passage toutes les 5 minutes ne le renvoie pas.
    await processApprovals(fakeJob({ type: "reminders" as const }));
    expect(
      await prisma.outboundMessage.count({
        where: { memberId: m.memberId, kind: "GATE_REMINDER" },
      }),
    ).toBe(1);

    // 1 heure après, jamais démarré : rien n'est envoyé, le rappel est compté comme passé.
    await prisma.membership.update({
      where: { id: m.id },
      data: { requestedAt: new Date(Date.now() - 61 * 60_000) },
    });
    await processApprovals(fakeJob({ type: "reminders" as const }));
    expect(
      await prisma.outboundMessage.count({
        where: { memberId: m.memberId, kind: "GATE_REMINDER" },
      }),
    ).toBe(1);
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: m.id } })).remindersSent).toBe(
      2,
    );
    expect(
      (
        await prisma.event.findFirstOrThrow({
          where: { type: "dm.skipped_unreachable", memberId: m.memberId },
        })
      ).payload,
    ).toMatchObject({
      membershipId: m.id,
      kind: "GATE_REMINDER",
      index: 1,
      reason: "never_started",
    });

    // Même rappel pour une personne qui a démarré le bot : il part.
    const started = await pendingZone(1407, 61 * 60_000, { remindersSent: 1 });
    await prisma.memberBotState.create({
      data: { memberId: started.memberId, botId: ids.bot, canDm: true, startedAt: new Date() },
    });
    await processApprovals(fakeJob({ type: "reminders" as const }));
    expect(
      await prisma.outboundMessage.count({
        where: { memberId: started.memberId, kind: "GATE_REMINDER" },
      }),
    ).toBe(1);
    await prisma.membership.updateMany({
      where: { id: { in: [m.id, started.id] } },
      data: { status: "EXPIRED" },
    });
  });

  it("« Accepté » seulement si joignable : jamais à une personne qui n'a pas démarré le bot, fenêtre passée", async () => {
    const away = await pendingZone(1408, 10 * 60_000, {
      status: "SCHEDULED",
      approveAt: new Date(),
    });
    expect(await approveMembership(away.id)).toBe("approved");
    expect(
      await prisma.outboundMessage.count({ where: { memberId: away.memberId, kind: "ACCEPTED" } }),
    ).toBe(0);
    expect(
      (
        await prisma.event.findFirstOrThrow({
          where: { type: "dm.skipped_unreachable", memberId: away.memberId },
        })
      ).payload,
    ).toEqual({ membershipId: away.id, kind: "ACCEPTED", reason: "never_started" });

    const fresh = await pendingZone(1409, 60_000, { status: "SCHEDULED", approveAt: new Date() });
    expect(await approveMembership(fresh.id)).toBe("approved");
    expect(
      await prisma.outboundMessage.count({ where: { memberId: fresh.memberId, kind: "ACCEPTED" } }),
    ).toBe(1);
  });

  it("envoi refusé : « can't initiate » = injoignable (pas bloqué), « blocked by the user » = bloqué", async () => {
    const member = await memberOf(1401);
    const queue = (chatId: number) =>
      prisma.outboundMessage.create({
        data: {
          botId: ids.bot,
          memberId: member.id,
          kind: "ACCEPTED",
          text: "Bienvenue",
          chatId: BigInt(chatId),
        },
      });
    await prisma.memberBotState.upsert({
      where: { memberId_botId: { memberId: member.id, botId: ids.bot } },
      create: { memberId: member.id, botId: ids.bot, canDm: true },
      update: { canDm: true, blockedAt: null },
    });
    dmFailures.set(91401, {
      error_code: 403,
      description: "Forbidden: bot can't initiate conversation with a user",
    });
    const om = await queue(91401);
    await sendDm(om.id);
    expect(await prisma.outboundMessage.findUniqueOrThrow({ where: { id: om.id } })).toMatchObject({
      status: "FAILED",
      error:
        "Le bot ne peut plus écrire à cette personne : elle n'a jamais appuyé sur « Démarrer » et les 5 minutes après sa demande sont passées.",
    });
    let state = await prisma.memberBotState.findUniqueOrThrow({
      where: { memberId_botId: { memberId: member.id, botId: ids.bot } },
    });
    expect(state).toMatchObject({ canDm: false, blockedAt: null });
    const unreachable = await prisma.event.findFirstOrThrow({
      where: { type: "dm.unreachable", memberId: member.id },
    });
    expect(unreachable.payload).toMatchObject({
      outboundMessageId: om.id,
      telegramError: "403 Forbidden: bot can't initiate conversation with a user",
    });

    dmFailures.set(91402, {
      error_code: 403,
      description: "Forbidden: bot was blocked by the user",
    });
    const om2 = await queue(91402);
    await sendDm(om2.id);
    expect((await prisma.outboundMessage.findUniqueOrThrow({ where: { id: om2.id } })).status).toBe(
      "BLOCKED",
    );
    state = await prisma.memberBotState.findUniqueOrThrow({
      where: { memberId_botId: { memberId: member.id, botId: ids.bot } },
    });
    expect(state.blockedAt).toBeInstanceOf(Date);
    expect(sendCalls.filter((c) => c.method === "sendMessage")).toHaveLength(2);
  });

  it("« Tout accepter » : tâche approve de la file telegram-send, jamais sur une demande déjà traitée", async () => {
    const m = await pendingZone(1410, 30 * 60_000);
    const before = workerCalls.filter((c) => c.method === "approveChatJoinRequest").length;
    expect(
      await processTelegramSend(
        fakeJob({ type: "approve" as const, membershipId: m.id, byUserId: "u-admin" }),
      ),
    ).toEqual({ ok: true, outcome: "approved" });
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: m.id } })).status).toBe(
      "APPROVED",
    );
    const approved = await prisma.event.findFirstOrThrow({
      where: { type: "membership.approved", memberId: m.memberId },
    });
    expect(approved.payload).toMatchObject({ membershipId: m.id, byUserId: "u-admin" });
    expect(
      await processTelegramSend(fakeJob({ type: "approve" as const, membershipId: m.id })),
    ).toEqual({ ok: true, outcome: "not_open" });
    expect(workerCalls.filter((c) => c.method === "approveChatJoinRequest")).toHaveLength(
      before + 1,
    );
  });

  it("alerte « bot bloqué après l'accueil » : plus de 25 % sur au moins 10 demandes, une par canal toutes les 6 heures", async () => {
    const now = new Date();
    const link = await prisma.inviteLink.create({
      data: {
        channelId: ids.zone,
        botId: ids.bot,
        telegramInviteLink: "https://t.me/+PubUn",
        name: "Pub 1",
        kind: "AD_ENTRY",
        adPlatform: "TIKTOK",
      },
    });
    for (let i = 0; i < 12; i++) {
      const tg = 1500 + i;
      const member = await prisma.member.create({
        data: { telegramUserId: BigInt(tg), firstName: `P${i}` },
      });
      const requestedAt = new Date(now.getTime() - 2 * 3600_000 - i * 1000);
      await prisma.membership.create({
        data: {
          code: `p14al${i}`,
          memberId: member.id,
          channelId: ids.zone,
          status: "PENDING_GATE",
          requestedAt,
          inviteLinkId: link.id,
          source: {
            botId: ids.bot,
            inviteLink: { id: link.id, name: "Pub 1" },
            provenance: {
              type: "AD",
              inviteLinkId: link.id,
              sourceChannelId: null,
              adPlatform: "TIKTOK",
            },
          },
        },
      });
      await prisma.outboundMessage.create({
        data: {
          botId: ids.bot,
          memberId: member.id,
          kind: "WELCOME",
          text: "Accueil",
          status: "SENT",
          queuedAt: requestedAt,
          sentAt: new Date(requestedAt.getTime() + 2_000),
        },
      });
      // 4 vrais blocages dans les 2 minutes ; 3 refus « jamais démarré » (jamais comptés comme blocages).
      if (i < 4)
        await prisma.event.create({
          data: {
            type: "member.blocked",
            memberId: member.id,
            botId: ids.bot,
            occurredAt: new Date(requestedAt.getTime() + 90_000),
          },
        });
      else if (i < 7)
        await prisma.event.create({
          data: {
            type: "dm.unreachable",
            memberId: member.id,
            botId: ids.bot,
            occurredAt: new Date(requestedAt.getTime() + 60 * 60_000),
            payload: {
              telegramError: "403 Forbidden: bot can't initiate conversation with a user",
            },
          },
        });
    }
    const first = await syncBotBlockedRateAlerts(now);
    expect(first.created).toBe(1);
    const alert = await prisma.alert.findFirstOrThrow({ where: { kind: "bot_blocked_rate" } });
    expect(alert.message).toBe(
      "33 % des personnes venues de Pub 1 ont bloqué @womendatingoobot après l'accueil de « Zone Interdite 🔞 » (4 sur 12 en 24 h) : Telegram peut limiter un bot signalé. Adoucir le message ou passer les canaux en « Proposés ».",
    );
    expect(alert.payload).toMatchObject({ channelId: ids.zone, requests: 12, blocked: 4 });
    // Passage suivant (5 minutes après) : pas de deuxième alerte pour ce canal.
    expect((await syncBotBlockedRateAlerts(new Date(now.getTime() + 5 * 60_000))).created).toBe(0);
    // 7 heures après (toujours dans les 24 h) : nouvelle alerte, l'ancienne est close.
    expect((await syncBotBlockedRateAlerts(new Date(now.getTime() + 7 * 3600_000))).created).toBe(
      1,
    );
    const all = await prisma.alert.findMany({
      where: { kind: "bot_blocked_rate" },
      orderBy: { createdAt: "asc" },
    });
    expect(all).toHaveLength(2);
    expect(all[0]!.resolvedAt).toBeInstanceOf(Date);
    expect(all[1]!.resolvedAt).toBeNull();
    // Plus de 24 heures après : sous le seuil (plus de demandes dans la fenêtre), l'alerte ouverte est résolue.
    const later = await syncBotBlockedRateAlerts(new Date(now.getTime() + 30 * 3600_000));
    expect(later).toMatchObject({ created: 0, resolved: 1 });
  });
});

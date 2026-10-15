/**
 * Phase 14, corrections après relecture (base réelle) :
 * - « ✅ J'ai rejoint » pressé pendant la validation automatique ou pendant l'acceptation : écritures conditionnelles,
 *   un seul événement `membership.gate_satisfied`, un seul « C'est bon », une demande acceptée reste acceptée ;
 * - message « Canaux rejoints » repérable : son identifiant est dans l'événement `membership.gate_satisfied` ;
 * - filet du worker : 429 de Telegram, attente `retry_after` respectée d'un passage à l'autre ;
 * - rattrapage `pnpm db:phase14` : états « joignable / a bloqué le bot » hérités réparés (une personne qui a écrit au
 *   bot en privé reste joignable), accueils par défaut réécrits sans « ✅ J'ai rejoint » (jamais un texte de l'équipe),
 *   comptés dans la marque.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import {
  createBot,
  defaultSequenceText,
  GATE_BACKFILL_KEY,
  PHASE13_JOIN_REQUEST_TEXTS,
  PHASE14_TEXTS_ACTION,
  prismaTelegramDeps,
} from "@linkaffipro/telegram";
import type { Api, Bot } from "grammy";
import type { Update } from "grammy/types";
import { phase14GateBackfill } from "../../../../packages/db/prisma/phase14-gates";
import { gateSweepBotPauses, resetGateSweepMemory } from "../../src/approvals/gate-sweep";
import { apiForBot, approveMembership } from "../../src/approvals/telegram-actions";
import { processApprovals } from "../../src/processors/approvals";
import { fakeJob, resetDb, type TelegramCall } from "./helpers";

const ZONE = -1001700000001n;
const ROULETTE = -1001700000002n;
const TIR = -1001700000003n;
const BOT_ID = 171n;
const TITLES: Record<string, string> = {
  [String(ZONE)]: "Zone Interdite 🔞",
  [String(ROULETTE)]: "LA ZONE ROULETTE 🎰",
  [String(TIR)]: "🎯 TIR CADRÉ ⚡",
};

type World = {
  calls: TelegramCall[];
  /** Action jouée une fois pendant le prochain appel getChatMember (mise à jour traitée en même temps). */
  hook: (() => Promise<void>) | null;
  /** Erreur forcée de getChatMember (429…). */
  failGetChatMember: { error_code: number; description: string; parameters?: object } | null;
};

/** Telegram simulé : membres de chaque canal (« left » par défaut), crochet pendant getChatMember. */
function installWorld(api: Api, members: Map<number, Set<number>>): World {
  const w: World = { calls: [], hook: null, failGetChatMember: null };
  api.config.use(async (_prev, method, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    w.calls.push({ method, payload: p });
    if (method === "getChatMember") {
      if (w.hook) {
        const hook = w.hook;
        w.hook = null;
        await hook();
      }
      if (w.failGetChatMember) return { ok: false, ...w.failGetChatMember } as never;
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
          invite_link: `https://t.me/+fix14${String(p.chat_id).slice(-3)}`,
          creator: { id: Number(BOT_ID), is_bot: true, first_name: "b" },
          creates_join_request: true,
          is_primary: false,
          is_revoked: false,
        },
      } as never;
    if (/^(sendMessage|editMessageText)$/.test(method))
      return {
        ok: true,
        result: {
          message_id: 33,
          date: Math.floor(Date.now() / 1000),
          chat: { id: Number(p.chat_id), type: "private" },
          text: String(p.text ?? ""),
        },
      } as never;
    return { ok: true, result: true } as never;
  });
  return w;
}

function join(chatId: bigint, userId: number, date = Math.floor(Date.now() / 1000)): Update {
  return {
    update_id: userId + Number(-chatId % 1000n),
    chat_join_request: {
      chat: { id: Number(chatId), type: "channel", title: TITLES[String(chatId)] },
      from: { id: userId, is_bot: false, first_name: `U${userId}`, language_code: "fr" },
      user_chat_id: userId,
      date,
    },
  } as Update;
}

function entered(chatId: bigint, userId: number): Update {
  const user = { id: userId, is_bot: false, first_name: `U${userId}` };
  return {
    update_id: userId * 11,
    chat_member: {
      chat: { id: Number(chatId), type: "channel", title: TITLES[String(chatId)] },
      from: user,
      date: Math.floor(Date.now() / 1000),
      old_chat_member: { status: "left", user },
      new_chat_member: { status: "member", user },
    },
  } as Update;
}

function pressed(userId: number, data: string): Update {
  const chat = { id: userId, type: "private" as const, first_name: `U${userId}` };
  return {
    update_id: userId * 13,
    callback_query: {
      id: `cb${userId}`,
      from: { id: userId, is_bot: false, first_name: `U${userId}`, language_code: "fr" },
      chat_instance: "ci",
      data,
      message: { message_id: 3, date: Math.floor(Date.now() / 1000), chat, text: "Accueil" },
    },
  } as Update;
}

describe("phase 14, corrections (base réelle)", () => {
  const ids = { bot: "", zone: "", roulette: "", tir: "", rule: "" };
  const members = new Map<number, Set<number>>([
    [Number(ZONE), new Set()],
    [Number(ROULETTE), new Set()],
    [Number(TIR), new Set()],
  ]);
  let bot: Bot;
  let botWorld: World;
  let workerWorld: World;

  const zoneOf = (tg: number) =>
    prisma.membership.findFirstOrThrow({
      where: { member: { telegramUserId: BigInt(tg) }, channelId: ids.zone },
      orderBy: { requestedAt: "desc" },
    });
  const gateEvents = (memberId: string) =>
    prisma.event.findMany({
      where: { type: "membership.gate_satisfied", memberId },
      orderBy: { occurredAt: "asc" },
    });

  beforeAll(async () => {
    await resetDb();
    await prisma.setting.deleteMany({ where: { key: GATE_BACKFILL_KEY } });
    await prisma.auditLog.deleteMany({ where: { action: PHASE14_TEXTS_ACTION } });
    const b = await prisma.bot.create({
      data: {
        name: "Bot rencontres",
        username: "fix14bot",
        telegramBotId: BOT_ID,
        tokenEncrypted: encrypt(`${BOT_ID}:TEST-TOKEN-${"y".repeat(30)}`),
        vertical: "DATING",
        webhookSecret: "s-fix14",
      },
    });
    ids.bot = b.id;
    const channel = async (chatId: bigint) => {
      const c = await prisma.channel.create({
        data: {
          telegramChatId: chatId,
          title: TITLES[String(chatId)]!,
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
    ids.zone = await channel(ZONE);
    ids.roulette = await channel(ROULETTE);
    ids.tir = await channel(TIR);
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
    botWorld = installWorld(bot.api, members);
    workerWorld = installWorld(apiForBot(b), members);
    resetGateSweepMemory();
    // Marque du rattrapage posée : le filet ordinaire tourne (le rattrapage lui-même est testé plus bas).
    await prisma.setting.create({
      data: { key: GATE_BACKFILL_KEY, value: { doneAt: new Date().toISOString(), by: "script" } },
    });
  });

  afterAll(async () => {
    await prisma.setting.deleteMany({ where: { key: GATE_BACKFILL_KEY } });
    await prisma.auditLog.deleteMany({ where: { action: PHASE14_TEXTS_ACTION } });
    resetGateSweepMemory();
  });

  it("bouton pressé pendant l'entrée dans le dernier canal : un seul événement, un seul « C'est bon », heure gardée", async () => {
    await bot.handleUpdate(join(ZONE, 1701, Math.floor(Date.now() / 1000) - 60));
    const zone = await zoneOf(1701);
    expect(zone.status).toBe("PENDING_GATE");
    members.get(Number(ROULETTE))!.add(1701);
    members.get(Number(TIR))!.add(1701);
    // Pendant la vérification du bouton, l'entrée dans Tir arrive (validation automatique par le même bot).
    botWorld.hook = async () => {
      await bot.handleUpdate(entered(TIR, 1701));
    };
    const before = botWorld.calls.length;
    await bot.handleUpdate(pressed(1701, `g:${zone.code}`));
    const after = await zoneOf(1701);
    expect(after.status).toBe("SCHEDULED");
    const events = await gateEvents(zone.memberId);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      auto: true,
      trigger: "joined",
      approveAt: after.approveAt!.toISOString(),
    });
    // Un seul « C'est bon » : le message privé de la validation automatique, repérable par l'événement.
    const done = await prisma.outboundMessage.findMany({
      where: { memberId: zone.memberId, kind: "GATE_REMINDER" },
    });
    expect(done).toHaveLength(1);
    expect(done[0]!.text).toMatch(/^C'est bon U1701/);
    expect((events[0]!.payload as { outboundMessageId?: string }).outboundMessageId).toBe(
      done[0]!.id,
    );
    const made = botWorld.calls.slice(before);
    expect(made.filter((c) => c.method === "editMessageText")).toEqual([]);
    expect(made.find((c) => c.method === "answerCallbackQuery")?.payload).toMatchObject({
      callback_query_id: "cb1701",
      show_alert: true,
    });
    expect(made.find((c) => c.method === "editMessageReplyMarkup")?.payload).toMatchObject({
      reply_markup: { inline_keyboard: [] },
    });
  });

  it("bouton pressé pendant l'acceptation (règle « tout de suite ») : la demande acceptée reste acceptée, une seule fois", async () => {
    await prisma.approvalRule.update({
      where: { id: ids.rule },
      data: { mode: "IMMEDIATE", delaySeconds: 0 },
    });
    try {
      await bot.handleUpdate(join(ZONE, 1702, Math.floor(Date.now() / 1000) - 3600));
      const zone = await zoneOf(1702);
      expect(zone.status).toBe("PENDING_GATE");
      members.get(Number(ROULETTE))!.add(1702);
      members.get(Number(TIR))!.add(1702);
      // Pendant la vérification du bouton : validation automatique, puis acceptation par le worker (20 secondes).
      botWorld.hook = async () => {
        await bot.handleUpdate(entered(TIR, 1702));
        expect((await zoneOf(1702)).status).toBe("SCHEDULED");
        expect(await approveMembership(zone.id)).toBe("approved");
      };
      const before = botWorld.calls.length;
      await bot.handleUpdate(pressed(1702, `g:${zone.code}`));
      expect((await zoneOf(1702)).status).toBe("APPROVED");
      expect(await gateEvents(zone.memberId)).toHaveLength(1);
      expect(
        await prisma.event.count({
          where: { type: "membership.approved", memberId: zone.memberId },
        }),
      ).toBe(1);
      expect(
        await prisma.outboundMessage.count({
          where: { memberId: zone.memberId, kind: "ACCEPTED" },
        }),
      ).toBeLessThanOrEqual(1);
      const answer = botWorld.calls.slice(before).find((c) => c.method === "answerCallbackQuery");
      expect(answer?.payload).toMatchObject({ show_alert: true });
      expect(String(answer?.payload.text)).toMatch(/^Bienvenue dans Zone Interdite/);
      // Le passage suivant du worker n'a rien à refaire.
      const approvals = workerWorld.calls.filter((c) => c.method === "approveChatJoinRequest");
      await processApprovals(fakeJob({ type: "tick" as const }));
      expect(workerWorld.calls.filter((c) => c.method === "approveChatJoinRequest")).toHaveLength(
        approvals.length,
      );
    } finally {
      await prisma.approvalRule.update({
        where: { id: ids.rule },
        data: { mode: "DELAY", delaySeconds: 300 },
      });
    }
  });

  it("filet : un 429 avec retry_after 600 arrête ce bot 10 minutes, même aux passages suivants", async () => {
    resetGateSweepMemory();
    const member = await prisma.member.create({
      data: { telegramUserId: 1703n, firstName: "U1703" },
    });
    const m = await prisma.membership.create({
      data: {
        code: "fix14a1703",
        memberId: member.id,
        channelId: ids.zone,
        status: "PENDING_GATE",
        approvalRuleId: ids.rule,
        requestedAt: new Date(Date.now() - 10 * 60_000),
        source: { botId: ids.bot, appliedRule: { id: ids.rule, scope: "DEFAULT", label: null } },
      },
    });
    workerWorld.failGetChatMember = {
      error_code: 429,
      description: "Too Many Requests: retry after 600",
      parameters: { retry_after: 600 },
    };
    try {
      const count = () =>
        workerWorld.calls.filter((c) => c.method === "getChatMember" && c.payload.user_id === 1703)
          .length;
      await processApprovals(fakeJob({ type: "gate-sweep" as const }));
      expect(count()).toBe(1);
      expect(gateSweepBotPauses().get(ids.bot)).toBeGreaterThan(Date.now() + 9 * 60_000);
      for (let i = 0; i < 3; i++) await processApprovals(fakeJob({ type: "gate-sweep" as const }));
      expect(count()).toBe(1);
      expect((await prisma.membership.findUniqueOrThrow({ where: { id: m.id } })).status).toBe(
        "PENDING_GATE",
      );
    } finally {
      workerWorld.failGetChatMember = null;
      resetGateSweepMemory();
      await prisma.membership.update({ where: { id: m.id }, data: { status: "EXPIRED" } });
    }
  });

  it("rattrapage : états hérités réparés et accueils par défaut réécrits, une seule fois, comptés dans la marque", async () => {
    await prisma.setting.deleteMany({ where: { key: GATE_BACKFILL_KEY } });
    const person = (tg: number, over: Record<string, unknown> = {}) =>
      prisma.member.create({ data: { telegramUserId: BigInt(tg), firstName: `R${tg}`, ...over } });
    const state = (memberId: string, data: Record<string, unknown>) =>
      prisma.memberBotState.create({ data: { memberId, botId: ids.bot, ...data } });
    const t0 = new Date(Date.now() - 3 * 86_400_000);
    // Accueil parti dans la fenêtre de 5 minutes avant la phase 14 : « joignable » sans avoir démarré le bot.
    const windowOnly = await person(1710);
    await state(windowOnly.id, { canDm: true, lastDmAt: t0 });
    // Refus « can't initiate conversation » classé « a bloqué le bot » avant la phase 14 (aucun vrai blocage connu).
    const refused = await person(1711);
    await state(refused.id, { canDm: false, blockedAt: t0 });
    await prisma.event.create({
      data: { type: "dm.blocked", memberId: refused.id, botId: ids.bot, payload: { error: "x" } },
    });
    // Vrai blocage signalé par Telegram (my_chat_member) : gardé.
    const realBlock = await person(1712);
    await state(realBlock.id, { canDm: false, blockedAt: t0 });
    await prisma.event.create({
      data: { type: "member.blocked", memberId: realBlock.id, botId: ids.bot },
    });
    // Vrai blocage connu par l'erreur exacte (depuis la phase 14) : gardé.
    const realError = await person(1713);
    await state(realError.id, { canDm: false, blockedAt: t0 });
    await prisma.event.create({
      data: {
        type: "dm.blocked",
        memberId: realError.id,
        botId: ids.bot,
        payload: { telegramError: "403 Forbidden: bot was blocked by the user" },
      },
    });
    // Membre supprimé (anonymisé) : sa marque reste, plus jamais de message.
    const erased = await person(-1714, { anonymizedAt: t0 });
    await state(erased.id, { canDm: false, blockedAt: t0 });
    // A démarré le bot : inchangé.
    const started = await person(1715);
    await state(started.id, { canDm: true, startedAt: t0 });
    // A écrit au bot en privé (« ok », sans /start) après l'accueil : Telegram laisse le bot lui écrire, il reste
    // joignable (date de son premier message).
    const wrote = await person(1716);
    await state(wrote.id, { canDm: true, lastDmAt: t0 });
    const privateMessage = (tg: number, chat: { id: number; type: string; title?: string }) => ({
      update_id: tg,
      message: {
        message_id: 1,
        date: Math.floor(t0.getTime() / 1000),
        chat,
        from: { id: tg, is_bot: false, first_name: `R${tg}` },
        text: "ok",
      },
    });
    const wroteAt = new Date(t0.getTime() + 60_000);
    await prisma.event.createMany({
      data: [
        {
          type: "telegram.message",
          memberId: wrote.id,
          botId: ids.bot,
          occurredAt: new Date(wroteAt.getTime() + 3_600_000),
          payload: privateMessage(1716, { id: 1716, type: "private" }),
        },
        {
          type: "telegram.message",
          memberId: wrote.id,
          botId: ids.bot,
          occurredAt: wroteAt,
          payload: privateMessage(1716, { id: 1716, type: "private" }),
        },
      ],
    });
    // A seulement écrit dans un groupe : n'a jamais écrit au bot, plus joignable.
    const groupOnly = await person(1717);
    await state(groupOnly.id, { canDm: true, lastDmAt: t0 });
    await prisma.event.create({
      data: {
        type: "telegram.message",
        memberId: groupOnly.id,
        botId: ids.bot,
        payload: privateMessage(1717, { id: -100_1717, type: "supergroup", title: "Groupe" }),
      },
    });

    // Accueils : un resté au texte par défaut d'avant, un écrit par l'équipe.
    const seq = async (channelId: string, fr: string) =>
      prisma.sequence.create({
        data: {
          name: "Accueil",
          channelId,
          trigger: "JOIN_REQUEST",
          steps: { create: { order: 0, texts: { fr } } },
        },
        include: { steps: true },
      });
    const plain = await seq(ids.roulette, PHASE13_JOIN_REQUEST_TEXTS.DATING);
    const team = await seq(
      ids.zone,
      "Rejoins les deux canaux ci-dessous, puis clique sur « J'ai rejoint » pour être accepté",
    );

    const r = await phase14GateBackfill();
    expect(r.alreadyDone).toBe(false);
    expect(r.botStates).toEqual({ canDmCleared: 2, blockedCleared: 1, wroteKept: 1 });
    expect(r.sequenceTexts).toMatchObject({ updated: 1, keptByTeam: 1 });
    const stateOf = (memberId: string) =>
      prisma.memberBotState.findUniqueOrThrow({
        where: { memberId_botId: { memberId, botId: ids.bot } },
      });
    expect(await stateOf(windowOnly.id)).toMatchObject({ canDm: false, blockedAt: null });
    expect(await stateOf(refused.id)).toMatchObject({ canDm: false, blockedAt: null });
    expect((await stateOf(realBlock.id)).blockedAt).toEqual(t0);
    expect((await stateOf(realError.id)).blockedAt).toEqual(t0);
    expect((await stateOf(erased.id)).blockedAt).toEqual(t0);
    expect(await stateOf(started.id)).toMatchObject({
      canDm: true,
      startedAt: t0,
      blockedAt: null,
    });
    expect(await stateOf(wrote.id)).toMatchObject({
      canDm: true,
      startedAt: wroteAt,
      blockedAt: null,
    });
    expect(await stateOf(groupOnly.id)).toMatchObject({ canDm: false, startedAt: null });
    const stepOf = async (id: string) =>
      (await prisma.sequenceStep.findUniqueOrThrow({ where: { id } })).texts;
    expect(await stepOf(plain.steps[0]!.id)).toEqual({
      fr: defaultSequenceText("DATING", "JOIN_REQUEST"),
    });
    expect(await stepOf(team.steps[0]!.id)).toEqual({
      fr: "Rejoins les deux canaux ci-dessous, puis clique sur « J'ai rejoint » pour être accepté",
    });
    expect(await prisma.auditLog.count({ where: { action: PHASE14_TEXTS_ACTION } })).toBe(1);
    const marker = await prisma.setting.findUniqueOrThrow({ where: { key: GATE_BACKFILL_KEY } });
    expect(marker.value).toMatchObject({
      botStates: { canDmCleared: 2, blockedCleared: 1, wroteKept: 1 },
      sequenceTexts: { updated: 1 },
    });

    // Déjà fait : rien n'est retouché (un état hérité réapparu reste tel quel jusqu'à un passage forcé).
    await prisma.memberBotState.update({
      where: { memberId_botId: { memberId: windowOnly.id, botId: ids.bot } },
      data: { canDm: true },
    });
    const again = await phase14GateBackfill();
    expect(again).toMatchObject({ alreadyDone: true, botStates: { canDmCleared: 2 } });
    expect((await stateOf(windowOnly.id)).canDm).toBe(true);

    // Marque d'un rattrapage fait avant ces réparations : elles tournent une fois, la marque est complétée.
    await prisma.setting.update({
      where: { key: GATE_BACKFILL_KEY },
      data: { value: { doneAt: new Date().toISOString(), by: "worker", satisfied: 3 } },
    });
    const completed = await phase14GateBackfill();
    expect(completed).toMatchObject({
      alreadyDone: true,
      satisfied: 3,
      botStates: { canDmCleared: 1, blockedCleared: 0, wroteKept: 0 },
      sequenceTexts: { updated: 0 },
    });
    expect((await stateOf(windowOnly.id)).canDm).toBe(false);
    expect(
      (await prisma.setting.findUniqueOrThrow({ where: { key: GATE_BACKFILL_KEY } })).value,
    ).toMatchObject({ satisfied: 3, botStates: { canDmCleared: 1 } });
  });
});

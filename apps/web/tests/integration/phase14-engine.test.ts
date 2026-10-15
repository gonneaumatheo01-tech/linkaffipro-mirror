/**
 * Phase 14 par le vrai webhook du site (base réelle) : validation automatique quand la personne fait une demande dans
 * le 2e canal obligatoire, bouton à rappel « ✅ J'ai rejoint » (callback_query), personne qui écrit au bot en privé
 * (joignable ensuite). « Accepté » depuis le site : phase14-approve-now.test.ts.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { encrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import {
  getOrCreateBot,
  memberReachabilityWithDb,
  prismaTelegramDeps,
} from "@linkaffipro/telegram";
import type { Api } from "grammy";
import { POST } from "@/app/api/telegram/[botId]/route";
import {
  capturedJobs,
  ctx,
  flushAfter,
  resetDb,
  webhookRequest,
  type TelegramCall,
} from "./helpers";

const SECRET = "secret-p14";
const ZONE = -1001600000001n;
const ROULETTE = -1001600000002n;
const TIR = -1001600000003n;
const TITLES: Record<string, string> = {
  [String(ZONE)]: "Zone Interdite 🔞",
  [String(ROULETTE)]: "LA ZONE ROULETTE 🎰",
  [String(TIR)]: "🎯 TIR CADRÉ ⚡",
};

/** Telegram simulé : statut de chaque personne dans chaque canal (« left » par défaut). */
function installWorld(api: Api, members: Map<number, Set<number>>): TelegramCall[] {
  const calls: TelegramCall[] = [];
  api.config.use(async (_prev, method, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    calls.push({ method, payload: p });
    if (method === "getChatMember")
      return {
        ok: true,
        result: {
          status: members.get(Number(p.chat_id))?.has(Number(p.user_id)) ? "member" : "left",
          user: { id: Number(p.user_id), is_bot: false, first_name: "x" },
        },
      } as never;
    if (method === "createChatInviteLink")
      return {
        ok: true,
        result: {
          invite_link: `https://t.me/+web14${String(p.chat_id).slice(-3)}`,
          creator: { id: 161, is_bot: true, first_name: "b" },
          creates_join_request: true,
          is_primary: false,
          is_revoked: false,
        },
      } as never;
    if (/^(send|edit)Message/.test(method) || method === "editMessageText")
      return {
        ok: true,
        result: {
          message_id: 12,
          date: Math.floor(Date.now() / 1000),
          chat: { id: Number(p.chat_id), type: "private" },
          text: String(p.text ?? ""),
        },
      } as never;
    return { ok: true, result: true } as never;
  });
  return calls;
}

const join = (chatId: bigint, userId: number, date = Math.floor(Date.now() / 1000)) => ({
  update_id: userId + Number(-chatId % 100n),
  chat_join_request: {
    chat: { id: Number(chatId), type: "channel", title: TITLES[String(chatId)] },
    from: { id: userId, is_bot: false, first_name: `U${userId}`, language_code: "fr" },
    user_chat_id: userId,
    date,
  },
});

const wrote = (userId: number, text: string) => ({
  update_id: userId * 5,
  message: {
    message_id: 30,
    date: Math.floor(Date.now() / 1000),
    chat: { id: userId, type: "private", first_name: `U${userId}` },
    from: { id: userId, is_bot: false, first_name: `U${userId}`, language_code: "fr" },
    text,
  },
});

const pressed = (userId: number, data: string) => ({
  update_id: userId * 3,
  callback_query: {
    id: `cb${userId}`,
    from: { id: userId, is_bot: false, first_name: `U${userId}`, language_code: "fr" },
    chat_instance: "ci",
    data,
    message: {
      message_id: 12,
      date: Math.floor(Date.now() / 1000),
      chat: { id: userId, type: "private", first_name: `U${userId}` },
      text: "Accueil",
    },
  },
});

describe("phase 14 : webhook du site (base réelle)", () => {
  const ids = { bot: "", zone: "", roulette: "", tir: "" };
  const members = new Map<number, Set<number>>([
    [Number(ZONE), new Set()],
    [Number(ROULETTE), new Set()],
    [Number(TIR), new Set()],
  ]);
  let calls: TelegramCall[] = [];
  const send = async (update: unknown) => {
    const res = await POST(webhookRequest(update, SECRET), ctx({ botId: ids.bot }));
    expect(res.status).toBe(200);
    await flushAfter();
  };
  const zoneOf = (tg: number) =>
    prisma.membership.findFirstOrThrow({
      where: { member: { telegramUserId: BigInt(tg) }, channelId: ids.zone },
    });

  beforeAll(async () => {
    await resetDb();
    const bot = await prisma.bot.create({
      data: {
        name: "Bot rencontres",
        username: "bot_web14",
        telegramBotId: 161n,
        tokenEncrypted: encrypt(`161:TEST-TOKEN-${"x".repeat(30)}`),
        vertical: "DATING",
        webhookSecret: SECRET,
      },
    });
    ids.bot = bot.id;
    const channel = async (chatId: bigint) => {
      const c = await prisma.channel.create({
        data: {
          telegramChatId: chatId,
          title: TITLES[String(chatId)]!,
          type: "CHANNEL",
          language: "fr",
          primaryBotId: bot.id,
        },
      });
      await prisma.channelBotAdmin.create({
        data: {
          channelId: c.id,
          botId: bot.id,
          rights: { status: "administrator", can_invite_users: true },
        },
      });
      return c.id;
    };
    ids.zone = await channel(ZONE);
    ids.roulette = await channel(ROULETTE);
    ids.tir = await channel(TIR);
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
    });
    calls = installWorld(getOrCreateBot(bot, prismaTelegramDeps).api, members);
  });

  it("demande dans le 2e canal obligatoire → acceptation programmée sans « ✅ J'ai rejoint »", async () => {
    await send(join(ZONE, 1601));
    expect((await zoneOf(1601)).status).toBe("PENDING_GATE");
    const zone = await zoneOf(1601);
    expect(capturedJobs("approvals").map((j) => j.data)).toContainEqual({
      type: "reminder",
      membershipId: zone.id,
    });
    await send(join(ROULETTE, 1601));
    expect((await zoneOf(1601)).status).toBe("PENDING_GATE");
    await send(join(TIR, 1601));
    const after = await zoneOf(1601);
    expect(after.status).toBe("SCHEDULED");
    const done = await prisma.outboundMessage.findFirstOrThrow({
      where: { memberId: after.memberId, kind: "GATE_REMINDER" },
    });
    expect(done.text).toBe(
      "C'est bon U1601, tu seras accepté dans <b>Zone Interdite 🔞</b> dans 5 minutes.",
    );
  });

  it("bouton à rappel par le webhook : un canal manquant puis complet ; le message du bot est modifié", async () => {
    await send(join(ZONE, 1602, Math.floor(Date.now() / 1000) - 3600));
    const zone = await zoneOf(1602);
    members.get(Number(ROULETTE))!.add(1602);
    let before = calls.length;
    await send(pressed(1602, `g:${zone.code}`));
    let made = calls.slice(before);
    expect(made.find((c) => c.method === "answerCallbackQuery")?.payload).toMatchObject({
      callback_query_id: "cb1602",
    });
    expect(made.find((c) => c.method === "editMessageText")?.payload).toMatchObject({
      chat_id: 1602,
      message_id: 12,
      text: "Il te manque encore : 🎯 TIR CADRÉ ⚡. Rejoins-les puis appuie à nouveau sur ✅ J'ai rejoint.",
    });
    expect((await zoneOf(1602)).status).toBe("PENDING_GATE");

    members.get(Number(TIR))!.add(1602);
    before = calls.length;
    await send(pressed(1602, `g:${zone.code}`));
    made = calls.slice(before);
    expect(String(made.find((c) => c.method === "editMessageText")?.payload.text)).toMatch(
      /^C'est bon U1602/,
    );
    expect((await zoneOf(1602)).status).toBe("SCHEDULED");
    // La personne a appuyé sur un bouton du bot : joignable pour « Accepté ».
    const state = await prisma.memberBotState.findUniqueOrThrow({
      where: { memberId_botId: { memberId: zone.memberId, botId: ids.bot } },
    });
    expect(state.startedAt).toBeInstanceOf(Date);
    expect(state.canDm).toBe(true);
  });

  it("une personne qui répond au bot en privé (autre chose que /start) devient joignable", async () => {
    // Demande d'il y a une heure (fenêtre de 5 minutes passée), accueil reçu dans la fenêtre : jamais « Démarrer ».
    await send(join(ZONE, 1603, Math.floor(Date.now() / 1000) - 3600));
    const zone = await zoneOf(1603);
    const request = { userChatId: zone.userChatId, requestedAt: zone.requestedAt };
    expect(await memberReachabilityWithDb(zone.memberId, ids.bot, request)).toEqual({
      reachable: false,
      reason: "never_started",
    });
    await send(wrote(1603, "ok"));
    const state = await prisma.memberBotState.findUniqueOrThrow({
      where: { memberId_botId: { memberId: zone.memberId, botId: ids.bot } },
    });
    expect(state).toMatchObject({ canDm: true, blockedAt: null });
    expect(state.startedAt).toBeInstanceOf(Date);
    expect(await memberReachabilityWithDb(zone.memberId, ids.bot, request)).toEqual({
      reachable: true,
      via: "started",
    });
    // Déjà joignable : un 2e message ne réécrit rien (date de départ gardée).
    await send(wrote(1603, "merci"));
    const again = await prisma.memberBotState.findUniqueOrThrow({
      where: { memberId_botId: { memberId: zone.memberId, botId: ids.bot } },
    });
    expect(again.startedAt?.getTime()).toBe(state.startedAt?.getTime());
  });

  it("refus d'envoi de Telegram ou blocage, puis la personne écrit au bot : de nouveau joignable", async () => {
    const make = async (
      tg: number,
      data: { canDm: boolean; startedAt: Date | null; blockedAt: Date | null },
    ) => {
      const member = await prisma.member.create({
        data: { telegramUserId: BigInt(tg), firstName: `U${tg}` },
      });
      await prisma.memberBotState.create({
        data: { memberId: member.id, botId: ids.bot, ...data },
      });
      return member.id;
    };
    const long = new Date(Date.now() - 86_400_000);
    const refused = await make(1604, { canDm: false, startedAt: long, blockedAt: null });
    const blocked = await make(1605, { canDm: false, startedAt: long, blockedAt: long });
    await send(wrote(1604, "salut"));
    await send(wrote(1605, "salut"));
    for (const memberId of [refused, blocked]) {
      const state = await prisma.memberBotState.findUniqueOrThrow({
        where: { memberId_botId: { memberId, botId: ids.bot } },
      });
      expect(state).toMatchObject({ canDm: true, blockedAt: null, startedAt: long });
      expect(await memberReachabilityWithDb(memberId, ids.bot, null)).toEqual({
        reachable: true,
        via: "started",
      });
    }
  });
});

/**
 * Phase 11 sur base réelle : « après avoir rejoint ces canaux, puis accepter dans 1 jour » avec une expiration de
 * 24 heures (refuser). Une personne qui a cliqué « ✅ J'ai rejoint » attend le délai annoncé (« tu seras accepté dans
 * 1 jour ») : elle n'expire jamais et elle est acceptée à l'heure dite. Une personne qui n'a rien fait expire comme avant.
 * Horloge simulée en reculant les dates enregistrées des demandes.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import { createBot, prismaTelegramDeps } from "@linkaffipro/telegram";
import type { Bot } from "grammy";
import type { Update } from "grammy/types";
import { apiForBot } from "../../src/approvals/telegram-actions";
import { processApprovals } from "../../src/processors/approvals";
import {
  createBotAndChannel,
  fakeJob,
  installFakeTelegram,
  resetDb,
  type TelegramCall,
} from "./helpers";

const CHAT_A = -1001400000001n;
const CHAT_B = -1001400000002n;

function joinRequest(userId: number): Update {
  return {
    update_id: userId,
    chat_join_request: {
      chat: { id: Number(CHAT_A), type: "channel", title: "Canal test" },
      from: { id: userId, is_bot: false, first_name: `U${userId}`, language_code: "fr" },
      user_chat_id: userId,
      date: Math.floor(Date.now() / 1000) - 5,
    },
  } as Update;
}
function start(userId: number, code: string): Update {
  return {
    update_id: userId * 10,
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

/** Avance l'horloge de `ms` : toutes les dates des demandes (y compris l'expiration) reculent d'autant. */
async function travel(ms: number) {
  await prisma.$executeRaw`UPDATE "Membership" SET
    "requestedAt" = "requestedAt" - (${ms} * interval '1 millisecond'),
    "approveAt" = "approveAt" - (${ms} * interval '1 millisecond'),
    "expiresAt" = "expiresAt" - (${ms} * interval '1 millisecond'),
    "gateSatisfiedAt" = "gateSatisfiedAt" - (${ms} * interval '1 millisecond')`;
}

describe("délai après « ✅ J'ai rejoint » plus long que l'expiration de la demande (base réelle)", () => {
  let channelA = "";
  let bot: Bot;
  let workerCalls: TelegramCall[] = [];
  const HOUR = 3_600_000;
  const latest = (tgId: number) =>
    prisma.membership.findFirstOrThrow({
      where: { member: { telegramUserId: BigInt(tgId) }, channelId: channelA },
    });
  const run = (type: "tick" | "expirations") => processApprovals(fakeJob({ type }));

  beforeAll(async () => {
    await resetDb();
    const created = await createBotAndChannel({ chatId: CHAT_A });
    channelA = created.channel.id;
    const channelB = await prisma.channel.create({
      data: {
        telegramChatId: CHAT_B,
        title: "Canal obligatoire",
        type: "CHANNEL",
        language: "fr",
        primaryBotId: created.bot.id,
        isTest: true,
      },
    });
    await prisma.channelBotAdmin.create({
      data: {
        channelId: channelB.id,
        botId: created.bot.id,
        rights: { status: "administrator", can_invite_users: true },
      },
    });
    await prisma.approvalRule.create({
      data: {
        channelId: channelA,
        name: "Règle par défaut",
        isDefault: true,
        scope: "DEFAULT",
        mode: "DELAY",
        delaySeconds: 86_400,
        gateMode: "REQUIRED",
        gateChannelIds: [channelB.id],
        reminderAfterMinutes: [],
        maxReminders: 0,
        expireAfterHours: 24,
        expireAction: "DECLINE",
      },
    });
    bot = createBot(created.bot, prismaTelegramDeps);
    // getChatMember simulé : « member » (la personne a bien rejoint le canal obligatoire).
    installFakeTelegram(bot.api);
    workerCalls = installFakeTelegram(apiForBot(created.bot));
  });

  it("clic à T+1 h : jamais refusée à T+24 h, acceptée à T+25 h ; la personne qui n'a rien fait est refusée à T+24 h", async () => {
    await bot.handleUpdate(joinRequest(7101));
    await bot.handleUpdate(joinRequest(7102));
    const waiting = await latest(7101);
    expect(waiting.status).toBe("PENDING_GATE");
    expect(waiting.expiresAt!.getTime() - waiting.requestedAt.getTime()).toBe(24 * HOUR);

    await travel(HOUR);
    await bot.handleUpdate(start(7101, waiting.code));
    let clicked = await latest(7101);
    expect(clicked.status).toBe("SCHEDULED");
    expect(clicked.approveAt!.getTime() - clicked.gateSatisfiedAt!.getTime()).toBe(24 * HOUR);

    // T+24 h (et une minute) : l'expiration est passée, l'acceptation est dans une heure.
    await travel(23 * HOUR + 60_000);
    expect(await run("expirations")).toEqual({ expired: 1 });
    clicked = await latest(7101);
    expect(clicked.status).toBe("SCHEDULED");
    expect((await latest(7102)).status).toBe("DECLINED");
    const declined = workerCalls.filter((c) => c.method === "declineChatJoinRequest");
    expect(declined.map((c) => c.payload.user_id)).toEqual([7102]);
    expect(await run("tick")).toEqual({ claimed: 0, approved: 0 });

    // Un second passage des expirations ne la touche toujours pas.
    expect(await run("expirations")).toEqual({ expired: 0 });

    // T+25 h : acceptée, comme annoncé.
    await travel(HOUR);
    expect(await run("tick")).toEqual({ claimed: 1, approved: 1 });
    expect((await latest(7101)).status).toBe("APPROVED");
    expect(
      workerCalls.filter((c) => c.method === "approveChatJoinRequest").map((c) => c.payload),
    ).toEqual([{ chat_id: Number(CHAT_A), user_id: 7101 }]);
    expect(
      await prisma.event.count({
        where: { type: "membership.expired", channelId: channelA },
      }),
    ).toBe(1);
  });
});

describe("demande planifiée dès son arrivée : l'expiration de la règle ne la refuse jamais (base réelle)", () => {
  const CHAT_ZONE = -1001400000011n;
  const CHAT_TIR = -1001400000012n;
  const CHAT_LYON = -1001400000013n;
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  const ids = { zone: "", tir: "", lyon: "", fromLyon: "" };
  let bot: Bot;
  let workerCalls: TelegramCall[] = [];
  const latest = (tgId: number) =>
    prisma.membership.findFirstOrThrow({
      where: { member: { telegramUserId: BigInt(tgId) }, channelId: ids.tir },
    });
  const run = (type: "tick" | "expirations") => processApprovals(fakeJob({ type }));
  function joinVia(userId: number, url: string): Update {
    return {
      update_id: userId,
      chat_join_request: {
        chat: { id: Number(CHAT_TIR), type: "channel", title: "Tir Cadré" },
        from: { id: userId, is_bot: false, first_name: `U${userId}`, language_code: "fr" },
        user_chat_id: userId,
        date: Math.floor(Date.now() / 1000) - 5,
        invite_link: {
          invite_link: url,
          creator: { id: 111, is_bot: true, first_name: "bot" },
          creates_join_request: true,
          is_primary: false,
          is_revoked: false,
        },
      },
    } as Update;
  }

  beforeAll(async () => {
    await resetDb();
    const created = await createBotAndChannel({ chatId: CHAT_ZONE, title: "Zone Interdite" });
    ids.zone = created.channel.id;
    for (const [key, chatId, title] of [
      ["tir", CHAT_TIR, "Tir Cadré"],
      ["lyon", CHAT_LYON, "Lyon"],
    ] as const) {
      const c = await prisma.channel.create({
        data: {
          telegramChatId: chatId,
          title,
          type: "CHANNEL",
          language: "fr",
          primaryBotId: created.bot.id,
          isTest: true,
        },
      });
      await prisma.channelBotAdmin.create({
        data: {
          channelId: c.id,
          botId: created.bot.id,
          rights: { status: "administrator", can_invite_users: true },
        },
      });
      ids[key] = c.id;
    }
    // Tir Cadré : « après avoir rejoint Zone Interdite, puis accepter 2 jours », expiration 24 h → refuser (pensée
    // pour les personnes qui ne rejoignent pas).
    await prisma.approvalRule.create({
      data: {
        channelId: ids.tir,
        name: "Règle par défaut",
        isDefault: true,
        scope: "DEFAULT",
        mode: "DELAY",
        delaySeconds: 2 * 86_400,
        gateMode: "REQUIRED",
        gateChannelIds: [ids.zone],
        reminderAfterMinutes: [],
        maxReminders: 0,
        expireAfterHours: 24,
        expireAction: "DECLINE",
      },
    });
    // Exception « venu de Lyon → après 1 jour » qui a recopié l'expiration de la règle par défaut (24 h → refuser) :
    // acceptation et expiration tombent à la même heure.
    const ex = await prisma.approvalRule.create({
      data: {
        channelId: ids.tir,
        name: "Venu de Lyon",
        label: "Venu de « Lyon »",
        scope: "SOURCE_CHANNEL",
        sourceChannelId: ids.lyon,
        sortOrder: 10,
        mode: "DELAY",
        delaySeconds: 86_400,
        gateMode: "NONE",
        gateChannelIds: [],
        reminderAfterMinutes: [],
        maxReminders: 0,
        expireAfterHours: 24,
        expireAction: "DECLINE",
      },
    });
    ids.fromLyon = ex.id;
    // Boutons « canal à rejoindre » de Zone et de Lyon vers Tir Cadré (avec demande d'adhésion).
    for (const [src, url] of [
      [ids.zone, "https://t.me/+BoutonZoneVersTir"],
      [ids.lyon, "https://t.me/+BoutonLyonVersTir"],
    ] as const)
      await prisma.inviteLink.create({
        data: {
          channelId: ids.tir,
          botId: created.bot.id,
          telegramInviteLink: url,
          name: `gate:${src}`,
          kind: "GATE",
          createsJoinRequest: true,
          sourceChannelId: src,
        },
      });
    bot = createBot(created.bot, prismaTelegramDeps);
    installFakeTelegram(bot.api);
    workerCalls = installFakeTelegram(apiForBot(created.bot));
  });

  it("venu du bouton de Zone (règle par défaut, aucun canal imposé, 2 jours) et venu de Lyon (exception 1 jour) : jamais refusés à 24 h, acceptés à l'heure annoncée", async () => {
    await bot.handleUpdate(joinVia(7201, "https://t.me/+BoutonZoneVersTir"));
    await bot.handleUpdate(joinVia(7202, "https://t.me/+BoutonLyonVersTir"));
    const fromZone = await latest(7201);
    expect(fromZone).toMatchObject({ status: "SCHEDULED", gateSatisfiedAt: null });
    expect(fromZone.source).toMatchObject({
      provenance: { type: "GATE", sourceChannelId: ids.zone },
      appliedRule: { scope: "DEFAULT", noGates: true },
    });
    expect(fromZone.approveAt!.getTime() - fromZone.requestedAt.getTime()).toBe(2 * DAY);
    const fromLyon = await latest(7202);
    expect(fromLyon).toMatchObject({ status: "SCHEDULED", approvalRuleId: ids.fromLyon });
    expect(fromLyon.approveAt!.getTime() - fromLyon.requestedAt.getTime()).toBe(DAY);
    // Le bot leur a annoncé l'heure d'accès.
    const short = await prisma.outboundMessage.findMany({
      where: { kind: "WELCOME" },
      orderBy: { queuedAt: "asc" },
    });
    expect(short.map((s) => s.text)).toEqual([
      "Ta demande pour <b>Tir Cadré</b> est bien reçue, accès dans 2 jours.",
      "Ta demande pour <b>Tir Cadré</b> est bien reçue, accès dans 1 jour.",
    ]);

    // Demande enregistrée avant la correction (planifiée dans 2 jours, avec une expiration à 24 h) : jamais refusée.
    const old = await prisma.member.create({ data: { telegramUserId: 7203n, firstName: "U7203" } });
    const now = Date.now();
    await prisma.membership.create({
      data: {
        code: "ancienne7203",
        memberId: old.id,
        channelId: ids.tir,
        status: "SCHEDULED",
        approvalRuleId: null,
        requestedAt: new Date(now),
        approveAt: new Date(now + 2 * DAY),
        expiresAt: new Date(now + DAY),
        source: {},
      },
    });

    // T+24 h (et une minute) : expirations d'abord (le cas perdu de la course), aucune demande refusée.
    await travel(DAY + 60_000);
    expect(await run("expirations")).toEqual({ expired: 0 });
    expect(workerCalls.filter((c) => c.method === "declineChatJoinRequest")).toEqual([]);
    for (const tg of [7201, 7202, 7203]) expect((await latest(tg)).status).toBe("SCHEDULED");
    // Venu de Lyon : accepté à 1 jour, comme annoncé.
    expect(await run("tick")).toEqual({ claimed: 1, approved: 1 });
    expect((await latest(7202)).status).toBe("APPROVED");

    // T+48 h : les deux autres acceptées ; aucune expiration en route.
    await travel(DAY);
    expect(await run("expirations")).toEqual({ expired: 0 });
    expect(await run("tick")).toEqual({ claimed: 2, approved: 2 });
    for (const tg of [7201, 7203]) expect((await latest(tg)).status).toBe("APPROVED");
    expect(await prisma.event.count({ where: { type: "membership.expired" } })).toBe(0);
    expect(
      workerCalls
        .filter((c) => c.method === "approveChatJoinRequest")
        .map((c) => c.payload.user_id)
        .sort(),
    ).toEqual([7201, 7202, 7203]);
  });
});

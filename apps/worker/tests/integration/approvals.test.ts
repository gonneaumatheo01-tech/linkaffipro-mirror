import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import { createBot, prismaTelegramDeps } from "@linkaffipro/telegram";
import type { Bot } from "grammy";
import type { Update } from "grammy/types";
import { apiForBot } from "../../src/approvals/telegram-actions";
import { processApprovals } from "../../src/processors/approvals";
import { capturedJobs, createBotAndChannel, fakeJob, installFakeTelegram, resetDb, type TelegramCall } from "./helpers";

const CHAT_A = -1001234567890n;
const CHAT_B = -1009876543210n;
const LINK_A = "https://t.me/+PubMeta001";
const LINK_GATE = "https://t.me/+PubTikTok002";

function joinRequest(chatId: bigint, userId: number, inviteLink: string, date = Math.floor(Date.now() / 1000) - 5): Update {
  return {
    update_id: userId,
    chat_join_request: {
      chat: { id: Number(chatId), type: "channel", title: "Canal test" },
      from: { id: userId, is_bot: false, first_name: `U${userId}`, language_code: "fr" },
      user_chat_id: userId,
      date,
      invite_link: { invite_link: inviteLink, creator: { id: 111, is_bot: true, first_name: "Bot test" }, creates_join_request: true, is_primary: false, is_revoked: false },
    },
  } as Update;
}

function startCommand(userId: number, payload: string, updateId: number): Update {
  return {
    update_id: updateId,
    message: { message_id: updateId, date: Math.floor(Date.now() / 1000), chat: { id: userId, type: "private", first_name: `U${userId}` }, from: { id: userId, is_bot: false, first_name: `U${userId}`, language_code: "fr" }, text: `/start ${payload}`, entities: [{ type: "bot_command", offset: 0, length: 6 }] },
  } as Update;
}

function chatMemberJoined(chatId: bigint, userId: number, inviteLink: string): Update {
  const user = { id: userId, is_bot: false, first_name: `U${userId}` };
  return {
    update_id: 900 + userId,
    chat_member: {
      chat: { id: Number(chatId), type: "channel", title: "Canal test" },
      from: user,
      date: Math.floor(Date.now() / 1000),
      old_chat_member: { status: "left", user },
      new_chat_member: { status: "member", user },
      invite_link: { invite_link: inviteLink, creator: { id: 111, is_bot: true, first_name: "Bot test" }, creates_join_request: true, is_primary: false, is_revoked: false },
    },
  } as Update;
}

describe("adhésion de bout en bout : demande → file → approbation par le worker (base réelle)", () => {
  let botId = "";
  let channelAId = "";
  let channelBId = "";
  let linkAId = "";
  let linkGateId = "";
  let bot: Bot;
  let botCalls: TelegramCall[] = [];
  let workerCalls: TelegramCall[] = [];

  beforeAll(async () => {
    await resetDb();
    const created = await createBotAndChannel({ chatId: CHAT_A });
    botId = created.bot.id;
    channelAId = created.channel.id;
    const channelB = await prisma.channel.create({ data: { telegramChatId: CHAT_B, title: "Canal partenaire", username: "canal_partenaire", type: "CHANNEL", language: "fr", primaryBotId: botId, isTest: true } });
    channelBId = channelB.id;
    await prisma.channelBotAdmin.create({ data: { channelId: channelB.id, botId, rights: { status: "administrator" } } });

    // Règle par défaut du canal A : approbation immédiate, sans canaux requis.
    await prisma.approvalRule.create({ data: { channelId: channelAId, name: "Immédiat", isDefault: true, mode: "IMMEDIATE", gateMode: "NONE", gateChannelIds: [], reminderAfterMinutes: [], maxReminders: 0 } });
    const linkA = await prisma.inviteLink.create({ data: { channelId: channelAId, botId, telegramInviteLink: LINK_A, name: "Pub Meta 1", kind: "AD_ENTRY", adPlatform: "META" } });
    linkAId = linkA.id;
    // Lien avec règle propre : il faut d'abord rejoindre le canal B.
    const linkGate = await prisma.inviteLink.create({ data: { channelId: channelAId, botId, telegramInviteLink: LINK_GATE, name: "Pub TikTok 2", kind: "AD_ENTRY", adPlatform: "TIKTOK" } });
    linkGateId = linkGate.id;
    await prisma.approvalRule.create({ data: { channelId: channelAId, inviteLinkId: linkGate.id, name: "Avec canal requis", mode: "DELAY", delaySeconds: 0, gateMode: "REQUIRED", gateChannelIds: [channelBId], reminderAfterMinutes: [], maxReminders: 0 } });

    // Le bot grammY (même code que le webhook) et l'API utilisée par le worker pour approuver : tous deux simulés.
    bot = createBot(created.bot, prismaTelegramDeps);
    botCalls = installFakeTelegram(bot.api);
    workerCalls = installFakeTelegram(apiForBot(created.bot));
  });

  it("approuve une demande immédiate au premier balayage et prévient le membre", async () => {
    await bot.handleUpdate(joinRequest(CHAT_A, 5001, LINK_A));
    const member = await prisma.member.findUnique({ where: { telegramUserId: 5001n } });
    expect(member).not.toBeNull();
    let membership = await prisma.membership.findFirstOrThrow({ where: { memberId: member!.id, channelId: channelAId } });
    expect(membership.status).toBe("SCHEDULED");
    expect(membership.inviteLinkId).toBe(linkAId);
    expect(membership.approveAt!.getTime()).toBeLessThanOrEqual(Date.now());
    const welcome = await prisma.outboundMessage.findFirstOrThrow({ where: { memberId: member!.id, kind: "WELCOME" } });
    expect(welcome.status).toBe("QUEUED");
    expect(capturedJobs("telegram-send").map((j) => j.data)).toContainEqual({ type: "dm", outboundMessageId: welcome.id });

    // Balayage du worker (file approvals, type tick).
    const result = await processApprovals(fakeJob({ type: "tick" as const }));
    expect(result).toEqual({ claimed: 1, approved: 1 });

    const approve = workerCalls.find((c) => c.method === "approveChatJoinRequest");
    expect(approve?.payload).toEqual({ chat_id: Number(CHAT_A), user_id: 5001 });

    membership = await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(membership.status).toBe("APPROVED");
    expect(membership.approvedByBotId).toBe(botId);
    expect(membership.approvedAt).toBeInstanceOf(Date);
    expect(membership.lastError).toBeNull();
    const link = await prisma.inviteLink.findUniqueOrThrow({ where: { id: linkAId } });
    expect(link.requests).toBe(1);
    expect(link.approved).toBe(1);

    // Message « accepté » en file, événement journalisé.
    const accepted = await prisma.outboundMessage.findFirst({ where: { memberId: member!.id, kind: "ACCEPTED" } });
    expect(accepted?.status).toBe("QUEUED");
    expect(accepted?.chatId).toBe(5001n);
    const types = (await prisma.event.findMany({ where: { memberId: member!.id } })).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["membership.requested", "membership.approved"]));

    // Un second balayage ne trouve plus rien.
    expect(await processApprovals(fakeJob({ type: "tick" as const }))).toEqual({ claimed: 0, approved: 0 });
  });

  it("enregistre l'entrée effective dans le canal (chat_member) et émet l'automatisation JOINED", async () => {
    await bot.handleUpdate(chatMemberJoined(CHAT_A, 5001, LINK_A));
    const member = await prisma.member.findUniqueOrThrow({ where: { telegramUserId: 5001n } });
    const membership = await prisma.membership.findFirstOrThrow({ where: { memberId: member.id, channelId: channelAId } });
    expect(membership.status).toBe("APPROVED");
    expect(membership.joinedAt).toBeInstanceOf(Date);
    const link = await prisma.inviteLink.findUniqueOrThrow({ where: { id: linkAId } });
    expect(link.joined).toBe(1);
    const joined = capturedJobs("automations").find((j) => j.data.trigger === "JOINED");
    expect(joined?.data.memberId).toBe(member.id);
    expect((joined?.data.context as { inviteLinkId?: string }).inviteLinkId).toBe(linkAId);
  });

  it("attend que le membre rejoigne le canal requis, puis approuve après /start g<code>", async () => {
    await bot.handleUpdate(joinRequest(CHAT_A, 5002, LINK_GATE));
    const member = await prisma.member.findUniqueOrThrow({ where: { telegramUserId: 5002n } });
    let membership = await prisma.membership.findFirstOrThrow({ where: { memberId: member.id, channelId: channelAId } });
    expect(membership.status).toBe("PENDING_GATE");
    expect(membership.inviteLinkId).toBe(linkGateId);
    expect(membership.approveAt).toBeNull();

    // Lien GATE créé via createChatInviteLink (simulé) et mémorisé ; boutons d'accueil : « Rejoindre » + « J'ai rejoint ».
    expect(botCalls.find((c) => c.method === "createChatInviteLink")?.payload.chat_id).toBe(Number(CHAT_B));
    const gateLink = await prisma.inviteLink.findFirst({ where: { kind: "GATE", channelId: channelBId, sourceChannelId: channelAId } });
    expect(gateLink).not.toBeNull();
    const welcome = await prisma.outboundMessage.findFirstOrThrow({ where: { memberId: member.id, kind: "WELCOME" } });
    const buttons = welcome.buttons as Array<Array<{ text: string; url: string }>>;
    expect(buttons[0]?.[0]?.url).toBe(gateLink!.telegramInviteLink);
    expect(buttons[1]?.[0]?.url).toBe(`https://t.me/bot_test?start=g${membership.code}`);

    // Rien à approuver tant que le canal requis n'est pas rejoint.
    expect(await processApprovals(fakeJob({ type: "tick" as const }))).toEqual({ claimed: 0, approved: 0 });

    // Le membre clique « J'ai rejoint » : le bot vérifie (getChatMember simulé → member) et planifie.
    await bot.handleUpdate(startCommand(5002, `g${membership.code}`, 700));
    expect(botCalls.find((c) => c.method === "getChatMember")?.payload).toEqual({ chat_id: Number(CHAT_B), user_id: 5002 });
    const reply = botCalls.filter((c) => c.method === "sendMessage").at(-1);
    expect(reply?.payload.chat_id).toBe(5002);
    membership = await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(membership.status).toBe("SCHEDULED");
    expect(membership.gateSatisfiedAt).toBeInstanceOf(Date);

    expect(await processApprovals(fakeJob({ type: "tick" as const }))).toEqual({ claimed: 1, approved: 1 });
    membership = await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(membership.status).toBe("APPROVED");
    expect(workerCalls.filter((c) => c.method === "approveChatJoinRequest").at(-1)?.payload).toEqual({ chat_id: Number(CHAT_A), user_id: 5002 });
  });
});

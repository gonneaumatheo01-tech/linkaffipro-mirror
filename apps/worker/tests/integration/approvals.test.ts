import { beforeAll, describe, expect, it } from "vitest";
import { encrypt, validateTelegramHtml } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { createBot, getOrCreateBot, prismaTelegramDeps } from "@linkaffipro/telegram";
import type { Api, Bot } from "grammy";
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

  it("canal désactivé : une demande déjà planifiée n'est ni acceptée ni relancée", async () => {
    await bot.handleUpdate(joinRequest(CHAT_A, 5003, LINK_A));
    const member = await prisma.member.findUniqueOrThrow({ where: { telegramUserId: 5003n } });
    let membership = await prisma.membership.findFirstOrThrow({ where: { memberId: member.id, channelId: channelAId } });
    expect(membership.status).toBe("SCHEDULED");
    const approvalsBefore = workerCalls.filter((c) => c.method === "approveChatJoinRequest").length;

    await prisma.channel.update({ where: { id: channelAId }, data: { isActive: false } });
    try {
      expect(await processApprovals(fakeJob({ type: "tick" as const }))).toEqual({ claimed: 0, approved: 0 });
      membership = await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } });
      expect(membership.status).toBe("SCHEDULED");
      expect(workerCalls.filter((c) => c.method === "approveChatJoinRequest").length).toBe(approvalsBefore);
    } finally {
      await prisma.channel.update({ where: { id: channelAId }, data: { isActive: true } });
    }
    // Canal réactivé : la demande est traitée au balayage suivant.
    expect(await processApprovals(fakeJob({ type: "tick" as const }))).toEqual({ claimed: 1, approved: 1 });
  });
});

/**
 * Bug du 11 octobre : canal « Rencontres » dont les canaux à rejoindre sont gérés chacun par un AUTRE de nos bots.
 * Telegram simulé bot par bot : un bot ne crée un lien et ne lit les membres que là où il est administrateur.
 */
function installGateWorld(api: Api, selfId: number, admins: Map<number, Set<number>>, members: Map<number, Set<number>>): TelegramCall[] {
  const calls: TelegramCall[] = [];
  let nextId = 8000;
  api.config.use(async (_prev, method, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    calls.push({ method, payload: p });
    const chat = Number(p.chat_id);
    const isAdmin = admins.get(chat)?.has(selfId) ?? false;
    if (method === "createChatInviteLink") {
      if (!isAdmin) return { ok: false, error_code: 400, description: "Bad Request: not enough rights to manage chat invite links" } as never;
      return { ok: true, result: { invite_link: `https://t.me/+w${selfId}x${String(chat).slice(-4)}`, creator: { id: selfId, is_bot: true, first_name: "b" }, creates_join_request: false, is_primary: false, is_revoked: false } } as never;
    }
    if (method === "getChatMember") {
      if (!isAdmin) return { ok: false, error_code: 403, description: "Forbidden: bot is not a member of the channel chat" } as never;
      const user = Number(p.user_id);
      return { ok: true, result: { status: members.get(chat)?.has(user) ? "member" : "left", user: { id: user, is_bot: false, first_name: "x" } } } as never;
    }
    if (/^send(Message|Photo|Video|Animation|Document)$/.test(method)) return { ok: true, result: { message_id: nextId++, date: Math.floor(Date.now() / 1000), chat: { id: chat, type: "private" }, text: p.text ?? "" } } as never;
    return { ok: true, result: true } as never;
  });
  return calls;
}

describe("canaux à rejoindre gérés par d'autres bots : de bout en bout et rappels (base réelle)", () => {
  const ZONE = -1001200000001n;
  const ROULETTE = -1001200000002n;
  const TIR = -1001200000003n;
  const LYON = -1001200000004n;
  const PRIVE = -1001200000005n;
  const admins = new Map<number, Set<number>>([
    [Number(ZONE), new Set([333])],
    [Number(ROULETTE), new Set([111])],
    [Number(TIR), new Set([222])],
    [Number(LYON), new Set([333])],
    [Number(PRIVE), new Set<number>()],
  ]);
  const members = new Map<number, Set<number>>([...admins.keys()].map((k) => [k, new Set<number>()]));
  const ids = { zone: "", roulette: "", tir: "", lyon: "", prive: "" };
  const bots: Record<"dating" | "casino" | "sports", { id: string; tokenEncrypted: string; username: string }> = {} as never;
  let datingBot: Bot;
  let workerDating: TelegramCall[] = [];

  async function makeBot(n: number, vertical: "CASINO" | "SPORTS" | "DATING") {
    return prisma.bot.create({ data: { name: `Bot ${n}`, username: `bot_${n}`, telegramBotId: BigInt(n), tokenEncrypted: encrypt(`${n}:TEST-TOKEN-${"x".repeat(30)}`), vertical, webhookSecret: `secret-${n}` } });
  }
  async function makeChannel(chatId: bigint, title: string, botId: string, adminBots: string[]) {
    const c = await prisma.channel.create({ data: { telegramChatId: chatId, title, type: "CHANNEL", language: "fr", primaryBotId: botId, isTest: true } });
    for (const b of adminBots) await prisma.channelBotAdmin.create({ data: { channelId: c.id, botId: b, rights: { status: "administrator", can_invite_users: true } } });
    return c.id;
  }
  function join(chatId: bigint, userId: number, title: string): Update {
    return { update_id: userId, chat_join_request: { chat: { id: Number(chatId), type: "channel", title }, from: { id: userId, is_bot: false, first_name: `U${userId}`, language_code: "fr" }, user_chat_id: userId, date: Math.floor(Date.now() / 1000) - 5 } } as Update;
  }

  beforeAll(async () => {
    await resetDb();
    const dating = await makeBot(333, "DATING");
    const casino = await makeBot(111, "CASINO");
    const sports = await makeBot(222, "SPORTS");
    Object.assign(bots, { dating, casino, sports });
    ids.zone = await makeChannel(ZONE, "Zone Interdite 🔞", dating.id, [dating.id]);
    ids.roulette = await makeChannel(ROULETTE, "LA ZONE ROULETTE 🎰", casino.id, [casino.id]);
    ids.tir = await makeChannel(TIR, "🎯 TIR CADRÉ ⚡", sports.id, [sports.id]);
    ids.lyon = await makeChannel(LYON, "Rencontres Lyon", dating.id, [dating.id]);
    ids.prive = await makeChannel(PRIVE, "Canal privé", casino.id, []);
    await prisma.approvalRule.create({ data: { channelId: ids.zone, name: "Règle par défaut", isDefault: true, mode: "DELAY", delaySeconds: 0, gateMode: "REQUIRED", gateChannelIds: [ids.roulette, ids.tir], reminderAfterMinutes: [], maxReminders: 0 } });
    await prisma.approvalRule.create({ data: { channelId: ids.lyon, name: "Règle par défaut", isDefault: true, mode: "DELAY", delaySeconds: 0, gateMode: "REQUIRED", gateChannelIds: [ids.prive], reminderAfterMinutes: [0], maxReminders: 1 } });
    // Webhook du bot rencontres (même code que le site), API des autres bots côté site, puis API du worker.
    datingBot = createBot(dating, prismaTelegramDeps);
    installGateWorld(datingBot.api, 333, admins, members);
    installGateWorld(getOrCreateBot(casino, prismaTelegramDeps).api, 111, admins, members);
    installGateWorld(getOrCreateBot(sports, prismaTelegramDeps).api, 222, admins, members);
    workerDating = installGateWorld(apiForBot(dating), 333, admins, members);
    installGateWorld(apiForBot(casino), 111, admins, members);
    installGateWorld(apiForBot(sports), 222, admins, members);
  });

  it("demande → accueil avec les 2 canaux et « J'ai rejoint » → /start g<code> → acceptée par le worker", async () => {
    await datingBot.handleUpdate(join(ZONE, 6001, "Zone Interdite 🔞"));
    const member = await prisma.member.findUniqueOrThrow({ where: { telegramUserId: 6001n } });
    let m = await prisma.membership.findFirstOrThrow({ where: { memberId: member.id, channelId: ids.zone } });
    expect(m.status).toBe("PENDING_GATE");
    const welcome = await prisma.outboundMessage.findFirstOrThrow({ where: { memberId: member.id, kind: "WELCOME" } });
    const buttons = welcome.buttons as Array<Array<{ text: string; url: string }>>;
    expect(buttons.map((r) => r[0]!.text)).toEqual(["Rejoindre LA ZONE ROULETTE 🎰", "Rejoindre 🎯 TIR CADRÉ ⚡", "✅ J'ai rejoint"]);
    const links = await prisma.inviteLink.findMany({ where: { kind: "GATE", sourceChannelId: ids.zone }, orderBy: { createdAt: "asc" } });
    expect(links.map((l) => l.botId)).toEqual([bots.casino.id, bots.sports.id]);

    // Pas encore rejoints : rien à accepter.
    expect(await processApprovals(fakeJob({ type: "tick" as const }))).toEqual({ claimed: 0, approved: 0 });
    members.get(Number(ROULETTE))!.add(6001);
    members.get(Number(TIR))!.add(6001);
    await datingBot.handleUpdate(startCommand(6001, `g${m.code}`, 6100));
    m = await prisma.membership.findUniqueOrThrow({ where: { id: m.id } });
    expect(m.status).toBe("SCHEDULED");

    expect(await processApprovals(fakeJob({ type: "tick" as const }))).toEqual({ claimed: 1, approved: 1 });
    m = await prisma.membership.findUniqueOrThrow({ where: { id: m.id } });
    expect(m.status).toBe("APPROVED");
    expect(workerDating.filter((c) => c.method === "approveChatJoinRequest").at(-1)?.payload).toEqual({ chat_id: Number(ZONE), user_id: 6001 });
  });

  it("rappel : les liens sont recalculés (droits corrigés depuis l'accueil), jamais la liste vide de l'accueil", async () => {
    await datingBot.handleUpdate(join(LYON, 6002, "Rencontres Lyon"));
    const member = await prisma.member.findUniqueOrThrow({ where: { telegramUserId: 6002n } });
    let m = await prisma.membership.findFirstOrThrow({ where: { memberId: member.id, channelId: ids.lyon } });
    const welcome = await prisma.outboundMessage.findFirstOrThrow({ where: { memberId: member.id, kind: "WELCOME" } });
    expect(welcome.buttons).toEqual([[{ text: "✅ J'ai rejoint", url: `https://t.me/bot_333?start=g${m.code}` }]]);
    expect((m.source as { gates: unknown[] }).gates).toEqual([]);
    expect((m.source as { gateLinksMissing: unknown[] }).gateLinksMissing).toHaveLength(1);

    // Le client ajoute le bot casino au canal privé ; le membre peut recevoir les messages du bot.
    admins.get(Number(PRIVE))!.add(111);
    await prisma.channelBotAdmin.create({ data: { channelId: ids.prive, botId: bots.casino.id, rights: { status: "administrator", can_invite_users: true } } });
    await prisma.memberBotState.create({ data: { memberId: member.id, botId: bots.dating.id, canDm: true, startedAt: new Date() } });

    expect(await processApprovals(fakeJob({ type: "reminders" as const }))).toEqual({ sent: 1 });
    const reminder = await prisma.outboundMessage.findFirstOrThrow({ where: { memberId: member.id, kind: "GATE_REMINDER" } });
    const buttons = reminder.buttons as Array<Array<{ text: string; url: string }>>;
    expect(buttons.map((r) => r[0]!.text)).toEqual(["Rejoindre Canal privé", "✅ J'ai rejoint"]);
    expect(reminder.text).toContain("Canal privé");
    const link = await prisma.inviteLink.findFirstOrThrow({ where: { kind: "GATE", sourceChannelId: ids.lyon, channelId: ids.prive } });
    expect(link.botId).toBe(bots.casino.id);
    expect(buttons[0]![0]!.url).toBe(link.telegramInviteLink);
    m = await prisma.membership.findUniqueOrThrow({ where: { id: m.id } });
    expect((m.source as { gateLinksMissing: unknown[] }).gateLinksMissing).toEqual([]);
    expect((m.source as { gates: unknown[] }).gates).toHaveLength(1);
  });
  it("prénom « Tom <3 » et canal « Jeux & Paris <VIP> » : rappel et message « accepté » en HTML valide pour Telegram", async () => {
    const JEUX = -1001200000006n;
    admins.set(Number(JEUX), new Set([333]));
    members.set(Number(JEUX), new Set());
    const jeux = await makeChannel(JEUX, "Jeux & Paris <VIP>", bots.dating.id, [bots.dating.id]);
    await prisma.approvalRule.create({ data: { channelId: jeux, name: "Règle par défaut", isDefault: true, mode: "DELAY", delaySeconds: 0, gateMode: "REQUIRED", gateChannelIds: [ids.roulette], reminderAfterMinutes: [0], maxReminders: 1 } });
    const tom = { id: 6003, is_bot: false, first_name: "Tom <3", language_code: "fr" };
    await datingBot.handleUpdate({ update_id: 6003, chat_join_request: { chat: { id: Number(JEUX), type: "channel", title: "Jeux & Paris <VIP>" }, from: tom, user_chat_id: 6003, date: Math.floor(Date.now() / 1000) - 5 } } as Update);
    const member = await prisma.member.findUniqueOrThrow({ where: { telegramUserId: 6003n } });
    let m = await prisma.membership.findFirstOrThrow({ where: { memberId: member.id, channelId: jeux } });
    const welcome = await prisma.outboundMessage.findFirstOrThrow({ where: { memberId: member.id, kind: "WELCOME" } });
    expect(validateTelegramHtml(welcome.text)).toMatchObject({ ok: true });

    // Rappel du worker : avant la correction, « Tom <3 » faisait refuser tout le message par Telegram (aucun bouton).
    await prisma.memberBotState.create({ data: { memberId: member.id, botId: bots.dating.id, canDm: true, startedAt: new Date() } });
    expect(await processApprovals(fakeJob({ type: "reminders" as const }))).toEqual({ sent: 1 });
    const reminder = await prisma.outboundMessage.findFirstOrThrow({ where: { memberId: member.id, kind: "GATE_REMINDER" } });
    expect(reminder.text).toContain("Tom &lt;3");
    expect(reminder.text).toContain("<b>Jeux &amp; Paris &lt;VIP&gt;</b>");
    expect(reminder.text).toContain("LA ZONE ROULETTE 🎰");
    expect(validateTelegramHtml(reminder.text)).toMatchObject({ ok: true });

    // Canal rejoint, « J'ai rejoint », acceptation par le worker : message « accepté » valide aussi.
    members.get(Number(ROULETTE))!.add(6003);
    await datingBot.handleUpdate({ update_id: 6301, message: { message_id: 6301, date: Math.floor(Date.now() / 1000), chat: { id: 6003, type: "private", first_name: "Tom <3" }, from: tom, text: `/start g${m.code}`, entities: [{ type: "bot_command", offset: 0, length: 6 }] } } as Update);
    m = await prisma.membership.findUniqueOrThrow({ where: { id: m.id } });
    expect(m.status).toBe("SCHEDULED");
    expect(await processApprovals(fakeJob({ type: "tick" as const }))).toEqual({ claimed: 1, approved: 1 });
    const accepted = await prisma.outboundMessage.findFirstOrThrow({ where: { memberId: member.id, kind: "ACCEPTED" } });
    expect(accepted.text).toBe("Bienvenue dans <b>Jeux &amp; Paris &lt;VIP&gt;</b>, Tom &lt;3 ! Tu es accepté.");
    expect(validateTelegramHtml(accepted.text)).toMatchObject({ ok: true });
  });

  it("un bot impossible à ouvrir (jeton illisible) ne fait perdre aucune demande et n'arrête pas les rappels", async () => {
    // Bot dont le jeton ne se déchiffre plus (clé changée, enregistrement abîmé), premier administrateur d'un canal à rejoindre.
    const broken = await prisma.bot.create({ data: { name: "Bot cassé", username: "bot_444", telegramBotId: 444n, tokenEncrypted: "jeton-illisible", vertical: "CASINO", webhookSecret: "secret-444" } });
    const LOTO = -1001200000007n;
    const SRC = -1001200000008n;
    admins.set(Number(LOTO), new Set([444, 111]));
    members.set(Number(LOTO), new Set());
    admins.set(Number(SRC), new Set([333]));
    members.set(Number(SRC), new Set());
    const loto = await makeChannel(LOTO, "Loto du soir", bots.casino.id, []);
    await prisma.channelBotAdmin.create({ data: { channelId: loto, botId: broken.id, rights: { status: "administrator", can_invite_users: true }, detectedAt: new Date(Date.now() - 60_000) } });
    await prisma.channelBotAdmin.create({ data: { channelId: loto, botId: bots.casino.id, rights: { status: "administrator", can_invite_users: true } } });
    const src = await makeChannel(SRC, "Source loto", bots.dating.id, [bots.dating.id]);
    const rule = await prisma.approvalRule.create({ data: { channelId: src, name: "Règle par défaut", isDefault: true, mode: "DELAY", delaySeconds: 0, gateMode: "REQUIRED", gateChannelIds: [loto], reminderAfterMinutes: [0], maxReminders: 1 } });

    // Webhook : la demande est enregistrée, le lien créé par le bot casino malgré le bot cassé essayé avant lui.
    await datingBot.handleUpdate(join(SRC, 6004, "Source loto"));
    const member = await prisma.member.findUniqueOrThrow({ where: { telegramUserId: 6004n } });
    const m = await prisma.membership.findFirstOrThrow({ where: { memberId: member.id, channelId: src } });
    expect(m.status).toBe("PENDING_GATE");
    const link = await prisma.inviteLink.findFirstOrThrow({ where: { kind: "GATE", sourceChannelId: src, channelId: loto } });
    expect(link.botId).toBe(bots.casino.id);
    await prisma.memberBotState.create({ data: { memberId: member.id, botId: bots.dating.id, canDm: true, startedAt: new Date() } });

    // Ancienne demande traitée par le bot cassé : son rappel échoue, sans arrêter le passage.
    const old = await prisma.member.create({ data: { telegramUserId: 6005n, firstName: "Ancien" } });
    await prisma.memberBotState.create({ data: { memberId: old.id, botId: broken.id, canDm: true, startedAt: new Date() } });
    await prisma.membership.create({ data: { code: "casse01", memberId: old.id, channelId: src, status: "PENDING_GATE", approvalRuleId: rule.id, requestedAt: new Date(Date.now() - 60_000), source: { gates: [], gateLinksMissing: [], startUrl: "https://t.me/bot_444?start=gcasse01", botId: broken.id } } });

    expect(await processApprovals(fakeJob({ type: "reminders" as const }))).toEqual({ sent: 1 });
    const reminder = await prisma.outboundMessage.findFirstOrThrow({ where: { memberId: member.id, kind: "GATE_REMINDER" } });
    expect((reminder.buttons as Array<Array<{ url: string }>>)[0]![0]!.url).toBe(link.telegramInviteLink);
  });
});

/**
 * Phase 17, étape 3a : réception par le bot assistant de conversation (base réelle, Telegram simulé, file capturée).
 * Webhook → conversation, messages entrants, tour en file (jamais d'appel à l'IA), /stop, /reset (une seule fois par
 * /reset, messages suivants gardés, texte des messages du bot effacé), activation, journal sans texte, liaison d'un
 * compte de l'équipe, réouverture après un blocage ; lien d'offre go.goolink.eu/a/<subId> ; bot assistant jamais
 * choisi pour un canal (et ses rôles repris au passage en assistant) ; suppression d'un membre ; profil Telegram du bot.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encrypt, newSubId } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import {
  createPrismaJoinFlowDeps,
  getOrCreateBot,
  prismaTelegramDeps,
  setAssistantProfile,
  type AssistantProfileApi,
} from "@linkaffipro/telegram";
import { POST } from "@/app/api/telegram/[botId]/route";
import { GET as redirectGET } from "@/app/r/[[...slug]]/route";
import {
  applyAssistantHandover,
  loadAssistantHandover,
} from "@/app/(admin)/settings/bots/assistant-handover";
import { actingStandardBotFor } from "@/lib/channels/acting-bot";
import {
  capturedJobs,
  createTestBot,
  ctx,
  flushAfter,
  installFakeTelegram,
  resetDb,
  webhookRequest,
  type TelegramCall,
} from "./helpers";

const session = vi.hoisted(() => ({
  user: {
    id: "",
    email: "admin@test",
    name: "Admin",
    role: "ADMIN" as const,
    telegramUserId: null,
  },
}));
vi.mock("@/lib/session", () => ({
  ForbiddenError: class extends Error {},
  requireUser: async () => session.user,
  requireAdmin: async () => session.user,
  requireAdminPage: async () => session.user,
}));
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  revalidatePath: () => undefined,
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url, digest: "NEXT_REDIRECT" });
  },
}));

const SECRET = "secret-assistant";
const ASSISTANT_SETTING = "assistant.venice";
const HUMAN_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";

let botId = "";
let personaId = "";
let calls: TelegramCall[] = [];
let updateId = 1000;

async function setActivation(activation: "off" | "team" | "all"): Promise<void> {
  await prisma.setting.upsert({
    where: { key: ASSISTANT_SETTING },
    create: { key: ASSISTANT_SETTING, value: { activation } },
    update: { value: { activation } },
  });
}

function privateMessage(userId: number, text: string, messageId: number, firstName = "Jean") {
  const command = text.startsWith("/") ? text.split(" ")[0]! : null;
  return {
    update_id: updateId++,
    message: {
      message_id: messageId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: userId, type: "private", first_name: firstName },
      from: { id: userId, is_bot: false, first_name: firstName, language_code: "fr" },
      text,
      ...(command
        ? { entities: [{ type: "bot_command", offset: 0, length: command.length }] }
        : {}),
    },
  };
}

async function send(update: unknown): Promise<void> {
  const res = await POST(webhookRequest(update, SECRET), ctx({ botId }));
  expect(res.status).toBe(200);
  await flushAfter();
}

async function conversationOf(telegramUserId: number) {
  return prisma.conversation.findFirst({
    where: { botId, member: { telegramUserId: BigInt(telegramUserId) } },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
}

const chatJobs = () => capturedJobs("chat");
const sentTexts = () =>
  calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));

beforeAll(async () => {
  await resetDb();
  await prisma.setting.deleteMany({
    where: { key: { in: [ASSISTANT_SETTING, "admin.telegramUserId"] } },
  });
  const persona = await prisma.persona.create({
    data: { name: "Léa", gender: "F", languages: ["fr", "en"], isActive: true },
  });
  personaId = persona.id;
  const bot = await prisma.bot.create({
    data: {
      name: "Léa",
      username: "lea_assistant_bot",
      telegramBotId: 777n,
      tokenEncrypted: encrypt(`777:TEST-TOKEN-${"x".repeat(30)}`),
      vertical: "DATING",
      webhookSecret: SECRET,
      mode: "ASSISTANT",
      personaId,
    },
  });
  botId = bot.id;
  // La route réutilise l'instance mise en cache (même jeton, même mode, même persona) : API interceptée ici.
  calls = installFakeTelegram(getOrCreateBot(bot, prismaTelegramDeps).api);
  await setActivation("all");
});

afterAll(async () => {
  await prisma.setting.deleteMany({
    where: {
      key: { in: [ASSISTANT_SETTING, "admin.telegramUserId", `assistant.botProfile.${botId}`] },
    },
  });
});

describe("réception par le bot assistant", () => {
  it("/start tk01 : conversation (source, persona), message entrant /start, tour en file, aucune réponse", async () => {
    await send(privateMessage(4001, "/start tk01", 1));
    const conv = await conversationOf(4001);
    expect(conv).toMatchObject({ source: "tk01", personaId, status: "BOT", stage: "WELCOME" });
    expect(conv!.messages).toHaveLength(1);
    expect(conv!.messages[0]).toMatchObject({
      direction: "IN",
      author: "MEMBER",
      text: "/start",
      meta: { command: "start", source: "tk01" },
    });
    expect(conv!.memberMessages).toBe(0);
    expect(chatJobs()).toEqual([
      expect.objectContaining({ data: { type: "turn", conversationId: conv!.id } }),
    ]);
    expect(chatJobs()[0]!.opts).toMatchObject({ deduplication: { id: `turn-${conv!.id}` } });
    // Le bot ne répond rien lui-même : c'est le worker qui écrira (jamais d'appel à l'IA dans le webhook).
    expect(sentTexts()).toEqual([]);
    const member = await prisma.member.findUniqueOrThrow({
      where: { telegramUserId: 4001n },
      include: { botStates: true },
    });
    expect(member.botStates[0]).toMatchObject({ botId, canDm: true });
  });

  it("message texte : enregistré, compté comme un échange, tour en file ; une seconde source n'écrase rien", async () => {
    await send(privateMessage(4001, "salut, tu fais quoi ?", 2));
    await send(privateMessage(4001, "/start tk02", 3));
    const conv = await conversationOf(4001);
    expect(conv!.source).toBe("tk01");
    expect(conv!.messages.map((m) => m.text)).toEqual([
      "/start",
      "salut, tu fais quoi ?",
      "/start",
    ]);
    expect(conv!.memberMessages).toBe(1);
    expect(conv!.lastInboundAt).not.toBeNull();
    expect(chatJobs()).toHaveLength(3);
  });

  it("update renvoyée deux fois par Telegram : un seul message, une seule tâche", async () => {
    const update = privateMessage(4001, "encore là ?", 4);
    await send(update);
    await send(update);
    const conv = await conversationOf(4001);
    expect(conv!.messages.filter((m) => m.text === "encore là ?")).toHaveLength(1);
    expect(conv!.memberMessages).toBe(2);
    expect(chatJobs()).toHaveLength(4);
  });

  it("journal : aucune trace du texte dans la table Event (longueur seulement)", async () => {
    const events = await prisma.event.findMany({
      where: { botId, type: "telegram.message" },
      orderBy: { occurredAt: "asc" },
    });
    expect(events.length).toBeGreaterThanOrEqual(4);
    const all = JSON.stringify(events.map((e) => e.payload));
    expect(all).not.toContain("salut, tu fais quoi");
    expect(all).not.toContain("encore là");
    expect(all).not.toContain('"text"');
    expect(all).toContain('"textLength":21');
  });

  it("/stop : définitif (CLOSED), réponse fixe, plus aucune tâche ensuite", async () => {
    const before = chatJobs().length;
    await send(privateMessage(4001, "/stop", 5));
    const conv = await conversationOf(4001);
    expect(conv).toMatchObject({ status: "CLOSED", closedReason: "STOP", stage: "CLOSED" });
    expect(conv!.stoppedAt).not.toBeNull();
    expect(conv!.nextFollowUpAt).toBeNull();
    expect(sentTexts()).toEqual(["C'est noté, je ne t'écrirai plus. Bonne continuation !"]);
    expect(conv!.messages.at(-1)).toMatchObject({
      direction: "OUT",
      author: "SYSTEM",
      meta: { fixed: "stopDone" },
    });
    const types = await prisma.conversationEvent.findMany({
      where: { conversationId: conv!.id },
      select: { type: true },
    });
    expect(types.map((t) => t.type)).toEqual(expect.arrayContaining(["stopped", "stage_changed"]));
    const journal = await prisma.event.findFirst({
      where: { type: "conversation.stopped", botId },
    });
    expect(journal?.payload).toEqual({ conversationId: conv!.id });

    await send(privateMessage(4001, "finalement je veux bien", 6));
    await send(privateMessage(4001, "/start", 7));
    await send(privateMessage(4001, "/start", 8));
    expect(chatJobs()).toHaveLength(before);
    // Une seule fois par jour : « tu m'as demandé de ne plus t'écrire ».
    expect(sentTexts()).toEqual([
      "C'est noté, je ne t'écrirai plus. Bonne continuation !",
      "Tu m'as demandé de ne plus t'écrire, je respecte ton choix. Bonne continuation !",
    ]);
    const after = await conversationOf(4001);
    expect(after!.status).toBe("CLOSED");
    expect(after!.messages.map((m) => m.text)).toContain("finalement je veux bien");
  });

  it("/reset : messages, résumé, faits et style effacés, parcours remis à l'accueil, liens envoyés gardés", async () => {
    await send(privateMessage(4002, "/start", 1, "Nina"));
    await send(privateMessage(4002, "coucou", 2, "Nina"));
    const conv = (await conversationOf(4002))!;
    await prisma.conversation.update({
      where: { id: conv.id },
      data: {
        stage: "CHAT",
        summary: "Nina aime le cinéma",
        facts: ["aime le cinéma"],
        styleProfile: { tone: "chatty" },
        assistantTurns: 2,
        offerSends: 1,
        followUpCount: 1,
        nextFollowUpAt: new Date(Date.now() + 3_600_000),
      },
    });
    const jobs = chatJobs().length;
    await send(privateMessage(4002, "/reset", 3, "Nina"));
    const after = (await conversationOf(4002))!;
    expect(after).toMatchObject({
      stage: "WELCOME",
      status: "BOT",
      summary: null,
      facts: [],
      styleProfile: {},
      memberMessages: 0,
      assistantTurns: 0,
      followUpCount: 0,
      nextFollowUpAt: null,
      offerSends: 1,
      source: null,
    });
    // Seule la réponse fixe reste (aucun message de la personne).
    expect(after.messages.map((m) => [m.direction, m.text])).toEqual([
      ["OUT", "C'est fait, j'ai tout oublié. On recommence ? 😊"],
    ]);
    expect(chatJobs()).toHaveLength(jobs);
    const reset = await prisma.conversationEvent.findFirst({
      where: { conversationId: conv.id, type: "reset" },
    });
    expect(reset).toMatchObject({ fromStage: "CHAT", toStage: "WELCOME" });
    expect(await prisma.event.count({ where: { type: "conversation.reset", botId } })).toBe(1);
  });

  it("activation « Désactivé » : message gardé, aucune tâche, aucune réponse", async () => {
    await setActivation("off");
    const jobs = chatJobs().length;
    const sent = sentTexts().length;
    await send(privateMessage(4003, "/start pub7", 1, "Omar"));
    await send(privateMessage(4003, "bonjour", 2, "Omar"));
    await send(privateMessage(4003, "/stop", 3, "Omar"));
    const conv = (await conversationOf(4003))!;
    expect(conv.messages.map((m) => m.text)).toEqual(["/start", "bonjour"]);
    expect(conv.status).toBe("CLOSED");
    expect(chatJobs()).toHaveLength(jobs);
    expect(sentTexts()).toHaveLength(sent);
  });

  it("activation « Seulement l'équipe » : seulement le compte Telegram de l'admin", async () => {
    await setActivation("team");
    const jobs = chatJobs().length;
    await send(privateMessage(4004, "hello", 1, "Paul"));
    expect(chatJobs()).toHaveLength(jobs);
    await prisma.setting.upsert({
      where: { key: "admin.telegramUserId" },
      create: { key: "admin.telegramUserId", value: "4004" },
      update: { value: "4004" },
    });
    await send(privateMessage(4004, "c'est moi l'équipe", 2, "Paul"));
    expect(chatJobs()).toHaveLength(jobs + 1);
    await setActivation("all");
  });
});

describe("/reset, journal du /start, liaison d'un compte, réouverture", () => {
  it("/reset renvoyé par Telegram : effacé et répondu une seule fois, le message suivant reste", async () => {
    await send(privateMessage(4010, "/start", 1, "Léo"));
    await send(privateMessage(4010, "coucou", 2, "Léo"));
    const reset = privateMessage(4010, "/reset", 3, "Léo");
    const before = sentTexts().length;
    await send(reset);
    await send(privateMessage(4010, "salut", 4, "Léo"));
    await send(reset);
    expect(sentTexts().slice(before)).toEqual(["C'est fait, j'ai tout oublié. On recommence ? 😊"]);
    const conv = (await conversationOf(4010))!;
    expect(conv.messages.map((m) => [m.direction, m.text])).toEqual([
      ["OUT", "C'est fait, j'ai tout oublié. On recommence ? 😊"],
      ["IN", "salut"],
    ]);
    expect(conv.memberMessages).toBe(1);
    const resets = await prisma.conversationEvent.findMany({
      where: { conversationId: conv.id, type: "reset" },
    });
    expect(resets).toHaveLength(1);
    expect(resets[0]!.payload).toMatchObject({ telegramMessageId: 3, deletedMessages: 2 });
  });

  it("/reset : messages envoyés par la personne après le /reset gardés, texte des messages du bot effacé", async () => {
    await send(privateMessage(4011, "/start", 1, "Julie"));
    const conv = (await conversationOf(4011))!;
    // Réponse de l'assistant déjà partie (avec son message d'envoi) et message de l'équipe encore en file.
    const sentOm = await prisma.outboundMessage.create({
      data: {
        botId,
        memberId: conv.memberId,
        kind: "ASSISTANT",
        text: "Super Julie, Lyon c'est top !",
        buttons: [[{ text: "Voir", url: "https://go.goolink.eu/a/x" }]],
        status: "SENT",
        sentAt: new Date(),
      },
    });
    await prisma.conversationMessage.create({
      data: {
        conversationId: conv.id,
        direction: "OUT",
        author: "ASSISTANT",
        text: "Super Julie, Lyon c'est top !",
        outboundMessageId: sentOm.id,
      },
    });
    const queuedOm = await prisma.outboundMessage.create({
      data: { botId, memberId: conv.memberId, kind: "ASSISTANT", text: "Message de l'équipe" },
    });
    await send(privateMessage(4011, "j'habite à Lyon", 2, "Julie"));
    // « encore moi » (n° 5) est traité avant le /reset (n° 4), qu'elle a pourtant envoyé avant.
    await send(privateMessage(4011, "encore moi", 5, "Julie"));
    await send(privateMessage(4011, "/reset", 4, "Julie"));
    const after = (await conversationOf(4011))!;
    expect(after.messages.filter((m) => m.direction === "IN").map((m) => m.text)).toEqual([
      "encore moi",
    ]);
    expect(after.messages.some((m) => m.text.includes("Lyon"))).toBe(false);
    expect(after.memberMessages).toBe(1);
    expect(
      await prisma.outboundMessage.findUniqueOrThrow({ where: { id: sentOm.id } }),
    ).toMatchObject({ text: "", buttons: [] });
    expect(
      (await prisma.outboundMessage.findUniqueOrThrow({ where: { id: queuedOm.id } })).text,
    ).toBe("Message de l'équipe");
  });

  it("/start suivi d'un texte libre : rien de ce texte dans le journal", async () => {
    await send(privateMessage(4013, "/start je m'appelle Julie, 24 ans, Lyon", 1, "Ana"));
    const conv = (await conversationOf(4013))!;
    expect(conv.source).toBeNull();
    const events = await prisma.event.findMany({
      where: { botId, memberId: conv.memberId },
      select: { type: true, payload: true },
    });
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["member.start"]));
    expect(JSON.stringify(events)).not.toContain("Julie");
    expect(events.find((e) => e.type === "member.start")?.payload).toEqual({ payload: null });
  });

  it("/start admin_<jeton> (Mon compte) : compte de l'équipe lié, aucune conversation", async () => {
    // Les comptes de l'équipe ne sont pas vidés entre deux passages : jeton reposé à chaque fois.
    const user = await prisma.user.upsert({
      where: { email: "manager-assistant@test" },
      create: {
        email: "manager-assistant@test",
        name: "Camille",
        role: "MANAGER",
        passwordHash: "x",
        telegramLinkToken: "tokAssistant42",
      },
      update: { telegramUserId: null, telegramLinkToken: "tokAssistant42", isActive: true },
    });
    const jobs = chatJobs().length;
    await send(privateMessage(4014, "/start admin_tokAssistant42", 1, "Camille"));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).telegramUserId).toBe(
      4014n,
    );
    expect(sentTexts().at(-1)).toBe(
      "Votre compte Telegram est maintenant lié à LinkAffi Pro, Camille.",
    );
    expect(await conversationOf(4014)).toBeNull();
    expect(chatJobs()).toHaveLength(jobs);
    expect(JSON.stringify(await prisma.event.findMany({ where: { botId } }))).not.toContain(
      "tokAssistant42",
    );
  });

  it("conversation fermée parce que le bot était bloqué : elle repart quand la personne réécrit", async () => {
    await send(privateMessage(4015, "/start", 1, "Sam"));
    const conv = (await conversationOf(4015))!;
    await prisma.conversation.update({
      where: { id: conv.id },
      data: {
        status: "CLOSED",
        stage: "CLOSED",
        closedReason: "BLOCKED",
        closedAt: new Date(),
        assistantTurns: 2,
      },
    });
    await prisma.conversationEvent.create({
      data: {
        conversationId: conv.id,
        type: "stage_changed",
        fromStage: "PROPOSAL",
        toStage: "CLOSED",
      },
    });
    const jobs = chatJobs().length;
    await send(privateMessage(4015, "me revoilà", 2, "Sam"));
    const after = (await conversationOf(4015))!;
    expect(after).toMatchObject({
      status: "BOT",
      stage: "PROPOSAL",
      closedReason: null,
      closedAt: null,
    });
    expect(chatJobs()).toHaveLength(jobs + 1);
    expect(
      await prisma.conversationEvent.count({
        where: { conversationId: conv.id, type: "reopened" },
      }),
    ).toBe(1);
    expect(await prisma.event.count({ where: { type: "conversation.reopened", botId } })).toBe(1);

    // Un /stop reste définitif : jamais rouverte ensuite.
    await send(privateMessage(4015, "/stop", 3, "Sam"));
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { closedReason: "BLOCKED" },
    });
    await send(privateMessage(4015, "allo", 4, "Sam"));
    expect((await conversationOf(4015))!.status).toBe("CLOSED");
    expect(chatJobs()).toHaveLength(jobs + 1);
  });
});

describe("lien d'offre go.goolink.eu/a/<subId>", () => {
  let subId = "";
  let trackingLinkId = "";
  let conversationId = "";

  beforeAll(async () => {
    const program = await prisma.affiliateProgram.create({
      data: { name: "Link Affi", externalId: "prog-assistant" },
    });
    const offer = await prisma.affiliateCampaign.create({
      data: {
        programId: program.id,
        externalId: "camp-assistant",
        campaignKey: "47eb8mwc",
        name: "App de rencontres",
        trackingUrlTemplate: "https://linkaffi.me/go/47eb8mwc?sub_id={subid}",
      },
    });
    const link = await prisma.trackingLink.create({
      data: {
        slug: "pLea00001",
        kind: "OFFER",
        destinationTemplate: "https://linkaffi.me/go/47eb8mwc?sub_id={subid}",
        label: "Offre de Léa",
        affiliateCampaignId: offer.id,
        personaId,
      },
    });
    trackingLinkId = link.id;
    const conv = (await conversationOf(4002))!;
    conversationId = conv.id;
    subId = newSubId();
    await prisma.assistantOfferLink.create({
      data: {
        subId,
        conversationId,
        personaId,
        botId,
        memberId: conv.memberId,
        trackingLinkId,
        source: conv.source,
      },
    });
  });

  const open = (id: string, ua = HUMAN_UA) =>
    redirectGET(
      new Request(`https://go.goolink.eu/r/a/${id}`, {
        headers: { "user-agent": ua, "x-forwarded-for": "198.51.100.7" },
      }),
      ctx({ slug: ["a", id] }),
    );

  it("première ouverture : 302 vers l'offre avec le sub-ID, clic enregistré et rattaché à la conversation", async () => {
    const res = await open(subId);
    expect(res.status).toBe(302);
    const location = res.headers.get("location")!;
    expect(location).toBe(`https://linkaffi.me/go/47eb8mwc?sub_id=${subId}`);
    await flushAfter();
    const click = await prisma.click.findUniqueOrThrow({ where: { subId } });
    expect(click).toMatchObject({
      trackingLinkId,
      botId,
      conversationId,
      destination: location,
      isBot: false,
    });
    expect(click.ipHash).toHaveLength(64);
    const aol = await prisma.assistantOfferLink.findUniqueOrThrow({ where: { subId } });
    expect(aol).toMatchObject({ clickId: click.id, opens: 1 });
    expect(aol.firstOpenedAt).not.toBeNull();
    expect(
      await prisma.trackingLink.findUniqueOrThrow({ where: { id: trackingLinkId } }),
    ).toMatchObject({
      clicks: 1,
      uniqueClicks: 1,
    });
    expect(
      await prisma.conversationEvent.count({ where: { conversationId, type: "offer_opened" } }),
    ).toBe(1);
    expect(await prisma.event.count({ where: { type: "click.offer", botId } })).toBe(1);
    expect(await prisma.event.count({ where: { type: "conversation.offer_opened", botId } })).toBe(
      1,
    );
    // Jamais vers les relances automatiques (elles écriraient au membre par un autre bot).
    expect(capturedJobs("automations")).toEqual([]);
  });

  it("ouverture suivante : même adresse, opens + 1, aucun nouveau clic", async () => {
    const res = await open(subId);
    expect(res.headers.get("location")).toBe(`https://linkaffi.me/go/47eb8mwc?sub_id=${subId}`);
    await flushAfter();
    expect(await prisma.click.count({ where: { trackingLinkId } })).toBe(1);
    expect(await prisma.assistantOfferLink.findUniqueOrThrow({ where: { subId } })).toMatchObject({
      opens: 2,
    });
    expect(
      await prisma.trackingLink.findUniqueOrThrow({ where: { id: trackingLinkId } }),
    ).toMatchObject({
      clicks: 2,
      uniqueClicks: 1,
    });
  });

  it("robot connu : redirigé, rien n'est compté ; sub-ID inconnu : page par défaut", async () => {
    const res = await open(subId, "facebookexternalhit/1.1");
    expect(res.status).toBe(302);
    await flushAfter();
    expect(await prisma.assistantOfferLink.findUniqueOrThrow({ where: { subId } })).toMatchObject({
      opens: 2,
    });
    const unknown = await open(newSubId());
    expect(unknown.status).toBe(302);
    expect(unknown.headers.get("location")).toBe("http://localhost:3000");
    await flushAfter();
  });
});

describe("bot assistant jamais choisi pour un canal", () => {
  it("bot principal assistant : le bot normal administrateur agit à sa place", async () => {
    const standard = await createTestBot(888, "DATING", "secret-888");
    const channel = await prisma.channel.create({
      data: {
        telegramChatId: -1007770888n,
        title: "Canal rencontres",
        type: "CHANNEL",
        primaryBotId: botId,
        isTest: true,
      },
    });
    const rights = { status: "administrator", can_invite_users: true };
    await prisma.channelBotAdmin.createMany({
      data: [
        { channelId: channel.id, botId, rights, detectedAt: new Date(Date.now() - 60_000) },
        { channelId: channel.id, botId: standard.id, rights },
      ],
    });
    expect((await actingStandardBotFor(channel.id))?.id).toBe(standard.id);
    expect((await createPrismaJoinFlowDeps().actingBotIdFor(channel.id))?.botId).toBe(standard.id);
  });
});

describe("passage d'un bot en assistant : ses rôles dans les canaux repris", () => {
  it("bot principal remplacé, messages à venir repris, messages déjà publiés intacts", async () => {
    const leaving = await createTestBot(901, "DATING", "secret-901");
    const casino = await createTestBot(902, "CASINO", "secret-902");
    const dating = await createTestBot(903, "DATING", "secret-903");
    const channel = await prisma.channel.create({
      data: {
        telegramChatId: -1007770901n,
        title: "Rencontres du soir",
        type: "CHANNEL",
        vertical: "DATING",
        primaryBotId: leaving.id,
        isTest: true,
      },
    });
    const rights = { status: "administrator", can_post_messages: true };
    await prisma.channelBotAdmin.createMany({
      data: [
        {
          channelId: channel.id,
          botId: leaving.id,
          rights,
          detectedAt: new Date(Date.now() - 90_000),
        },
        {
          channelId: channel.id,
          botId: casino.id,
          rights,
          detectedAt: new Date(Date.now() - 60_000),
        },
        { channelId: channel.id, botId: dating.id, rights },
      ],
    });
    const scheduled = await prisma.post.create({
      data: {
        code: "hand0001",
        channelId: channel.id,
        botId: leaving.id,
        status: "SCHEDULED",
        scheduledAt: new Date(Date.now() + 3_600_000),
      },
    });
    const published = await prisma.post.create({
      data: { code: "hand0002", channelId: channel.id, botId: leaving.id, status: "SENT" },
    });
    const plan = await loadAssistantHandover(leaving.id);
    expect(plan.stuck).toEqual([]);
    expect(await applyAssistantHandover(leaving.id, plan)).toEqual({
      replaced: 1,
      emptied: 0,
      posts: 1,
    });
    // Même univers d'abord.
    expect(
      (await prisma.channel.findUniqueOrThrow({ where: { id: channel.id } })).primaryBotId,
    ).toBe(dating.id);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: scheduled.id } })).botId).toBe(
      dating.id,
    );
    expect((await prisma.post.findUniqueOrThrow({ where: { id: published.id } })).botId).toBe(
      leaving.id,
    );
    expect(
      await prisma.event.findFirst({
        where: { type: "channel.primary_bot_set", channelId: channel.id },
      }),
    ).toMatchObject({
      botId: dating.id,
      payload: { reason: "assistant_mode", previousBotId: leaving.id },
    });
  });

  it("aucun autre bot normal administrateur : le message à venir bloque le changement", async () => {
    const lonely = await createTestBot(904, "DATING", "secret-904");
    const channel = await prisma.channel.create({
      data: {
        telegramChatId: -1007770904n,
        title: "Canal seul",
        type: "CHANNEL",
        primaryBotId: lonely.id,
        isTest: true,
      },
    });
    await prisma.channelBotAdmin.create({
      data: { channelId: channel.id, botId: lonely.id, rights: { status: "administrator" } },
    });
    await prisma.post.create({
      data: { code: "hand0003", channelId: channel.id, botId: lonely.id, status: "SCHEDULED" },
    });
    const plan = await loadAssistantHandover(lonely.id);
    expect(plan.stuck).toEqual([
      expect.objectContaining({ channelId: channel.id, channelTitle: "Canal seul" }),
    ]);
  });
});

describe("profil Telegram du bot", () => {
  it("assistant : description qui dit « l'assistante du canal » et commandes ; bot normal : remis à vide", async () => {
    const profileCalls: Array<{ method: string; args: unknown[] }> = [];
    const api = {
      setMyDescription: async (...args: unknown[]) =>
        void profileCalls.push({ method: "setMyDescription", args }),
      setMyShortDescription: async (...args: unknown[]) =>
        void profileCalls.push({ method: "setMyShortDescription", args }),
      setMyCommands: async (...args: unknown[]) =>
        void profileCalls.push({ method: "setMyCommands", args }),
      deleteMyCommands: async (...args: unknown[]) =>
        void profileCalls.push({ method: "deleteMyCommands", args }),
    } as unknown as AssistantProfileApi;
    const report = await setAssistantProfile(botId, { api });
    expect(report).toMatchObject({ mode: "ASSISTANT", applied: true, languages: ["fr", "en"] });
    const descriptions = profileCalls.filter((c) => c.method === "setMyDescription");
    expect(descriptions).toHaveLength(3);
    expect(String(descriptions[0]!.args[0])).toContain("Léa, l'assistante du canal");
    expect(descriptions[2]!.args[1]).toEqual({ language_code: "en" });
    const commands = profileCalls.find((c) => c.method === "setMyCommands")!.args[0] as Array<{
      command: string;
    }>;
    expect(commands.map((c) => c.command)).toEqual(["start", "stop", "reset"]);
    expect(
      await prisma.setting.findUnique({ where: { key: `assistant.botProfile.${botId}` } }),
    ).not.toBeNull();

    profileCalls.length = 0;
    await prisma.bot.update({ where: { id: botId }, data: { mode: "STANDARD", personaId: null } });
    const cleared = await setAssistantProfile(botId, { api });
    expect(cleared).toEqual({ mode: "STANDARD", cleared: true, languages: ["fr", "en"] });
    expect(
      profileCalls.filter((c) => c.method === "setMyDescription").map((c) => c.args[0]),
    ).toEqual(["", "", ""]);
    expect(
      await prisma.setting.findUnique({ where: { key: `assistant.botProfile.${botId}` } }),
    ).toBeNull();
    // Une seconde fois : rien à retirer (jamais un profil écrit par l'équipe dans @BotFather).
    profileCalls.length = 0;
    expect(await setAssistantProfile(botId, { api })).toEqual({
      mode: "STANDARD",
      cleared: false,
      languages: [],
    });
    expect(profileCalls).toEqual([]);
    await prisma.bot.update({ where: { id: botId }, data: { mode: "ASSISTANT", personaId } });
  });
});

describe("suppression d'un membre", () => {
  it("ses conversations avec l'assistant sont supprimées (messages et événements compris)", async () => {
    const admin = await prisma.user.upsert({
      where: { email: "admin-assistant@test" },
      create: { email: "admin-assistant@test", name: "Admin", role: "ADMIN", passwordHash: "x" },
      update: {},
    });
    session.user.id = admin.id;
    const conv = (await conversationOf(4002))!;
    const om = await prisma.outboundMessage.create({
      data: {
        botId,
        memberId: conv.memberId,
        kind: "ASSISTANT",
        text: "Nina, toi qui aimes le cinéma…",
        status: "SENT",
      },
    });
    const { anonymizeMemberAction } = await import("@/app/(admin)/members/[id]/actions");
    const form = new FormData();
    form.set("memberId", conv.memberId);
    form.set("confirm", "SUPPRIMER");
    await expect(anonymizeMemberAction(form)).rejects.toMatchObject({ digest: "NEXT_REDIRECT" });
    expect(await prisma.conversation.findUnique({ where: { id: conv.id } })).toBeNull();
    expect(await prisma.conversationMessage.count({ where: { conversationId: conv.id } })).toBe(0);
    expect(await prisma.conversationEvent.count({ where: { conversationId: conv.id } })).toBe(0);
    // Le texte des messages envoyés par l'assistant (il reprend ce que la personne a dit) est vidé.
    expect(await prisma.outboundMessage.findUniqueOrThrow({ where: { id: om.id } })).toMatchObject({
      text: "",
      buttons: [],
    });
    // Le lien d'offre envoyé et son clic restent (statistiques), sans conversation.
    const aol = await prisma.assistantOfferLink.findFirst({ where: { memberId: conv.memberId } });
    expect(aol?.conversationId).toBeNull();
    expect(aol?.clickId).not.toBeNull();
  });
});

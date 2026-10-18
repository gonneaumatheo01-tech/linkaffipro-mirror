/**
 * Phase 17 sur base réelle : l'assistant de conversation de bout en bout, SIMULÉ (faux client Venice, fausse API
 * Telegram, aucune attente réelle du rythme). Les messages reçus sont insérés comme le ferait le webhook (message
 * entrant, `lastInboundAt`, compteur, relance remise à zéro) ; le worker fait le reste : tour sous verrou, réclamation,
 * contrôles, réponse, lien d'offre suivi, conversion, relances, arrêts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { encrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import {
  ASSISTANT_SETTING_KEY,
  VeniceError,
  createFakeLlm,
  fixedText,
  type FakeLlmReply,
} from "@linkaffipro/chat";
import { claimInbound } from "../../src/assistant/claim";
import {
  configureChatRuntime,
  resetChatRuntime,
  setChatLlmFactory,
} from "../../src/assistant/runtime";
import { refreshAssistantModels } from "../../src/assistant/settings";
import { runChatSweep } from "../../src/assistant/sweep";
import { getRedis } from "@linkaffipro/queue";
import { detectAlerts } from "../../src/maintenance/alerts";
import { runPurge } from "../../src/maintenance/purge";
import { processChat } from "../../src/processors/chat";
import { apiForBot } from "../../src/sending/api";
import {
  capturedJobs,
  fakeJob,
  installFakeTelegram,
  resetDb,
  TEST_BOT_TOKEN,
  type TelegramCall,
} from "./helpers";

const OFFER_TEMPLATE = "https://linkaffi.me/go/dat12345?sub_id={subid}";

/** Réponses prévues du faux client Venice (une par appel, dans l'ordre). */
const replies: FakeLlmReply[] = [];
const fakeLlm = createFakeLlm(() => {
  const r = replies.shift();
  if (r === undefined) throw new Error("Faux client : aucune réponse prévue pour cet appel.");
  return r;
});

const ids = { bot: "", persona: "", offer: "", campaign: "", channel: "", program: "" };
let calls: TelegramCall[] = [];
let nextTelegramUserId = 880_000;
let nextMessageId = 1;
/** Horloge simulée du worker (null : heure réelle). */
let simulatedNow: Date | null = null;

function sentTexts(chatId: bigint): string[] {
  return calls
    .filter(
      (c) =>
        (c.method === "sendMessage" || c.method === "sendPhoto") &&
        String(c.payload.chat_id) === String(chatId),
    )
    .map((c) => String(c.payload.text ?? c.payload.caption ?? ""));
}

async function saveSettings(over: Record<string, unknown> = {}) {
  const value = {
    apiKeyEncrypted: encrypt("venice-cle-de-test"),
    activation: "all",
    defaultModel: "venice-uncensored-role-play",
    fallbackModel: "venice-uncensored-1-2",
    monthlyCapEur: 30,
    perConversationDailyLimit: 60,
    models: [
      {
        id: "venice-uncensored-role-play",
        name: "Role play",
        inputUsdPerM: 0.5,
        outputUsdPerM: 2,
        maxCompletionTokens: 4096,
        contextLength: 32000,
        supportsResponseSchema: true,
        supportsReasoning: false,
        uncensored: true,
        offline: false,
        deprecated: false,
      },
    ],
    ...over,
  };
  await prisma.setting.upsert({
    where: { key: ASSISTANT_SETTING_KEY },
    create: { key: ASSISTANT_SETTING_KEY, value },
    update: { value },
  });
}

/** Nouvelle personne qui a démarré le bot et sa conversation (comme le webhook au premier /start). */
async function newConversation(source: string | null = "pub1") {
  const tg = BigInt(nextTelegramUserId++);
  const member = await prisma.member.create({
    data: { telegramUserId: tg, firstName: "Tom", languageCode: "fr" },
  });
  await prisma.memberBotState.create({
    data: { memberId: member.id, botId: ids.bot, canDm: true, startedAt: new Date() },
  });
  const conv = await prisma.conversation.create({
    data: { botId: ids.bot, memberId: member.id, personaId: ids.persona, source },
  });
  return { conv, member, tg };
}

/** Message reçu, enregistré comme le ferait le webhook (jamais d'appel à l'IA ici). */
async function receive(conversationId: string, text: string) {
  const at = simulatedNow ?? new Date();
  const isCommand = text.startsWith("/");
  const msg = await prisma.conversationMessage.create({
    data: {
      conversationId,
      direction: "IN",
      author: "MEMBER",
      text,
      telegramMessageId: BigInt(nextMessageId++),
      meta: isCommand ? { command: text.slice(1).split(/\s/)[0] } : {},
    },
  });
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      lastInboundAt: at,
      ...(isCommand ? {} : { memberMessages: { increment: 1 } }),
      followUpCount: 0,
      nextFollowUpAt: null,
    },
  });
  return msg;
}

/**
 * /reset comme le webhook (contrat §4) : messages effacés, mémoire, langue et étape remises à zéro, événement `reset`
 * (il survit, c'est lui que le worker relit).
 */
async function simulateReset(conversationId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
    const conv = await tx.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    await tx.conversationMessage.deleteMany({ where: { conversationId } });
    await tx.conversation.update({
      where: { id: conversationId },
      data: {
        summary: null,
        facts: [],
        styleProfile: {},
        language: null,
        stage: "WELCOME",
        memberMessages: 0,
        assistantTurns: 0,
        followUpCount: 0,
        nextFollowUpAt: null,
        retryAt: null,
      },
    });
    await tx.conversationEvent.create({
      data: { conversationId, type: "reset", fromStage: conv.stage, toStage: "WELCOME" },
    });
  });
}

/** /stop comme le webhook : définitif. */
async function simulateStop(conversationId: string) {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      stoppedAt: new Date(),
      status: "CLOSED",
      stage: "CLOSED",
      closedReason: "STOP",
      closedAt: new Date(),
      nextFollowUpAt: null,
      retryAt: null,
    },
  });
}

const turn = (conversationId: string) =>
  processChat(fakeJob({ type: "turn" as const, conversationId })) as Promise<{
    status: string;
    reason?: string;
    outcome?: string;
    kind?: string;
  }>;

describe("assistant de conversation (base réelle, Venice et Telegram simulés)", () => {
  beforeAll(async () => {
    await resetDb();
    await prisma.campaign.deleteMany({ where: { name: "Campagne assistant (test)" } });
    const program = await prisma.affiliateProgram.create({
      data: { name: "Programme rencontres (test)", vertical: "DATING", source: "CSV" },
    });
    const offer = await prisma.affiliateCampaign.create({
      data: {
        programId: program.id,
        externalId: "dating-offer-1",
        name: "App de rencontres",
        vertical: "DATING",
        trackingUrlTemplate: OFFER_TEMPLATE,
      },
    });
    const channel = await prisma.channel.create({
      data: {
        telegramChatId: -1001700000001n,
        title: "Rencontres Paris",
        type: "CHANNEL",
        language: "fr",
        isTest: true,
      },
    });
    const campaign = await prisma.campaign.create({
      data: {
        name: "Campagne assistant (test)",
        vertical: "DATING",
        channelIds: [channel.id],
        affiliateCampaignIds: [offer.id],
      },
    });
    const persona = await prisma.persona.create({
      data: {
        name: "Léa",
        gender: "F",
        personality: "Pétillante et curieuse",
        tone: "complice",
        languages: ["fr", "en"],
        affiliateCampaignId: offer.id,
        campaignId: campaign.id,
        offerPitch: "Une app de rencontres gratuite à l'inscription, avec des profils vérifiés.",
        offerButtonText: "Découvrir l'app",
        minExchangesBeforeOffer: 4,
        maxOfferSends: 2,
        followUpAfterHours: 24,
        followUpsMax: 2,
        isActive: true,
      },
    });
    const bot = await prisma.bot.create({
      data: {
        name: "Léa",
        username: "lea_assistante_test_bot",
        telegramBotId: 171n,
        tokenEncrypted: encrypt(TEST_BOT_TOKEN),
        vertical: "DATING",
        webhookSecret: "secret-assistant",
        mode: "ASSISTANT",
        personaId: persona.id,
      },
    });
    Object.assign(ids, {
      bot: bot.id,
      persona: persona.id,
      offer: offer.id,
      campaign: campaign.id,
      channel: channel.id,
      program: program.id,
    });
    calls = installFakeTelegram((await apiForBot(bot.id)).api);
    setChatLlmFactory(() => fakeLlm);
    configureChatRuntime({
      sleep: async () => undefined,
      random: () => 0.5,
      now: () => simulatedNow ?? new Date(),
    });
    await saveSettings();
  });

  beforeEach(async () => {
    replies.length = 0;
    simulatedNow = null;
    (globalThis.__jobs ??= []).length = 0;
    await prisma.aiConversationUsage.deleteMany();
    await saveSettings();
  });

  afterAll(async () => {
    resetChatRuntime();
    await prisma.setting.deleteMany({ where: { key: ASSISTANT_SETTING_KEY } });
    await resetDb();
    await prisma.campaign.deleteMany({ where: { id: ids.campaign } });
  });

  it("/start avec source → présentation → 4 échanges → lien suivi → clic → inscription → CONVERTI", async () => {
    const { conv, member, tg } = await newConversation("pub1");

    // 1. /start pub1 → présentation en assistante du canal (jamais de lien au premier message).
    await receive(conv.id, "/start pub1");
    replies.push({
      messages: ["Coucou ! Moi c'est Léa, l'assistante du canal 😉 Tu vas bien ?"],
      stage: "WELCOME",
    });
    const r1 = await turn(conv.id);
    expect(r1).toMatchObject({ status: "done", kind: "reply", outcome: "replied" });
    expect(sentTexts(tg)).toEqual([
      "Coucou ! Moi c'est Léa, l'assistante du canal 😉 Tu vas bien ?",
    ]);
    // Le prompt connaît le canal de la campagne de la persona.
    expect(fakeLlm.requests.at(-1)?.messages[0]?.content).toContain("Rencontres Paris");
    let c = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(c).toMatchObject({ stage: "WELCOME", assistantTurns: 1, offerSends: 0, status: "BOT" });
    expect(c.nextFollowUpAt).toBeNull(); // jamais de relance après la seule présentation
    const om1 = await prisma.outboundMessage.findFirstOrThrow({ where: { memberId: member.id } });
    expect(om1).toMatchObject({ kind: "ASSISTANT", status: "SENT", botId: ids.bot });
    const out1 = await prisma.conversationMessage.findFirstOrThrow({
      where: { conversationId: conv.id, direction: "OUT" },
    });
    expect(out1).toMatchObject({ author: "ASSISTANT", partIndex: 0, outboundMessageId: om1.id });
    expect(out1.telegramMessageId).not.toBeNull();
    expect(out1.meta).toMatchObject({ model: "venice-uncensored-role-play" });
    // Coût de l'appel enregistré.
    expect(
      await prisma.aiConversationUsage.count({
        where: { conversationId: conv.id, purpose: "REPLY" },
      }),
    ).toBe(1);

    // 2. Trois échanges sans lien (texte échappé en HTML à l'envoi).
    const exchanges = ["Salut ça va et toi ?", "Je cherche quelqu'un de sympa", "J'habite à Lyon"];
    for (const text of exchanges) {
      await receive(conv.id, text);
      replies.push({
        messages: ["Contente de te lire <3 & toi ?", "Raconte-moi un peu"],
        stage: "CHAT",
        style_update: { interest: 7 },
      });
      expect(await turn(conv.id)).toMatchObject({ status: "done", outcome: "replied" });
    }
    const escaped = calls.filter(
      (x) =>
        x.method === "sendMessage" &&
        String(x.payload.chat_id) === String(tg) &&
        String(x.payload.text).includes("Contente"),
    );
    expect(escaped[0]?.payload.text).toBe("Contente de te lire &lt;3 &amp; toi ?");
    expect(escaped[0]?.payload.parse_mode).toBe("HTML");
    c = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(c).toMatchObject({ stage: "CHAT", assistantTurns: 4, memberMessages: 3 });
    expect(c.nextFollowUpAt).not.toBeNull();
    // Le texte de la conversation est gardé tel quel (brut) dans la conversation.
    expect(
      await prisma.conversationMessage.count({
        where: {
          conversationId: conv.id,
          direction: "OUT",
          text: "Contente de te lire <3 & toi ?",
        },
      }),
    ).toBe(3);

    // 3. Quatrième échange : le modèle propose le lien, les règles de la persona le permettent → bouton suivi.
    await receive(conv.id, "Ok montre moi ton app");
    replies.push({
      messages: ["Je te montre l'app dont je te parlais 😊"],
      stage: "PROPOSAL",
      send_offer: true,
      style_update: { interest: 8 },
    });
    expect(await turn(conv.id)).toMatchObject({ status: "done", outcome: "replied" });
    const link = await prisma.assistantOfferLink.findFirstOrThrow({
      where: { conversationId: conv.id },
    });
    expect(link).toMatchObject({
      personaId: ids.persona,
      botId: ids.bot,
      memberId: member.id,
      source: "pub1",
    });
    expect(link.subId).toMatch(/^[0-9A-Za-z]{12}$/);
    const tracking = await prisma.trackingLink.findUniqueOrThrow({
      where: { id: link.trackingLinkId },
    });
    expect(tracking).toMatchObject({
      kind: "OFFER",
      personaId: ids.persona,
      affiliateCampaignId: ids.offer,
      campaignId: ids.campaign,
      destinationTemplate: OFFER_TEMPLATE,
      label: "Assistant « Léa »",
    });
    expect(tracking.slug).toMatch(/^[0-9A-Za-z]{10}$/);
    const withButton = calls
      .filter((x) => x.method === "sendMessage" && x.payload.reply_markup)
      .at(-1)!;
    expect(withButton.payload.reply_markup).toEqual({
      inline_keyboard: [
        [{ text: "Découvrir l'app", url: `https://go.goolink.eu/a/${link.subId}` }],
      ],
    });
    c = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(c).toMatchObject({ stage: "LINK_SENT", offerSends: 1 });
    const offerEvents = await prisma.conversationEvent.findMany({
      where: { conversationId: conv.id, type: "offer_sent" },
    });
    expect(offerEvents).toHaveLength(1);
    expect(offerEvents[0]?.payload).toMatchObject({ subId: link.subId, offerSends: 1 });
    const outWithOffer = await prisma.conversationMessage.findFirstOrThrow({
      where: {
        conversationId: conv.id,
        direction: "OUT",
        meta: { path: ["offerSubId"], equals: link.subId },
      },
    });
    expect(outWithOffer.text).toBe("Je te montre l'app dont je te parlais 😊");

    // 4. Un second envoi du lien porte un sub-ID neuf (unique par envoi).
    await receive(conv.id, "Tu peux me le renvoyer ?");
    replies.push({
      messages: ["Bien sûr, le voici"],
      stage: "PROPOSAL",
      send_offer: true,
      style_update: { interest: 9 },
    });
    await turn(conv.id);
    const links = await prisma.assistantOfferLink.findMany({
      where: { conversationId: conv.id },
      orderBy: { sentAt: "asc" },
    });
    expect(links).toHaveLength(2);
    expect(new Set(links.map((l) => l.subId)).size).toBe(2);
    expect(links[1]?.trackingLinkId).toBe(link.trackingLinkId); // même lien OFFER de la persona

    // 5. Clic (première ouverture, faite par le site) puis inscription rattachée par le sub-ID → conversion au balayage.
    const click = await prisma.click.create({
      data: {
        trackingLinkId: link.trackingLinkId,
        subId: link.subId,
        memberId: member.id,
        botId: ids.bot,
        conversationId: conv.id,
      },
    });
    await prisma.assistantOfferLink.update({
      where: { id: link.id },
      data: { clickId: click.id, firstOpenedAt: new Date(), opens: 1 },
    });
    await prisma.player.create({
      data: {
        affiliateCampaignId: ids.offer,
        externalPlayerId: "joueur-assistant-1",
        subId: link.subId,
        subIdSource: "postback",
        clickId: click.id,
        memberId: member.id,
        registeredAt: new Date(),
      },
    });
    const sweep = await processChat(fakeJob({ type: "sweep" as const }));
    expect(sweep).toMatchObject({ converted: 1 });
    c = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(c.stage).toBe("CONVERTED");
    expect(c.convertedAt).not.toBeNull();
    expect(c.nextFollowUpAt).toBeNull();
    // Une seule fois.
    expect(await processChat(fakeJob({ type: "sweep" as const }))).toMatchObject({ converted: 0 });
    expect(
      await prisma.conversationEvent.count({
        where: { conversationId: conv.id, type: "converted" },
      }),
    ).toBe(1);

    // 6. Parcours journalisé, sans aucun texte de conversation dans la table Event.
    const stages = await prisma.conversationEvent.findMany({
      where: { conversationId: conv.id, type: "stage_changed" },
      orderBy: { createdAt: "asc" },
    });
    expect(stages.map((s) => `${s.fromStage}→${s.toStage}`)).toEqual([
      "WELCOME→CHAT",
      "CHAT→LINK_SENT",
      "LINK_SENT→CONVERTED",
    ]);
    const events = await prisma.event.findMany({
      where: { type: { startsWith: "conversation." }, memberId: member.id },
    });
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining([
        "conversation.stage_changed",
        "conversation.offer_sent",
        "conversation.converted",
      ]),
    );
    const journal = JSON.stringify(events.map((e) => e.payload));
    for (const t of [...exchanges, "Contente", "Coucou", "Je te montre", "Ok montre moi"])
      expect(journal).not.toContain(t);
    // Messages traités : jamais repris par le balayage.
    expect(
      await prisma.conversationMessage.count({
        where: { conversationId: conv.id, direction: "IN", turnId: null },
      }),
    ).toBe(0);
  }, 60_000);

  it("deux tours lancés en même temps : une seule réponse (verrou), et une réclamation exclusive des messages", async () => {
    const { conv, tg } = await newConversation();
    await receive(conv.id, "/start");
    replies.push({
      messages: ["Coucou, moi c'est Léa, l'assistante du canal 😊"],
      stage: "WELCOME",
    });
    replies.push({ messages: ["Ne doit jamais partir"], stage: "CHAT" });
    const results = await Promise.all([turn(conv.id), turn(conv.id)]);
    expect(results.map((r) => r.status).sort()).toEqual(["busy", "done"]);
    expect(sentTexts(tg)).toHaveLength(1);
    expect(await prisma.outboundMessage.count({ where: { member: { telegramUserId: tg } } })).toBe(
      1,
    );
    // Le tour refusé repasse 3 s plus tard (même déduplication que les messages reçus).
    expect(capturedJobs("chat").at(-1)).toMatchObject({
      data: { type: "turn", conversationId: conv.id },
      opts: { delay: 3000 },
    });
    // Le tour repris ensuite ne trouve rien à faire.
    expect(await turn(conv.id)).toMatchObject({ status: "nothing" });
    expect(sentTexts(tg)).toHaveLength(1);

    // Même sans verrou (verrou expiré) : la réclamation en base ne donne les messages qu'à un seul tour.
    await receive(conv.id, "Salut");
    const [a, b] = await Promise.all([
      claimInbound(conv.id, "tour-a"),
      claimInbound(conv.id, "tour-b"),
    ]);
    expect([a?.length, b?.length].sort()).toEqual([0, 1]);
  }, 30_000);

  it("/stop : plus aucune réponse ni relance, même si une tâche passe", async () => {
    const { conv, tg } = await newConversation();
    await receive(conv.id, "/start");
    replies.push({
      messages: ["Coucou, moi c'est Léa, l'assistante du canal 😊"],
      stage: "WELCOME",
    });
    await turn(conv.id);
    await receive(conv.id, "Salut");
    replies.push({ messages: ["Tu fais quoi de beau ?"], stage: "CHAT" });
    await turn(conv.id);
    const before = sentTexts(tg).length;
    const callsBefore = fakeLlm.calls;
    // /stop (webhook) : définitif.
    await prisma.conversation.update({
      where: { id: conv.id },
      data: {
        stoppedAt: new Date(),
        status: "CLOSED",
        closedReason: "STOP",
        closedAt: new Date(),
        nextFollowUpAt: null,
      },
    });
    await receive(conv.id, "Re ?");
    expect(await turn(conv.id)).toMatchObject({ status: "skipped", reason: "not_bot_status" });
    // Relance forcée dans le passé : jamais envoyée.
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { nextFollowUpAt: new Date(Date.now() - 60_000) },
    });
    (globalThis.__jobs ??= []).length = 0;
    await runChatSweep();
    expect(capturedJobs("chat").filter((j) => j.data.conversationId === conv.id)).toHaveLength(0);
    expect(await turn(conv.id)).toMatchObject({ status: "follow_up_cancelled" });
    expect(sentTexts(tg)).toHaveLength(before);
    expect(fakeLlm.calls).toBe(callsBefore);
  }, 30_000);

  it("prise de main par l'équipe : l'assistant ne répond plus", async () => {
    const { conv, tg } = await newConversation();
    await receive(conv.id, "/start");
    replies.push({
      messages: ["Coucou, moi c'est Léa, l'assistante du canal 😊"],
      stage: "WELCOME",
    });
    await turn(conv.id);
    const before = sentTexts(tg).length;

    // L'équipe prend la main, puis la personne écrit : l'assistant se tait (messages laissés à l'équipe).
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { status: "HUMAN", takenOverAt: new Date() },
    });
    await receive(conv.id, "Salut");
    const callsBefore = fakeLlm.calls;
    expect(await turn(conv.id)).toMatchObject({ status: "skipped", reason: "not_bot_status" });
    expect(fakeLlm.calls).toBe(callsBefore);
    expect(sentTexts(tg)).toHaveLength(before);
  }, 30_000);

  it("message reçu pendant la préparation : regroupé dans le même tour, réponse refaite une fois", async () => {
    const { conv, tg } = await newConversation();
    await receive(conv.id, "/start");
    replies.push({
      messages: ["Coucou, moi c'est Léa, l'assistante du canal 😊"],
      stage: "WELCOME",
    });
    await turn(conv.id);
    await receive(conv.id, "Salut");
    let inserted = false;
    setChatLlmFactory(() => ({
      async complete(req) {
        if (!inserted) {
          inserted = true;
          await receive(conv.id, "Tu es d'où ?");
        }
        return fakeLlm.complete(req);
      },
    }));
    replies.push({ messages: ["Première version, jamais envoyée"], stage: "CHAT" });
    replies.push({
      messages: ["Je suis l'assistante du canal, et toi tu es d'où ?"],
      stage: "CHAT",
    });
    const callsBefore = fakeLlm.calls;
    try {
      expect(await turn(conv.id)).toMatchObject({ status: "done", outcome: "replied" });
    } finally {
      setChatLlmFactory(() => fakeLlm);
    }
    expect(fakeLlm.calls - callsBefore).toBe(2);
    const lastReq = fakeLlm.requests.at(-1)!;
    expect(lastReq.messages.at(-1)).toEqual({ role: "user", content: "Salut\nTu es d'où ?" });
    expect(sentTexts(tg).at(-1)).toBe("Je suis l'assistante du canal, et toi tu es d'où ?");
    expect(sentTexts(tg)).not.toContain("Première version, jamais envoyée");
    const ins = await prisma.conversationMessage.findMany({
      where: { conversationId: conv.id, direction: "IN", text: { in: ["Salut", "Tu es d'où ?"] } },
    });
    expect(new Set(ins.map((m) => m.turnId)).size).toBe(1);
    expect(ins[0]?.turnId).not.toBeNull();
  }, 30_000);

  it("reprise par l'équipe PENDANT la préparation : relecture avant l'envoi, rien ne part", async () => {
    const { conv, tg } = await newConversation();
    await receive(conv.id, "/start");
    replies.push({
      messages: ["Coucou, moi c'est Léa, l'assistante du canal 😊"],
      stage: "WELCOME",
    });
    await turn(conv.id);
    const before = sentTexts(tg).length;
    await receive(conv.id, "Salut");
    // Le faux client « répond » pendant que l'équipe prend la main.
    setChatLlmFactory(() => ({
      async complete(req) {
        await prisma.conversation.update({
          where: { id: conv.id },
          data: { status: "HUMAN", takenOverAt: new Date() },
        });
        return fakeLlm.complete(req);
      },
    }));
    replies.push({ messages: ["Ne doit jamais partir"], stage: "CHAT" });
    try {
      expect(await turn(conv.id)).toMatchObject({ status: "done", outcome: "aborted" });
    } finally {
      setChatLlmFactory(() => fakeLlm);
    }
    expect(sentTexts(tg)).toHaveLength(before);
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } })).toMatchObject({
      status: "HUMAN",
    });
  }, 30_000);

  it("plafond du mois atteint : aucun appel à l'IA, aucun message, un seul événement par jour", async () => {
    const { conv, tg } = await newConversation();
    await prisma.aiConversationUsage.create({
      data: { purpose: "REPLY", model: "venice-uncensored-role-play", costEur: 30, ok: true },
    });
    const callsBefore = fakeLlm.calls;
    await receive(conv.id, "/start");
    expect(await turn(conv.id)).toMatchObject({ status: "skipped", reason: "cap_reached" });
    await receive(conv.id, "Allo ?");
    expect(await turn(conv.id)).toMatchObject({ status: "skipped", reason: "cap_reached" });
    expect(fakeLlm.calls).toBe(callsBefore);
    expect(sentTexts(tg)).toHaveLength(0);
    expect(
      await prisma.conversationEvent.count({
        where: { conversationId: conv.id, type: "cap_reached" },
      }),
    ).toBe(1);
    // Alerte « plafond atteint » pour l'admin.
    const detected = await detectAlerts();
    expect(detected.map((d) => d.kind)).toContain("assistant_cap_reached");
  }, 30_000);

  it("assistant désactivé : aucune réponse, messages rendus (le balayage ne les reprend pas)", async () => {
    await saveSettings({ activation: "off" });
    const { conv, tg } = await newConversation();
    await receive(conv.id, "/start");
    expect(await turn(conv.id)).toMatchObject({ status: "skipped", reason: "not_enabled" });
    expect(
      await prisma.conversationMessage.count({
        where: { conversationId: conv.id, direction: "IN", turnId: null },
      }),
    ).toBe(1);
    (globalThis.__jobs ??= []).length = 0;
    await runChatSweep(new Date(Date.now() + 5 * 60_000));
    expect(capturedJobs("chat").filter((j) => j.data.conversationId === conv.id)).toHaveLength(0);
    expect(sentTexts(tg)).toHaveLength(0);
  }, 30_000);

  it("relances : au plus 2, à 24 h d'écart au moins, jamais pendant les heures calmes", async () => {
    const T0 = new Date("2026-10-20T10:00:00Z"); // 12 h à Paris
    simulatedNow = T0;
    const { conv, tg } = await newConversation();
    await receive(conv.id, "/start");
    replies.push({
      messages: ["Coucou, moi c'est Léa, l'assistante du canal 😊"],
      stage: "WELCOME",
    });
    await turn(conv.id);
    await receive(conv.id, "Salut");
    replies.push({ messages: ["Tu fais quoi ce week-end ?"], stage: "CHAT" });
    await turn(conv.id);
    let c = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(c.nextFollowUpAt?.toISOString()).toBe("2026-10-21T10:00:00.000Z");

    // Pas encore due : rien.
    simulatedNow = new Date("2026-10-21T09:00:00Z");
    (globalThis.__jobs ??= []).length = 0;
    await runChatSweep(simulatedNow);
    expect(capturedJobs("chat").filter((j) => j.data.conversationId === conv.id)).toHaveLength(0);

    // Relance n°1.
    simulatedNow = new Date("2026-10-21T10:01:00Z");
    await runChatSweep(simulatedNow);
    expect(capturedJobs("chat").map((j) => j.data.conversationId)).toContain(conv.id);
    replies.push({ messages: ["Tu es toujours là ? 😊"], stage: "FOLLOW_UP" });
    expect(await turn(conv.id)).toMatchObject({
      status: "done",
      kind: "follow_up",
      outcome: "replied",
    });
    c = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(c).toMatchObject({ followUpCount: 1, stage: "FOLLOW_UP" });
    expect(c.nextFollowUpAt?.toISOString()).toBe("2026-10-22T10:01:00.000Z");
    const followUpMsg = await prisma.conversationMessage.findFirstOrThrow({
      where: { conversationId: conv.id, direction: "OUT", text: "Tu es toujours là ? 😊" },
    });
    expect(followUpMsg.meta).toMatchObject({ followUp: true });
    expect(
      await prisma.aiConversationUsage.count({
        where: { conversationId: conv.id, purpose: "FOLLOW_UP" },
      }),
    ).toBe(1);

    // Relance n°2 avancée par erreur à moins de 24 h de la n°1 : reportée, rien ne part.
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { nextFollowUpAt: new Date("2026-10-21T12:00:00Z") },
    });
    simulatedNow = new Date("2026-10-21T13:00:00Z");
    expect(await turn(conv.id)).toMatchObject({
      status: "follow_up_rescheduled",
      reason: "too_soon",
    });
    c = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(c.nextFollowUpAt?.toISOString()).toBe("2026-10-22T10:01:00.000Z");

    // Due en pleine nuit (heure de Paris) : reportée à 10 h.
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { nextFollowUpAt: new Date("2026-10-22T21:00:00Z") },
    });
    simulatedNow = new Date("2026-10-22T21:30:00Z"); // 23 h 30 à Paris
    expect(await turn(conv.id)).toMatchObject({
      status: "follow_up_rescheduled",
      reason: "quiet_hours",
    });
    c = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(c.nextFollowUpAt?.toISOString()).toBe("2026-10-23T08:00:00.000Z"); // 10 h à Paris

    // Relance n°2.
    simulatedNow = new Date("2026-10-23T08:05:00Z");
    replies.push({ messages: ["Je repasse juste te dire bonne journée"], stage: "FOLLOW_UP" });
    expect(await turn(conv.id)).toMatchObject({
      status: "done",
      kind: "follow_up",
      outcome: "replied",
    });
    c = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(c.followUpCount).toBe(2);
    expect(c.nextFollowUpAt).toBeNull();

    // Plus jamais de relance, même forcée.
    simulatedNow = new Date("2026-10-30T10:00:00Z");
    (globalThis.__jobs ??= []).length = 0;
    await runChatSweep(simulatedNow);
    expect(capturedJobs("chat").filter((j) => j.data.conversationId === conv.id)).toHaveLength(0);
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { nextFollowUpAt: new Date("2026-10-29T10:00:00Z") },
    });
    expect(await turn(conv.id)).toMatchObject({
      status: "follow_up_cancelled",
      reason: "max_reached",
    });
    expect(
      await prisma.conversationEvent.count({
        where: { conversationId: conv.id, type: "follow_up_sent" },
      }),
    ).toBe(2);
    expect(sentTexts(tg)).toHaveLength(4);

    // La personne répond : compteur remis à zéro par le webhook, nouvelle relance possible plus tard.
    await receive(conv.id, "Désolé j'étais occupé");
    replies.push({ messages: ["Pas de souci !"], stage: "CHAT" });
    await turn(conv.id);
    c = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(c.followUpCount).toBe(0);
    expect(c.nextFollowUpAt).not.toBeNull();
  }, 60_000);

  it("âge de moins de 18 ans déclaré : arrêt poli sans lien, conversation fermée, plus jamais de réponse", async () => {
    const { conv, tg } = await newConversation();
    await receive(conv.id, "/start");
    replies.push({
      messages: ["Coucou, moi c'est Léa, l'assistante du canal 😊"],
      stage: "WELCOME",
    });
    await turn(conv.id);
    const callsBefore = fakeLlm.calls;
    await receive(conv.id, "j'ai 16 ans");
    expect(await turn(conv.id)).toMatchObject({ status: "done", outcome: "minor" });
    expect(fakeLlm.calls).toBe(callsBefore); // arrêt avant tout appel à l'IA
    expect(sentTexts(tg).at(-1)).toBe(fixedText("fr", "minorStop"));
    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(c).toMatchObject({
      isMinor: true,
      status: "CLOSED",
      closedReason: "MINOR",
      stage: "CLOSED",
    });
    expect(c.nextFollowUpAt).toBeNull();
    expect(await prisma.assistantOfferLink.count({ where: { conversationId: conv.id } })).toBe(0);
    expect(
      await prisma.conversationEvent.count({ where: { conversationId: conv.id, type: "minor" } }),
    ).toBe(1);
    await receive(conv.id, "en fait j'ai 25 ans");
    expect(await turn(conv.id)).toMatchObject({ status: "skipped" });
    expect(sentTexts(tg)).toHaveLength(2);
  }, 30_000);

  it("personne qui a bloqué le bot : conversation fermée (BLOCKED), plus de relance", async () => {
    const { conv, tg } = await newConversation();
    await receive(conv.id, "/start");
    replies.push({
      messages: ["Coucou, moi c'est Léa, l'assistante du canal 😊"],
      stage: "WELCOME",
    });
    await turn(conv.id);
    await receive(conv.id, "Salut");
    // Telegram refuse : « bot was blocked by the user ».
    const api = (await apiForBot(ids.bot)).api;
    let blockedOnce = false;
    api.config.use(async (prev, method, payload, signal) => {
      if (
        !blockedOnce &&
        method === "sendMessage" &&
        String((payload as { chat_id?: unknown }).chat_id) === String(tg)
      ) {
        blockedOnce = true;
        return {
          ok: false,
          error_code: 403,
          description: "Forbidden: bot was blocked by the user",
        } as never;
      }
      return prev(method, payload, signal);
    });
    replies.push({ messages: ["Tu fais quoi ?"], stage: "CHAT" });
    expect(await turn(conv.id)).toMatchObject({ status: "done" });
    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(c).toMatchObject({ status: "CLOSED", closedReason: "BLOCKED", stage: "CLOSED" });
    expect(c.nextFollowUpAt).toBeNull();
    expect(
      await prisma.conversationEvent.count({ where: { conversationId: conv.id, type: "blocked" } }),
    ).toBe(1);
    // Le message refusé n'apparaît pas dans la conversation ; l'envoi garde l'échec.
    expect(
      await prisma.conversationMessage.count({
        where: { conversationId: conv.id, direction: "OUT", text: "Tu fais quoi ?" },
      }),
    ).toBe(0);
    expect(
      await prisma.outboundMessage.count({
        where: { status: "BLOCKED", member: { telegramUserId: tg } },
      }),
    ).toBe(1);
  }, 30_000);

  it("Venice refuse la clé : aucun message, panne journalisée, alerte « assistant en panne »", async () => {
    const { conv, tg } = await newConversation();
    await receive(conv.id, "/start");
    replies.push(new VeniceError("auth", "Clé refusée", { status: 401 }));
    expect(await turn(conv.id)).toMatchObject({ status: "done", outcome: "failed" });
    expect(sentTexts(tg)).toHaveLength(0);
    const ev = await prisma.event.findFirstOrThrow({
      where: { type: "conversation.ai_failed", botId: ids.bot },
    });
    expect(ev.payload).toMatchObject({ code: "auth", final: true, conversationId: conv.id });
    const detected = await detectAlerts();
    const alert = detected.find((d) => d.kind === "assistant_ai_failing");
    expect(alert?.severity).toBe("CRITICAL");
    expect(alert?.message).toContain("Réglages → IA de conversation");
  }, 30_000);

  it("panne passagère de Venice : message neutre une fois, nouvel essai programmé, messages rendus au tour suivant", async () => {
    const { conv, tg } = await newConversation();
    await receive(conv.id, "/start");
    replies.push({
      messages: ["Coucou, moi c'est Léa, l'assistante du canal 😊"],
      stage: "WELCOME",
    });
    await turn(conv.id);
    await receive(conv.id, "Salut toi");
    const down = () => new VeniceError("server", "Venice indisponible", { status: 503 });
    replies.push(down(), down(), down());
    (globalThis.__jobs ??= []).length = 0;
    expect(await turn(conv.id)).toMatchObject({ status: "done", outcome: "failed" });
    expect(sentTexts(tg).at(-1)).toBe(fixedText("fr", "retryLater"));
    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(c.retryAt).not.toBeNull();
    expect(
      await prisma.conversationMessage.count({
        where: { conversationId: conv.id, direction: "IN", turnId: null },
      }),
    ).toBe(1);
    const next = capturedJobs("chat").at(-1);
    expect(next?.data).toMatchObject({ type: "turn", conversationId: conv.id });
    expect(Number(next?.opts.delay)).toBeGreaterThan(4 * 60_000);
    // Un tour lancé avant l'heure (sans nouveau message) attend.
    expect(await turn(conv.id)).toMatchObject({ status: "waiting_retry" });
    // À l'heure prévue : réponse normale.
    simulatedNow = new Date(c.retryAt!.getTime() + 1000);
    replies.push({ messages: ["Me revoilà ! Tu vas bien ?"], stage: "CHAT" });
    expect(await turn(conv.id)).toMatchObject({ status: "done", outcome: "replied" });
    expect(sentTexts(tg).at(-1)).toBe("Me revoilà ! Tu vas bien ?");
    expect(
      (await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } })).retryAt,
    ).toBeNull();
  }, 30_000);
  it("relance en panne de l'IA : 3 passages au plus, puis plus aucune relance (jamais de boucle toutes les 5 min)", async () => {
    simulatedNow = new Date("2026-11-03T10:00:00Z"); // 11 h à Paris
    const { conv } = await newConversation();
    await receive(conv.id, "/start");
    replies.push({
      messages: ["Coucou, moi c'est Léa, l'assistante du canal 😊"],
      stage: "WELCOME",
    });
    await turn(conv.id);
    await receive(conv.id, "Salut");
    replies.push({ messages: ["Tu fais quoi ce week-end ?"], stage: "CHAT" });
    await turn(conv.id);
    let c = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(c.nextFollowUpAt?.toISOString()).toBe("2026-11-04T10:00:00.000Z");

    const down = () => new VeniceError("server", "Venice indisponible", { status: 503 });
    const callsBefore = fakeLlm.calls;
    let at = new Date("2026-11-04T10:01:00Z");
    for (let pass = 1; pass <= 3; pass++) {
      simulatedNow = at;
      replies.push(down(), down(), down());
      expect(await turn(conv.id)).toMatchObject({ kind: "follow_up", outcome: "failed" });
      c = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
      expect(c.followUpCount).toBe(0);
      if (pass < 3) {
        expect(c.nextFollowUpAt?.getTime()).toBe(at.getTime() + 5 * 60_000);
        at = new Date(c.nextFollowUpAt!.getTime() + 1000);
      }
    }
    // Après le 3e passage : plus de nouvel essai, et le balayage ne relance plus rien.
    expect(c.nextFollowUpAt).toBeNull();
    expect(fakeLlm.calls - callsBefore).toBe(9);
    simulatedNow = new Date(at.getTime() + 60 * 60_000);
    (globalThis.__jobs ??= []).length = 0;
    await runChatSweep(simulatedNow);
    expect(capturedJobs("chat").filter((j) => j.data.conversationId === conv.id)).toHaveLength(0);
    const failures = await prisma.conversationEvent.findMany({
      where: { conversationId: conv.id, type: "ai_failed" },
      orderBy: { createdAt: "asc" },
    });
    expect(failures.map((f) => (f.payload as { final?: boolean }).final)).toEqual([
      false,
      false,
      true,
    ]);
  }, 30_000);

  it("/reset pendant la préparation de la réponse : rien ne part, la mémoire effacée ne revient jamais", async () => {
    const { conv, tg } = await newConversation();
    await receive(conv.id, "/start");
    replies.push({
      messages: ["Coucou, moi c'est Léa, l'assistante du canal 😊"],
      stage: "WELCOME",
    });
    await turn(conv.id);
    await receive(conv.id, "Je m'appelle Julien, j'habite Lyon");
    const before = sentTexts(tg).length;
    // La personne tape /reset pendant « écrit… » (le webhook efface tout sans attendre la fin du tour).
    setChatLlmFactory(() => ({
      async complete(req) {
        await simulateReset(conv.id);
        return fakeLlm.complete(req);
      },
    }));
    replies.push({
      messages: ["Super Julien, Lyon c'est top 😊"],
      stage: "CHAT",
      memory_facts: ["s'appelle Julien", "habite Lyon"],
      style_update: { interest: 8 },
    });
    try {
      expect(await turn(conv.id)).toMatchObject({ status: "done", outcome: "aborted" });
    } finally {
      setChatLlmFactory(() => fakeLlm);
    }
    expect(sentTexts(tg)).toHaveLength(before);
    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(c.facts).toEqual([]);
    expect(c.styleProfile).toEqual({});
    expect(c.language).toBeNull();
    expect(c.stage).toBe("WELCOME");
    expect(c.assistantTurns).toBe(0);
    expect(await prisma.conversationMessage.count({ where: { conversationId: conv.id } })).toBe(0);

    // La personne écrit après le /reset : l'assistant repart d'une conversation vide (présentation).
    await receive(conv.id, "Coucou");
    replies.push({
      messages: ["Coucou, moi c'est Léa, l'assistante du canal 😊"],
      stage: "WELCOME",
    });
    expect(await turn(conv.id)).toMatchObject({ status: "done", outcome: "replied" });
    const lastReq = fakeLlm.requests.at(-1)!;
    expect(JSON.stringify(lastReq.messages)).not.toContain("Julien");
  }, 30_000);

  it("/stop entre deux parties d'une réponse : la suite ne part jamais, FERMÉ reste, aucune relance", async () => {
    const { conv, tg } = await newConversation();
    await receive(conv.id, "/start");
    replies.push({
      messages: ["Coucou, moi c'est Léa, l'assistante du canal 😊"],
      stage: "WELCOME",
    });
    await turn(conv.id);
    await receive(conv.id, "Salut");
    const before = sentTexts(tg).length;
    // Le webhook reçoit /stop juste après la première partie.
    const api = (await apiForBot(ids.bot)).api;
    let stopped = false;
    api.config.use(async (prev, method, payload, signal) => {
      const res = await prev(method, payload, signal);
      if (
        !stopped &&
        method === "sendMessage" &&
        String((payload as { chat_id?: unknown }).chat_id) === String(tg)
      ) {
        stopped = true;
        await simulateStop(conv.id);
      }
      return res;
    });
    replies.push({
      messages: ["Hello toi 😊", "Tu fais quoi ce soir ?", "Moi je chille"],
      stage: "CHAT",
    });
    expect(await turn(conv.id)).toMatchObject({ status: "done", outcome: "replied" });
    expect(sentTexts(tg).slice(before)).toEqual(["Hello toi 😊"]);
    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(c).toMatchObject({ status: "CLOSED", stage: "CLOSED", closedReason: "STOP" });
    expect(c.nextFollowUpAt).toBeNull();
    expect(c.retryAt).toBeNull();
    expect(
      await prisma.outboundMessage.count({
        where: { member: { telegramUserId: tg }, kind: "ASSISTANT" },
      }),
    ).toBe(before + 1);
  }, 30_000);

  it("tour planté avant tout envoi : messages rendus et repris, au plus 2 fois, puis abandonnés (jamais de boucle)", async () => {
    const { conv, tg } = await newConversation();
    const msg = await receive(conv.id, "/start");
    setChatLlmFactory(() => {
      throw new Error("panne simulée de la base");
    });
    try {
      for (let crash = 1; crash <= 3; crash++) {
        (globalThis.__jobs ??= []).length = 0;
        await expect(turn(conv.id)).rejects.toThrow("panne simulée de la base");
        const m = await prisma.conversationMessage.findUniqueOrThrow({ where: { id: msg.id } });
        expect(m.meta).toMatchObject({ crashes: crash });
        const jobs = capturedJobs("chat").filter((j) => j.data.conversationId === conv.id);
        if (crash < 3) {
          expect(m.turnId).toBeNull();
          expect(jobs.at(-1)?.opts).toMatchObject({ delay: 30_000 });
        } else {
          expect(m.turnId).not.toBeNull();
          expect(m.meta).toMatchObject({ turnDone: true });
          expect(jobs).toHaveLength(0);
        }
      }
    } finally {
      setChatLlmFactory(() => fakeLlm);
    }
    (globalThis.__jobs ??= []).length = 0;
    await runChatSweep(new Date(Date.now() + 10 * 60_000));
    expect(capturedJobs("chat").filter((j) => j.data.conversationId === conv.id)).toHaveLength(0);
    expect(sentTexts(tg)).toHaveLength(0);
  }, 30_000);

  it("limite du jour : comptée sur les envois, un /reset ne la remet pas à zéro", async () => {
    await saveSettings({ perConversationDailyLimit: 2 });
    const { conv, tg } = await newConversation();
    await receive(conv.id, "/start");
    replies.push({
      messages: ["Coucou, moi c'est Léa, l'assistante du canal 😊"],
      stage: "WELCOME",
    });
    await turn(conv.id);
    await receive(conv.id, "Salut");
    replies.push({ messages: ["Tu fais quoi ?"], stage: "CHAT" });
    await turn(conv.id);
    expect(sentTexts(tg)).toHaveLength(2);
    await simulateReset(conv.id);
    await receive(conv.id, "Re");
    const callsBefore = fakeLlm.calls;
    expect(await turn(conv.id)).toMatchObject({ status: "skipped", reason: "daily_limit" });
    expect(fakeLlm.calls).toBe(callsBefore);
    expect(sentTexts(tg)).toHaveLength(2);
  }, 30_000);
  it("balayage : message non traité repris, trop vieux ignoré, tour bloqué rendu, tour en cours jamais touché", async () => {
    const now = new Date();
    const minutesAgo = (n: number) => new Date(now.getTime() - n * 60_000);
    // Message reçu il y a 2 min, jamais traité (tâche perdue) → nouveau tour.
    const lost = await newConversation();
    await prisma.conversationMessage.create({
      data: {
        conversationId: lost.conv.id,
        direction: "IN",
        author: "MEMBER",
        text: "Allo",
        createdAt: minutesAgo(2),
      },
    });
    // Message de plus de 24 h → jamais repris.
    const old = await newConversation();
    await prisma.conversationMessage.create({
      data: {
        conversationId: old.conv.id,
        direction: "IN",
        author: "MEMBER",
        text: "Vieux",
        createdAt: minutesAgo(25 * 60),
      },
    });
    // Tour bloqué (worker arrêté) : réclamé il y a 5 min, pas terminé, rien d'envoyé → rendu et repris.
    const stuck = await newConversation();
    const stuckMsg = await prisma.conversationMessage.create({
      data: {
        conversationId: stuck.conv.id,
        direction: "IN",
        author: "MEMBER",
        text: "Tu es là ?",
        createdAt: minutesAgo(5),
        turnId: "tour-plante-1",
      },
    });
    // Tour bloqué mais une partie est déjà partie : jamais rejoué (pas de double réponse), seulement marqué terminé.
    const half = await newConversation();
    const halfMsg = await prisma.conversationMessage.create({
      data: {
        conversationId: half.conv.id,
        direction: "IN",
        author: "MEMBER",
        text: "Coucou",
        createdAt: minutesAgo(5),
        turnId: "tour-plante-2",
      },
    });
    await prisma.conversationMessage.create({
      data: {
        conversationId: half.conv.id,
        direction: "OUT",
        author: "ASSISTANT",
        text: "Partie 1",
        turnId: "tour-plante-2",
        partIndex: 0,
      },
    });
    // Tour en cours (verrou pris) : jamais touché.
    const busy = await newConversation();
    const busyMsg = await prisma.conversationMessage.create({
      data: {
        conversationId: busy.conv.id,
        direction: "IN",
        author: "MEMBER",
        text: "Re",
        createdAt: minutesAgo(5),
        turnId: "tour-en-cours",
      },
    });
    await getRedis().set(`chat:lock:${busy.conv.id}`, "worker:chat:autre", "PX", 60_000, "NX");

    (globalThis.__jobs ??= []).length = 0;
    const report = await runChatSweep(now);
    const enqueued = capturedJobs("chat").map((j) => j.data.conversationId);
    expect(enqueued).toEqual(expect.arrayContaining([lost.conv.id, stuck.conv.id]));
    expect(enqueued).not.toContain(old.conv.id);
    expect(enqueued).not.toContain(half.conv.id);
    expect(enqueued).not.toContain(busy.conv.id);
    expect(report.stuckReleased).toBeGreaterThanOrEqual(1);
    expect(
      (await prisma.conversationMessage.findUniqueOrThrow({ where: { id: stuckMsg.id } })).turnId,
    ).toBeNull();
    const halfAfter = await prisma.conversationMessage.findUniqueOrThrow({
      where: { id: halfMsg.id },
    });
    expect(halfAfter.turnId).toBe("tour-plante-2");
    expect(halfAfter.meta).toMatchObject({ turnDone: true });
    expect(
      (await prisma.conversationMessage.findUniqueOrThrow({ where: { id: busyMsg.id } })).turnId,
    ).toBe("tour-en-cours");
    // Le message bloqué rendu est traité par le tour suivant.
    replies.push({
      messages: ["Coucou, moi c'est Léa, l'assistante du canal 😊"],
      stage: "WELCOME",
    });
    expect(await turn(stuck.conv.id)).toMatchObject({ status: "done", outcome: "replied" });
    expect(sentTexts(stuck.tg)).toHaveLength(1);
  }, 30_000);

  it("purge : conversations des membres anonymisés supprimées, messages plus vieux que la conservation supprimés", async () => {
    const gone = await newConversation();
    await receive(gone.conv.id, "Bonjour");
    await prisma.member.update({
      where: { id: gone.member.id },
      data: { anonymizedAt: new Date() },
    });
    const kept = await newConversation();
    const oldMsg = await prisma.conversationMessage.create({
      data: {
        conversationId: kept.conv.id,
        direction: "IN",
        author: "MEMBER",
        text: "Très vieux",
        createdAt: new Date("2023-01-01T00:00:00Z"),
      },
    });
    const recent = await receive(kept.conv.id, "Récent");
    // Copies des textes de l'assistant gardées par l'envoi : vidées (membre anonymisé, trop vieilles), sinon gardées.
    const assistantOut = (memberId: string, text: string, queuedAt = new Date()) =>
      prisma.outboundMessage.create({
        data: { botId: ids.bot, memberId, kind: "ASSISTANT", text, status: "SENT", queuedAt },
      });
    const goneOut = await assistantOut(gone.member.id, "Super Tom, Lyon c'est top");
    const oldOut = await assistantOut(
      kept.member.id,
      "Ancien message",
      new Date("2023-01-01T00:00:00Z"),
    );
    const recentOut = await assistantOut(kept.member.id, "Message récent");
    const r = await runPurge();
    expect(r.assistantTextsCleared).toBeGreaterThanOrEqual(2);
    const texts = await prisma.outboundMessage.findMany({
      where: { id: { in: [goneOut.id, oldOut.id, recentOut.id] } },
      select: { id: true, text: true },
    });
    const textOf = (id: string) => texts.find((t) => t.id === id)?.text;
    expect(textOf(goneOut.id)).toBe("");
    expect(textOf(oldOut.id)).toBe("");
    expect(textOf(recentOut.id)).toBe("Message récent");
    expect(r.conversationsDeleted).toBeGreaterThanOrEqual(1);
    expect(r.conversationMessagesDeleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.conversation.count({ where: { id: gone.conv.id } })).toBe(0);
    expect(await prisma.conversationMessage.count({ where: { id: oldMsg.id } })).toBe(0);
    expect(await prisma.conversationMessage.count({ where: { id: recent.id } })).toBe(1);
  }, 30_000);
  it("relecture des modèles Venice : seuls `models` et `modelsFetchedAt` changent, une panne ne touche à rien", async () => {
    await saveSettings({
      activation: "team",
      monthlyCapEur: 12,
      verifiedAt: "2026-10-18T08:00:00.000Z",
    });
    const model = (id: string, over: Record<string, unknown> = {}) => ({
      id,
      name: id,
      inputUsdPerM: 0.2,
      outputUsdPerM: 0.9,
      maxCompletionTokens: 2048,
      contextLength: 32000,
      supportsResponseSchema: true,
      supportsReasoning: false,
      uncensored: true,
      offline: false,
      deprecated: false,
      ...over,
    });
    configureChatRuntime({
      listModels: async () => [
        model("venice-uncensored-1-2"),
        model("sans-schema", { supportsResponseSchema: false }),
      ],
    });
    const at = new Date("2026-10-18T12:00:00Z");
    try {
      expect(await refreshAssistantModels(at)).toEqual({ ok: true, models: 1 });
      const row = await prisma.setting.findUniqueOrThrow({ where: { key: ASSISTANT_SETTING_KEY } });
      const v = row.value as Record<string, unknown>;
      expect(v).toMatchObject({
        activation: "team",
        monthlyCapEur: 12,
        verifiedAt: "2026-10-18T08:00:00.000Z",
        modelsFetchedAt: at.toISOString(),
      });
      expect((v.models as Array<{ id: string }>).map((m) => m.id)).toEqual([
        "venice-uncensored-1-2",
      ]);
      expect(typeof v.apiKeyEncrypted).toBe("string");
      configureChatRuntime({
        listModels: async () => {
          throw new VeniceError("server", "Venice indisponible");
        },
      });
      expect(await refreshAssistantModels(new Date("2026-10-19T12:00:00Z"))).toMatchObject({
        ok: false,
      });
      const after = await prisma.setting.findUniqueOrThrow({
        where: { key: ASSISTANT_SETTING_KEY },
      });
      expect((after.value as Record<string, unknown>).modelsFetchedAt).toBe(at.toISOString());
      // Aucun réglage encore enregistré : la liste est créée seule (assistant toujours désactivé par défaut).
      await prisma.setting.deleteMany({ where: { key: ASSISTANT_SETTING_KEY } });
      configureChatRuntime({ listModels: async () => [model("venice-uncensored-1-2")] });
      await refreshAssistantModels(at);
      const fresh = await prisma.setting.findUniqueOrThrow({
        where: { key: ASSISTANT_SETTING_KEY },
      });
      expect(fresh.value).toMatchObject({ modelsFetchedAt: at.toISOString() });
      expect((fresh.value as Record<string, unknown>).activation).toBeUndefined();
    } finally {
      configureChatRuntime({ listModels: async () => [] });
    }
  });
});

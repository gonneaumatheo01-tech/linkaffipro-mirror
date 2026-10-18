/**
 * Tour de l'assistant côté worker, sans base ni réseau : verrou, réclamation, contrôles avant l'appel, appel du moteur
 * avec un faux client Venice et un faux envoi, enregistrement du résultat. Le parcours complet sur base réelle est
 * dans tests/integration/assistant-conversation.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VeniceError, createFakeLlm, createFakeSender, type FakeLlmReply } from "@linkaffipro/chat";

type Row = Record<string, unknown>;
const h = vi.hoisted(() => {
  class RedisLockBusy extends Error {}
  const state = {
    lockBusy: false,
    claimed: null as Array<{ id: string; text: string; media: null; createdAt: Date }> | null,
    conversation: null as Row | null,
    persona: null as Row | null,
    blockedAt: null as Date | null,
    settings: { activation: "all", monthlyCapEur: 30, perConversationDailyLimit: 60 } as Row,
    monthSpend: 0,
    todayCount: 0,
    team: false,
    enqueued: [] as Array<{ id: string; delayMs?: number }>,
    released: [] as Array<{ turnId: string; ids: string[] }>,
    done: [] as string[],
    convUpdates: [] as Row[],
    convUpdateMany: [] as Row[],
    usages: [] as Row[],
    events: [] as Row[],
    oncePerDay: [] as Row[],
    unclaimed: 0,
    /** /reset reçus (relu au début du tour, avant chaque envoi et à l'enregistrement). */
    resets: 0,
    /** Parties OUT déjà enregistrées pour le tour (reprise d'un tour planté). */
    outOfTurn: 0,
    crashReleased: [] as Array<{ turnId: string; max: number }>,
    turnReleased: [] as string[],
    outboundCountArgs: [] as Row[],
  };
  const prisma = {
    conversation: {
      findUnique: vi.fn(async (args: { select?: Row }) => {
        if (!state.conversation) return null;
        return args.select ? { ...state.conversation } : { ...state.conversation };
      }),
      update: vi.fn(async (args: Row) => {
        state.convUpdates.push(args);
        return {};
      }),
      updateMany: vi.fn(async (args: Row) => {
        state.convUpdateMany.push(args);
        return { count: 1 };
      }),
    },
    persona: { findUnique: vi.fn(async () => state.persona) },
    memberBotState: { findUnique: vi.fn(async () => ({ blockedAt: state.blockedAt })) },
    aiConversationUsage: {
      aggregate: vi.fn(async () => ({ _sum: { costEur: state.monthSpend } })),
      create: vi.fn(async ({ data }: { data: Row }) => {
        state.usages.push(data);
        return data;
      }),
    },
    outboundMessage: {
      count: vi.fn(async (args: Row) => {
        state.outboundCountArgs.push(args);
        return state.todayCount;
      }),
    },
    conversationMessage: {
      count: vi.fn(async () => state.outOfTurn),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
    },
    conversationEvent: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => [] as Row[]),
      count: vi.fn(async () => state.resets),
    },
    channel: { findMany: vi.fn(async () => [{ id: "ch1", title: "Rencontres Paris" }]) },
    channelBotAdmin: { findFirst: vi.fn(async () => null) },
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async () => [{ id: "conv1" }]),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return { state, prisma, RedisLockBusy };
});

vi.mock("@linkaffipro/db", () => ({ prisma: h.prisma, toJsonValue: (v: unknown) => v }));
vi.mock("@linkaffipro/queue", () => ({
  RedisLockBusy: h.RedisLockBusy,
  getRedis: () => ({}),
  withRedisLock: vi.fn(async (_r: unknown, _k: string, fn: () => Promise<unknown>) => {
    if (h.state.lockBusy) throw new h.RedisLockBusy("pris");
    return fn();
  }),
  enqueueChatTurn: vi.fn(async (id: string, opts: { delayMs?: number } = {}) => {
    h.state.enqueued.push({ id, ...opts });
  }),
}));
vi.mock("@linkaffipro/telegram", () => ({
  isAssistantTeamMember: vi.fn(async () => h.state.team),
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("./claim", () => ({
  newTurnId: () => "t1",
  parseChatMedia: () => null,
  claimInbound: vi.fn(async () => h.state.claimed),
  claimMoreInbound: vi.fn(async () => []),
  releaseInbound: vi.fn(async (turnId: string, ids: string[]) => {
    h.state.released.push({ turnId, ids: [...ids] });
    return ids.length;
  }),
  markTurnDone: vi.fn(async (turnId: string) => {
    h.state.done.push(turnId);
    return 1;
  }),
  countUnclaimed: vi.fn(async () => h.state.unclaimed),
  releaseTurn: vi.fn(async (turnId: string) => {
    h.state.turnReleased.push(turnId);
    return 0;
  }),
  releaseCrashedTurn: vi.fn(async (turnId: string, max: number) => {
    h.state.crashReleased.push({ turnId, max });
    return { released: 1, gaveUp: 0 };
  }),
}));
vi.mock("./settings", () => ({
  loadAssistantSettings: vi.fn(async () => ({
    config: {
      activation: h.state.settings.activation,
      defaultModel: "venice-uncensored-role-play",
      fallbackModel: "venice-uncensored-1-2",
      temperature: 0.85,
      maxTokens: 400,
      monthlyCapEur: h.state.settings.monthlyCapEur,
      perConversationDailyLimit: h.state.settings.perConversationDailyLimit,
      models: [],
    },
    apiKey: "cle",
  })),
}));
vi.mock("./events", () => ({
  recordConversationEvent: vi.fn(async (_c: Row, input: Row) => {
    h.state.events.push(input);
  }),
  recordConversationEventOncePerDay: vi.fn(async (_c: Row, input: Row) => {
    h.state.oncePerDay.push(input);
    return true;
  }),
}));
vi.mock("./offer-link", () => ({
  createAssistantOfferLink: vi.fn(async () => null),
  dropUnsentOfferLink: vi.fn(async () => undefined),
}));
const fakeSender = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("./sender", () => ({
  createWorkerChatSender: vi.fn(() => fakeSender.current),
}));

import { configureChatRuntime } from "./runtime";
import { processChatTurn } from "./turn";

const replies: FakeLlmReply[] = [];
const llm = createFakeLlm(() => {
  const r = replies.shift();
  if (!r) throw new Error("aucune réponse prévue");
  return r;
});
const NOW = new Date("2026-10-18T10:00:00Z");

function conversation(over: Row = {}): Row {
  return {
    id: "conv1",
    botId: "bot1",
    memberId: "mem1",
    personaId: "p1",
    source: "pub1",
    stage: "CHAT",
    status: "BOT",
    styleProfile: {},
    summary: null,
    facts: [],
    isMinor: false,
    stoppedAt: null,
    memberMessages: 2,
    assistantTurns: 1,
    offerSends: 0,
    lastInboundAt: new Date("2026-10-18T09:59:58Z"),
    lastAssistantAt: new Date("2026-10-18T09:00:00Z"),
    followUpCount: 0,
    nextFollowUpAt: null,
    retryAt: null,
    bot: {
      id: "bot1",
      name: "Léa",
      username: "lea_bot",
      mode: "ASSISTANT",
      isActive: true,
      personaId: "p1",
    },
    member: { id: "mem1", telegramUserId: 4242n, languageCode: "fr" },
    ...over,
  };
}

const persona: Row = {
  id: "p1",
  name: "Léa",
  gender: "F",
  personality: "",
  tone: "",
  languages: ["fr"],
  interests: [],
  extraPrompt: null,
  model: null,
  temperature: null,
  minExchangesBeforeOffer: 4,
  requireInterest: true,
  maxOfferSends: 2,
  followUpAfterHours: 24,
  followUpsMax: 2,
  affiliateCampaignId: null,
  offerPitch: "",
  offerButtonText: "Découvrir l'app",
  offerMediaAssetId: null,
  isActive: true,
  affiliateCampaign: null,
  campaign: { channelIds: ["ch1"] },
};

describe("tour de l'assistant (worker)", () => {
  beforeEach(() => {
    Object.assign(h.state, {
      lockBusy: false,
      claimed: [
        { id: "in1", text: "Salut", media: null, createdAt: new Date("2026-10-18T09:59:58Z") },
      ],
      conversation: conversation(),
      persona,
      blockedAt: null,
      settings: { activation: "all", monthlyCapEur: 30, perConversationDailyLimit: 60 },
      monthSpend: 0,
      todayCount: 0,
      team: false,
      unclaimed: 0,
      resets: 0,
      outOfTurn: 0,
    });
    for (const k of [
      "crashReleased",
      "turnReleased",
      "outboundCountArgs",
      "enqueued",
      "released",
      "done",
      "convUpdates",
      "convUpdateMany",
      "usages",
      "events",
      "oncePerDay",
    ] as const)
      h.state[k].length = 0;
    replies.length = 0;
    llm.requests.length = 0;
    const s = createFakeSender();
    fakeSender.current = Object.assign(s, { sentRows: [] });
    configureChatRuntime({
      llmFactory: () => llm,
      sleep: async () => undefined,
      random: () => 0.5,
      now: () => NOW,
    });
  });

  it("verrou pris par un autre tour : remis en file 3 s plus tard, rien d'autre", async () => {
    h.state.lockBusy = true;
    expect(await processChatTurn("conv1")).toEqual({ conversationId: "conv1", status: "busy" });
    expect(h.state.enqueued).toEqual([{ id: "conv1", delayMs: 3000 }]);
    expect(llm.calls).toBe(0);
  });

  it("conversation introuvable : rien", async () => {
    h.state.claimed = null;
    expect(await processChatTurn("conv1")).toMatchObject({ status: "missing" });
  });

  it("rien à traiter ni relance due : fin, tour marqué terminé", async () => {
    h.state.claimed = [];
    expect(await processChatTurn("conv1")).toMatchObject({ status: "nothing" });
    expect(h.state.done).toEqual(["t1"]);
    expect(llm.calls).toBe(0);
  });

  it("pas encore activé : messages rendus, aucun appel", async () => {
    h.state.settings = { ...h.state.settings, activation: "team" };
    h.state.team = false;
    expect(await processChatTurn("conv1")).toMatchObject({
      status: "skipped",
      reason: "not_enabled",
    });
    expect(h.state.released).toEqual([{ turnId: "t1", ids: ["in1"] }]);
    expect(llm.calls).toBe(0);
  });

  it("limite du jour atteinte : événement une fois par jour, messages gardés, aucun appel", async () => {
    h.state.todayCount = 60;
    h.prisma.conversation.findUnique.mockClear();
    expect(await processChatTurn("conv1")).toMatchObject({
      status: "skipped",
      reason: "daily_limit",
    });
    expect(h.state.oncePerDay[0]).toMatchObject({
      type: "daily_limit",
      payload: { limit: 60, day: "2026-10-18" },
    });
    expect(h.state.released).toEqual([]);
    expect(llm.calls).toBe(0);
    // Comptée sur les envois de l'assistant (survivent à /reset), jamais sur ceux de l'équipe.
    expect(h.state.outboundCountArgs[0]).toEqual({
      where: {
        botId: "bot1",
        memberId: "mem1",
        kind: "ASSISTANT",
        status: "SENT",
        sentAt: { gte: new Date("2026-10-17T22:00:00Z") },
        NOT: { conversationMessage: { is: { author: "TEAM" } } },
      },
    });
  });

  it("plafond du mois atteint : aucun appel", async () => {
    h.state.monthSpend = 30.5;
    expect(await processChatTurn("conv1")).toMatchObject({
      status: "skipped",
      reason: "cap_reached",
    });
    expect(h.state.oncePerDay[0]).toMatchObject({ type: "cap_reached" });
    expect(llm.calls).toBe(0);
  });

  it("bot bloqué par la personne : aucun appel", async () => {
    h.state.blockedAt = new Date();
    expect(await processChatTurn("conv1")).toMatchObject({ status: "skipped", reason: "blocked" });
    expect(llm.calls).toBe(0);
  });

  it("réponse : appel du modèle (prompt avec le canal), envoi, coût enregistré, conversation mise à jour", async () => {
    replies.push({
      messages: ["Hello toi 😊", "Tu fais quoi ?"],
      stage: "CHAT",
      style_update: { interest: 7 },
    });
    expect(await processChatTurn("conv1")).toMatchObject({
      status: "done",
      kind: "reply",
      outcome: "replied",
      sent: 2,
    });
    expect(llm.requests[0]?.model).toBe("venice-uncensored-role-play");
    expect(llm.requests[0]?.messages[0]?.content).toContain("Rencontres Paris");
    expect(llm.requests[0]?.messages.at(-1)).toEqual({ role: "user", content: "Salut" });
    const s = fakeSender.current as ReturnType<typeof createFakeSender>;
    expect(s.messages().map((m) => m.text)).toEqual(["Hello toi 😊", "Tu fais quoi ?"]);
    expect(h.state.usages[0]).toMatchObject({
      personaId: "p1",
      conversationId: "conv1",
      purpose: "REPLY",
      ok: true,
    });
    const update = h.state.convUpdates.at(-1) as { data: Row };
    expect(update.data).toMatchObject({
      assistantTurns: { increment: 1 },
      lastAssistantAt: NOW,
      followUpCount: 0,
      retryAt: null,
      language: "fr",
    });
    expect(update.data.nextFollowUpAt).toEqual(new Date("2026-10-19T10:00:00Z"));
    expect(h.state.done).toEqual(["t1"]);
  });

  it("nouvel essai prévu plus tard et aucun nouveau message : on attend l'heure prévue", async () => {
    h.state.conversation = conversation({ retryAt: new Date("2026-10-18T10:04:00Z") });
    h.prisma.conversationEvent.findFirst.mockResolvedValueOnce({
      createdAt: new Date("2026-10-18T09:59:59Z"),
    } as never);
    expect(await processChatTurn("conv1")).toMatchObject({ status: "waiting_retry" });
    expect(h.state.released).toEqual([{ turnId: "t1", ids: ["in1"] }]);
    expect(h.state.enqueued).toEqual([{ id: "conv1", delayMs: 240_000 }]);
    expect(llm.calls).toBe(0);
  });

  it("relance due : réclamée par comparaison-échange puis écrite par l'IA", async () => {
    h.state.claimed = [];
    h.state.conversation = conversation({
      nextFollowUpAt: new Date("2026-10-18T09:30:00Z"),
      lastAssistantAt: new Date("2026-10-17T09:30:00Z"),
      lastInboundAt: new Date("2026-10-17T09:29:00Z"),
    });
    replies.push({ messages: ["Tu es toujours là ? 😊"], stage: "FOLLOW_UP" });
    expect(await processChatTurn("conv1")).toMatchObject({
      status: "done",
      kind: "follow_up",
      outcome: "replied",
    });
    expect(h.state.convUpdateMany[0]).toMatchObject({
      where: {
        id: "conv1",
        status: "BOT",
        stoppedAt: null,
        isMinor: false,
        followUpCount: { equals: 0, lt: 2 },
      },
      data: { followUpCount: { increment: 1 }, nextFollowUpAt: null },
    });
    expect(h.state.usages[0]).toMatchObject({ purpose: "FOLLOW_UP" });
    expect(h.state.events).toContainEqual({
      type: "follow_up_sent",
      payload: { number: 1 },
      at: NOW,
    });
  });
  it("relance en panne : nouvel essai 5 min plus tard, mais plus rien après le 3e passage", async () => {
    const due = () =>
      conversation({
        nextFollowUpAt: new Date("2026-10-18T09:30:00Z"),
        lastAssistantAt: new Date("2026-10-17T09:30:00Z"),
        lastInboundAt: new Date("2026-10-17T09:29:00Z"),
      });
    const down = () => new VeniceError("server", "Venice indisponible", { status: 503 });
    h.state.claimed = [];
    h.state.conversation = due();
    replies.push(down(), down(), down());
    expect(await processChatTurn("conv1")).toMatchObject({ kind: "follow_up", outcome: "failed" });
    let update = h.state.convUpdates.at(-1) as { data: Row };
    expect(update.data).toMatchObject({
      followUpCount: 0,
      nextFollowUpAt: new Date("2026-10-18T10:05:00Z"),
    });

    // Deux passages déjà en panne depuis le dernier message parti : le 3e est le dernier.
    h.state.convUpdates.length = 0;
    h.state.events.length = 0;
    replies.length = 0;
    replies.push(down(), down(), down());
    const failure = (iso: string) => ({
      createdAt: new Date(iso),
      payload: { code: "server", kind: "follow_up" },
    });
    h.prisma.conversationEvent.findMany.mockResolvedValueOnce([
      failure("2026-10-18T09:30:00Z"),
      failure("2026-10-18T09:35:00Z"),
    ]);
    expect(await processChatTurn("conv1")).toMatchObject({ kind: "follow_up", outcome: "failed" });
    update = h.state.convUpdates.at(-1) as { data: Row };
    expect(update.data).toMatchObject({ followUpCount: 0, nextFollowUpAt: null });
    expect(h.state.events.find((e) => e.type === "ai_failed")).toMatchObject({
      payload: { final: true, kind: "follow_up" },
    });
  });

  it("/reset pendant la préparation : rien ne part, rien de l'ancienne conversation n'est réécrit", async () => {
    h.state.conversation = conversation({ facts: ["s'appelle Julien"], stage: "WELCOME" });
    h.prisma.conversationEvent.count.mockResolvedValueOnce(0); // début du tour
    h.state.resets = 1; // /reset reçu pendant l'appel à l'IA
    replies.push({
      messages: ["Super Julien, Lyon c'est top 😊"],
      stage: "CHAT",
      memory_facts: ["habite Lyon"],
    });
    expect(await processChatTurn("conv1")).toMatchObject({ status: "done", outcome: "aborted" });
    const s = fakeSender.current as ReturnType<typeof createFakeSender>;
    expect(s.messages()).toHaveLength(0);
    const data = (h.state.convUpdates.at(-1) as { data: Row }).data;
    for (const key of ["facts", "styleProfile", "summary", "language", "stage", "nextFollowUpAt"])
      expect(data).not.toHaveProperty(key);
    // Les messages écrits après le /reset (s'il y en a) sont rendus au tour suivant.
    expect(h.state.turnReleased).toEqual(["t1"]);
  });

  it("/reset après l'envoi mais avant l'enregistrement : la mémoire effacée n'est jamais réécrite", async () => {
    h.prisma.conversationEvent.count
      .mockResolvedValueOnce(0) // début du tour
      .mockResolvedValueOnce(0); // relecture avant l'envoi
    h.state.resets = 1; // enregistrement : /reset passé entre-temps
    h.state.conversation = conversation({ stage: "WELCOME" });
    replies.push({
      messages: ["Super Julien 😊"],
      stage: "CHAT",
      memory_facts: ["s'appelle Julien"],
    });
    expect(await processChatTurn("conv1")).toMatchObject({ status: "done", outcome: "replied" });
    const data = (h.state.convUpdates.at(-1) as { data: Row }).data;
    expect(data).toEqual({ lastAssistantAt: NOW });
    expect(h.state.events.filter((e) => e.type === "stage_changed")).toEqual([]);
  });

  it("/stop pendant l'envoi : l'étape FERMÉ et l'arrêt des relances ne sont jamais défaits", async () => {
    const s = fakeSender.current as ReturnType<typeof createFakeSender>;
    const sendText = s.sendText.bind(s);
    s.sendText = async (text, opts) => {
      const r = await sendText(text, opts);
      h.state.conversation = conversation({
        status: "CLOSED",
        stage: "CLOSED",
        stoppedAt: NOW,
        closedReason: "STOP",
      });
      return r;
    };
    h.state.conversation = conversation({ stage: "WELCOME" });
    replies.push({ messages: ["Coucou 😊"], stage: "CHAT", style_update: { interest: 8 } });
    expect(await processChatTurn("conv1")).toMatchObject({ status: "done", outcome: "replied" });
    const data = (h.state.convUpdates.at(-1) as { data: Row }).data;
    expect(data).not.toHaveProperty("stage");
    expect(data).not.toHaveProperty("nextFollowUpAt");
    expect(data).not.toHaveProperty("retryAt");
    expect(h.state.events.filter((e) => e.type === "stage_changed")).toEqual([]);
    expect(h.state.enqueued).toEqual([]);
  });

  it("tour planté avant tout envoi : messages rendus et repris 30 s plus tard, jamais marqués traités", async () => {
    h.prisma.persona.findUnique.mockRejectedValueOnce(new Error("connexion à la base perdue"));
    await expect(processChatTurn("conv1")).rejects.toThrow("connexion à la base perdue");
    expect(h.state.crashReleased).toEqual([{ turnId: "t1", max: 2 }]);
    expect(h.state.done).toEqual([]);
    expect(h.state.enqueued).toEqual([{ id: "conv1", delayMs: 30_000 }]);
    expect(llm.calls).toBe(0);
  });

  it("tour planté après un envoi : marqué terminé, jamais rejoué (pas de double réponse)", async () => {
    h.state.outOfTurn = 1;
    h.prisma.$transaction.mockRejectedValueOnce(new Error("connexion à la base perdue"));
    replies.push({ messages: ["Coucou 😊"], stage: "CHAT" });
    await expect(processChatTurn("conv1")).rejects.toThrow("connexion à la base perdue");
    expect(h.state.crashReleased).toEqual([]);
    expect(h.state.done).toEqual(["t1"]);
    expect(h.state.enqueued).toEqual([]);
  });
});

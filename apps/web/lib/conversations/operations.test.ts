import { beforeEach, describe, expect, it, vi } from "vitest";

// Réouverture d'une conversation fermée par l'équipe (« Prendre la main », « Rendre à l'assistante ») : une conversation
// dont l'inscription est déjà comptée revient « Inscrit » (comme la réouverture par le bot), jamais à une étape qui
// relancerait la personne ou lui renverrait un lien. Base simulée (transaction en mémoire).
const m = vi.hoisted(() => ({
  conv: null as Record<string, unknown> | null,
  lastClose: null as { fromStage: string | null } | null,
  updates: [] as Array<Record<string, unknown>>,
  events: [] as Array<Record<string, unknown>>,
  eventQueries: [] as unknown[],
}));

vi.mock("@linkaffipro/db", () => {
  const tx = {
    $queryRaw: vi.fn(async () => (m.conv ? [{ id: m.conv.id }] : [])),
    $executeRaw: vi.fn(async () => 0),
    conversation: {
      findUnique: vi.fn(async () => (m.conv ? { ...m.conv } : null)),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        m.updates.push(data);
        return m.conv;
      }),
    },
    memberBotState: { findUnique: vi.fn(async () => null) },
    conversationEvent: {
      findFirst: vi.fn(async (args: unknown) => {
        m.eventQueries.push(args);
        return m.lastClose;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        m.events.push(data);
        return data;
      }),
    },
    conversationMessage: { findFirst: vi.fn(async () => null) },
  };
  return {
    prisma: {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      conversation: { findUnique: vi.fn(async () => null) },
      conversationMessage: { create: vi.fn(async () => ({})) },
    },
    audit: vi.fn(async () => undefined),
    recordEvent: vi.fn(async () => undefined),
    toJsonValue: (v: unknown) => v,
  };
});
vi.mock("@linkaffipro/queue", () => ({
  enqueueDm: vi.fn(),
  getRedis: vi.fn(),
  withRedisLock: vi.fn(),
  RedisLockBusy: class RedisLockBusy extends Error {},
}));

import { audit } from "@linkaffipro/db";
import { enqueueDm } from "@linkaffipro/queue";
import {
  clearNeedsHuman,
  releaseConversation,
  sendTeamMessage,
  stageOnReopen,
  takeOverConversation,
} from "./operations";

const USER = { id: "u1", name: "Marie" };
const NOW = new Date("2026-10-18T10:00:00Z");
const CONVERTED_AT = new Date("2026-10-17T08:00:00Z");

/** Conversation fermée par l'équipe (« Fermer »), réouvrable. */
function closedConversation(over: Record<string, unknown> = {}) {
  return {
    id: "c1",
    botId: "b1",
    memberId: "mb1",
    status: "CLOSED",
    stage: "CLOSED",
    closedReason: "TEAM_CLOSED",
    stoppedAt: null,
    isMinor: false,
    assistantTurns: 3,
    followUpCount: 0,
    lastAssistantAt: new Date("2026-10-16T10:00:00Z"),
    convertedAt: null,
    persona: { gender: "F", followUpAfterHours: 24, followUpsMax: 2 },
    bot: { isActive: true },
    ...over,
  };
}

/** Transaction minimale pour `stageOnReopen`. */
const txWith = (fromStage: string | null) => ({
  conversationEvent: {
    findFirst: vi.fn(async () => (fromStage === null ? null : { fromStage })),
  },
});

beforeEach(() => {
  vi.mocked(audit).mockClear();
  m.conv = closedConversation();
  m.lastClose = { fromStage: "LINK_SENT" };
  m.updates.length = 0;
  m.events.length = 0;
  m.eventQueries.length = 0;
});

describe("étape à la réouverture par l'équipe", () => {
  it("sans inscription : l'étape d'avant la fermeture", async () => {
    const c = closedConversation();
    expect(await stageOnReopen(txWith("LINK_SENT") as never, c as never)).toBe("LINK_SENT");
    expect(await stageOnReopen(txWith(null) as never, c as never)).toBe("CHAT");
  });

  it("inscription déjà comptée (même pendant la fermeture) : « Inscrit », sans relire les étapes", async () => {
    const tx = txWith("LINK_SENT");
    const c = closedConversation({ convertedAt: CONVERTED_AT });
    expect(await stageOnReopen(tx as never, c as never)).toBe("CONVERTED");
    expect(tx.conversationEvent.findFirst).not.toHaveBeenCalled();
  });

  it("« Prendre la main » sur une conversation inscrite puis fermée : rouverte en « Inscrit »", async () => {
    m.conv = closedConversation({ convertedAt: CONVERTED_AT });
    const r = await takeOverConversation("c1", USER, NOW);
    expect(r.ok).toBe(true);
    expect(m.updates[0]).toMatchObject({
      status: "HUMAN",
      stage: "CONVERTED",
      closedAt: null,
      closedReason: null,
    });
    expect(m.events).toContainEqual(
      expect.objectContaining({ type: "stage_changed", fromStage: "CLOSED", toStage: "CONVERTED" }),
    );
  });

  it("« Rendre à l'assistante » sur une conversation inscrite puis fermée : « Inscrit », aucune relance", async () => {
    m.conv = closedConversation({ convertedAt: CONVERTED_AT });
    const r = await releaseConversation("c1", USER, NOW, {
      lock: async (_id, fn) => ({ busy: false, value: await fn(), locked: true }),
    });
    expect(r.ok).toBe(true);
    expect(m.updates[0]).toMatchObject({ status: "BOT", stage: "CONVERTED", nextFollowUpAt: null });
  });

  it("sans inscription, « Prendre la main » reprend l'étape d'avant la fermeture", async () => {
    const r = await takeOverConversation("c1", USER, NOW);
    expect(r.ok).toBe(true);
    expect(m.updates[0]).toMatchObject({ status: "HUMAN", stage: "LINK_SENT" });
  });
});

describe("« à traiter » (phase 25)", () => {
  const SINCE = new Date("2026-10-18T09:00:00Z");
  const toHandle = (over: Record<string, unknown> = {}) =>
    closedConversation({
      status: "BOT",
      stage: "CHAT",
      closedReason: null,
      needsHumanAt: SINCE,
      needsHumanReason: "reclamation",
      ...over,
    });

  it("« Prendre la main » efface le repère, motif gardé dans le journal de la conversation", async () => {
    m.conv = toHandle();
    const r = await takeOverConversation("c1", USER, NOW);
    expect(r.ok).toBe(true);
    expect(m.updates[0]).toMatchObject({
      status: "HUMAN",
      needsHumanAt: null,
      needsHumanReason: null,
    });
    expect(m.events).toContainEqual(
      expect.objectContaining({
        type: "needs_human_cleared",
        payload: expect.objectContaining({ reason: "reclamation", via: "button" }),
      }),
    );
    expect(vi.mocked(audit).mock.calls[0]?.[0]).toMatchObject({
      action: "conversation.taken_over",
      metadata: { needsHumanCleared: "reclamation" },
    });
  });

  it("« Prendre la main » sans repère : rien d'autre n'est effacé", async () => {
    m.conv = toHandle({ needsHumanAt: null, needsHumanReason: null });
    await takeOverConversation("c1", USER, NOW);
    expect(m.updates[0]).not.toHaveProperty("needsHumanAt");
    expect(m.events.map((e) => e.type)).toEqual(["taken_over"]);
  });

  it("écrire alors que l'équipe a déjà la main efface aussi le repère", async () => {
    m.conv = toHandle({ status: "HUMAN" });
    vi.mocked(enqueueDm).mockResolvedValueOnce({ outboundMessageId: "o1" } as never);
    const r = await sendTeamMessage("c1", USER, "Bonjour, je regarde ça.", NOW);
    expect(r.ok).toBe(true);
    expect(m.updates).toEqual([{ needsHumanAt: null, needsHumanReason: null }]);
    expect(m.events.map((e) => e.type)).toEqual(["needs_human_cleared"]);
  });

  it("« Marquer comme traitée » : seulement le repère, journalisé (conversation.needs_human_cleared)", async () => {
    m.conv = toHandle({ status: "CLOSED", stage: "CLOSED", closedReason: "MINOR", isMinor: true });
    const r = await clearNeedsHuman("c1", USER, NOW);
    expect(r).toEqual({ ok: true, message: "Conversation marquée comme traitée." });
    expect(m.updates).toEqual([{ needsHumanAt: null, needsHumanReason: null }]);
    expect(vi.mocked(audit)).toHaveBeenCalledWith({
      userId: "u1",
      action: "conversation.needs_human_cleared",
      entityType: "Conversation",
      entityId: "c1",
      metadata: { reason: "reclamation", since: SINCE.toISOString() },
    });
  });

  it("« Marquer comme traitée » déjà traitée : aucune écriture ni journal", async () => {
    m.conv = toHandle({ needsHumanAt: null, needsHumanReason: null });
    const r = await clearNeedsHuman("c1", USER, NOW);
    expect(r).toEqual({ ok: true, message: "Cette conversation n'était plus à traiter." });
    expect(m.updates).toEqual([]);
    expect(vi.mocked(audit)).not.toHaveBeenCalled();
  });

  it("conversation disparue : refus", async () => {
    m.conv = null;
    const r = await clearNeedsHuman("c1", USER, NOW);
    expect(r.ok).toBe(false);
  });
});

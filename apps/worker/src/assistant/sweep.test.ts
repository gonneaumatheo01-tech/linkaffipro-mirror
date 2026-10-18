import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const h = vi.hoisted(() => {
  class RedisLockBusy extends Error {}
  const state = {
    activation: "all",
    stuck: [] as Array<{ conversationId: string; turnId: string }>,
    lockedConversations: new Set<string>(),
    outByTurn: {} as Record<string, number>,
    conversions: [] as Row[],
    unclaimed: [] as Row[],
    retries: [] as Row[],
    followUps: [] as Row[],
    teamIds: new Set<string>(),
    enqueued: [] as string[],
    released: [] as string[],
    releaseMax: [] as number[],
    done: [] as string[],
    casCount: 1,
    updateMany: [] as Row[],
    events: [] as Row[],
    findManyWheres: [] as Row[],
  };
  const prisma = {
    $queryRaw: vi.fn(async () => state.stuck),
    conversationMessage: {
      count: vi.fn(
        async ({ where }: { where: { turnId: string } }) => state.outByTurn[where.turnId] ?? 0,
      ),
    },
    conversation: {
      findMany: vi.fn(async ({ where }: { where: Row }) => {
        state.findManyWheres.push(where);
        if ("convertedAt" in where) return state.conversions;
        if ("messages" in where) return state.unclaimed;
        if ("retryAt" in where) return state.retries;
        if ("nextFollowUpAt" in where) return state.followUps;
        return [];
      }),
      updateMany: vi.fn(async (args: Row) => {
        state.updateMany.push(args);
        return { count: state.casCount };
      }),
    },
  };
  return { state, prisma, RedisLockBusy };
});

vi.mock("@linkaffipro/db", () => ({ prisma: h.prisma }));
vi.mock("@linkaffipro/queue", () => ({
  RedisLockBusy: h.RedisLockBusy,
  getRedis: () => ({}),
  withRedisLock: vi.fn(async (_r: unknown, key: string, fn: () => Promise<unknown>) => {
    if (h.state.lockedConversations.has(key.replace("chat:lock:", "")))
      throw new h.RedisLockBusy("pris");
    return fn();
  }),
  enqueueChatTurn: vi.fn(async (id: string) => {
    h.state.enqueued.push(id);
  }),
}));
vi.mock("@linkaffipro/telegram", () => ({
  isAssistantTeamMember: vi.fn(async (tg: bigint) => h.state.teamIds.has(String(tg))),
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("./settings", () => ({
  loadAssistantSettings: vi.fn(async () => ({
    config: { activation: h.state.activation },
    apiKey: null,
  })),
}));
vi.mock("./claim", () => ({
  releaseCrashedTurn: vi.fn(async (turnId: string, max: number) => {
    h.state.released.push(turnId);
    h.state.releaseMax.push(max);
    return { released: 1, gaveUp: 0 };
  }),
  markTurnDone: vi.fn(async (turnId: string) => {
    h.state.done.push(turnId);
    return 1;
  }),
}));
vi.mock("./events", () => ({
  recordConversationEvent: vi.fn(async (_c: Row, input: Row) => {
    h.state.events.push(input);
  }),
}));

import { runChatSweep } from "./sweep";

const NOW = new Date("2026-10-18T10:00:00Z");
const conv = (id: string, tg = 1n) => ({ id, member: { telegramUserId: tg } });

describe("balayage de l'assistant", () => {
  beforeEach(() => {
    Object.assign(h.state, {
      activation: "all",
      stuck: [],
      outByTurn: {},
      conversions: [],
      unclaimed: [],
      retries: [],
      followUps: [],
      casCount: 1,
    });
    h.state.lockedConversations.clear();
    h.state.teamIds.clear();
    for (const k of [
      "enqueued",
      "released",
      "releaseMax",
      "done",
      "updateMany",
      "events",
      "findManyWheres",
    ] as const)
      h.state[k].length = 0;
  });

  it("tour bloqué rendu ; une partie déjà partie : seulement marqué terminé ; tour en cours : jamais touché", async () => {
    h.state.stuck = [
      { conversationId: "c1", turnId: "t1" },
      { conversationId: "c2", turnId: "t2" },
      { conversationId: "c3", turnId: "t3" },
    ];
    h.state.outByTurn = { t2: 1 };
    h.state.lockedConversations.add("c3");
    const r = await runChatSweep(NOW);
    expect(r.stuckReleased).toBe(1);
    expect(h.state.released).toEqual(["t1"]);
    // Compteur partagé avec les tours plantés : un message qui bloque toujours finit abandonné (jamais de boucle).
    expect(h.state.releaseMax).toEqual([2]);
    expect(h.state.done).toEqual(["t2"]);
    expect(h.state.enqueued).toEqual(["c1"]);
  });

  it("assistant désactivé : ni réponse ni relance relancées, mais les conversions sont toujours comptées", async () => {
    h.state.activation = "off";
    h.state.unclaimed = [conv("u1")];
    h.state.followUps = [conv("f1")];
    h.state.conversions = [{ id: "k1", botId: "b", memberId: "m", stage: "LINK_SENT" }];
    const r = await runChatSweep(NOW);
    expect(r).toMatchObject({ converted: 1, unclaimed: 0, followUps: 0 });
    expect(h.state.enqueued).toEqual([]);
  });

  it("conversion : étape CONVERTED une seule fois (comparaison-échange), événements de passage et de conversion", async () => {
    h.state.activation = "off";
    h.state.conversions = [
      { id: "k1", botId: "b", memberId: "m", stage: "LINK_SENT" },
      { id: "k2", botId: "b", memberId: "m", stage: "CLOSED" },
    ];
    await runChatSweep(NOW);
    expect(h.state.updateMany[0]).toEqual({
      where: { id: "k1", convertedAt: null },
      data: { convertedAt: NOW, stage: "CONVERTED", nextFollowUpAt: null },
    });
    // Conversation fermée (/stop après le clic) : conversion comptée, l'étape reste FERMÉ.
    expect(h.state.updateMany[1]).toEqual({
      where: { id: "k2", convertedAt: null },
      data: { convertedAt: NOW },
    });
    expect(h.state.events.map((e) => e.type)).toEqual(["stage_changed", "converted", "converted"]);
    h.state.events.length = 0;
    h.state.casCount = 0;
    await runChatSweep(NOW);
    expect(h.state.events).toEqual([]);
  });

  it("messages non traités, nouvel essai et relances : une seule tâche par conversation", async () => {
    h.state.unclaimed = [conv("a"), conv("b")];
    h.state.retries = [conv("b"), conv("c")];
    h.state.followUps = [conv("c"), conv("d")];
    const r = await runChatSweep(NOW);
    expect(h.state.enqueued).toEqual(["a", "b", "c", "d"]);
    expect(r).toMatchObject({ unclaimed: 2, retries: 1, followUps: 1 });
    const unclaimedWhere = h.state.findManyWheres.find((w) => "messages" in w) as Row;
    expect(unclaimedWhere).toMatchObject({
      status: "BOT",
      stoppedAt: null,
      isMinor: false,
      bot: { mode: "ASSISTANT", isActive: true },
      messages: {
        some: {
          direction: "IN",
          turnId: null,
          createdAt: { lt: new Date("2026-10-18T09:59:00Z"), gt: new Date("2026-10-17T10:00:00Z") },
        },
      },
    });
  });

  it("activation « équipe » : seulement les comptes de l'équipe sont repris", async () => {
    h.state.activation = "team";
    h.state.teamIds.add("7");
    h.state.unclaimed = [conv("x", 7n), conv("y", 8n)];
    await runChatSweep(NOW);
    expect(h.state.enqueued).toEqual(["x"]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

// Lectures de la page Ordres et de l'encart de la fiche canal (phase 33). Base simulée.
const m = vi.hoisted(() => ({
  orders: [] as unknown[],
  order: null as unknown,
  overrides: [] as unknown[],
  calls: {} as Record<string, unknown>,
}));

vi.mock("@linkaffipro/db", () => ({
  prisma: {
    teamOrder: {
      findMany: vi.fn(async (a: unknown) => {
        m.calls.list = a;
        return m.orders;
      }),
      count: vi.fn(async () => m.orders.length),
      findUnique: vi.fn(async () => m.order),
    },
    channel: { findMany: vi.fn(async () => [{ id: "test", title: "Canal Test", vertical: "DATING" }, { id: "ch1", title: "Roulette", vertical: "CASINO" }]) },
    betCategory: { findMany: vi.fn(async () => [{ id: "cat1", name: "Hors-jeux" }]) },
    persona: { findMany: vi.fn(async () => []) },
    user: { findUnique: vi.fn(async () => ({ name: "Matheo" })) },
    event: {
      findMany: vi.fn(async (a: unknown) => {
        m.calls.events = a;
        return [{ type: "agents.order.started", occurredAt: new Date("2026-10-25T08:01:00Z"), payload: { orderId: "o1" } }];
      }),
    },
    auditLog: { findMany: vi.fn(async () => [{ action: "agents.order_extended", createdAt: new Date(), metadata: { days: 2 }, user: { name: "Matheo" } }]) },
    channelPlanOverride: {
      findMany: vi.fn(async (a: unknown) => {
        m.calls.overrides = a;
        return m.overrides;
      }),
    },
  },
}));

import { loadChannelOrderOverrides, loadOrderDetail, loadOrdersList } from "./orders-queries";

const plan = { teamKey: "sports", asIfTeamKey: "sports", scope: { test: true }, period: { start: "2026-10-25", days: 3 }, mode: "simulation", steps: [], resolved: {} };

beforeEach(() => {
  m.calls = {};
  m.orders = [
    {
      id: "o1",
      number: 12,
      status: "RUNNING",
      kind: "WHAT_IF",
      teamKey: "sports",
      requestText: "programme les paris",
      interpretation: plan,
      progress: { missionsPlanned: 6, missionsDone: 1 },
      startsAt: null,
      endsAt: null,
      costCents: 0,
      createdAt: new Date("2026-10-25T08:00:00Z"),
      missions: [
        { status: "DONE", costCents: 4 },
        { status: "DONE", costCents: 6 },
      ],
      overrides: [{ channelId: "test", isTest: true }],
    },
  ];
});

describe("liste des ordres", () => {
  it("filtres passés à la base, canal, période, progression, coût", async () => {
    const { rows, total } = await loadOrdersList({ team: "sports", status: "RUNNING" });
    expect(total).toBe(1);
    expect((m.calls.list as { where: unknown }).where).toEqual({ teamKey: "sports", status: "RUNNING" });
    expect(rows[0]).toMatchObject({
      number: 12,
      channels: ["Canal Test"],
      test: true,
      asIfTeamKey: "sports",
      mode: "simulation",
      period: { from: "2026-10-25", to: "2026-10-27", days: 3 },
      figures: { planned: 6, done: 2, failed: 0, waiting: 0 },
      costCents: 10,
    });
  });
});

describe("fiche d'un ordre", () => {
  it("absente → null", async () => {
    m.order = null;
    expect(await loadOrderDetail("x")).toBeNull();
  });

  it("noms, chronologie (journal filtré sur l'ordre), créateur", async () => {
    m.order = {
      ...(m.orders[0] as object),
      recap: "ligne 1\nligne 2",
      impossible: [{ part: "hors-jeux", reason: "pas de cote", alternatives: [{ label: "corners" }] }],
      createdById: "u1",
      chatId: "123",
      updatedAt: new Date(),
      missions: [],
      overrides: [{ id: "ov1", channelId: "test", teamKey: "sports", fromDay: "2026-10-25", toDay: "2026-10-27", betCategoryId: "cat1", personaId: null, isTest: true, closedAt: null }],
    };
    const d = await loadOrderDetail("o1");
    expect(d).toMatchObject({ number: 12, createdByName: "Matheo", fromTelegram: true });
    expect(d!.names.categories.get("cat1")).toBe("Hors-jeux");
    expect(d!.channelTeams.get("test")).toBe("dating");
    expect(d!.impossible[0]!.alternatives).toEqual(["corners"]);
    expect(d!.events).toHaveLength(1);
    expect(d!.audits[0]).toMatchObject({ action: "agents.order_extended", userName: "Matheo" });
    expect(JSON.stringify((m.calls.events as { where: unknown }).where)).toContain('"equals":"o1"');
  });
});

describe("encart de la fiche canal", () => {
  it("cherche les réglages actifs aujourd'hui (jour de Paris), ordres vivants seulement", async () => {
    m.overrides = [{ id: "ov1", orderId: "o1", toDay: "2026-10-27", teamKey: "sports", isTest: true, order: { number: 12, status: "RUNNING" } }];
    const rows = await loadChannelOrderOverrides("test", new Date("2026-10-25T23:30:00Z"));
    const where = (m.calls.overrides as { where: Record<string, unknown> }).where;
    // 23 h 30 UTC = 1 h 30 le 26 à Paris.
    expect(where).toMatchObject({ channelId: "test", closedAt: null, fromDay: { lte: "2026-10-26" }, toDay: { gte: "2026-10-26" } });
    expect(JSON.stringify(where)).toContain("RUNNING");
    expect(rows).toEqual([{ id: "ov1", orderId: "o1", orderNumber: 12, orderStatus: "RUNNING", toDay: "2026-10-27", teamKey: "sports", isTest: true }]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

// Coût de l'IA des Chiffres de l'assistant (`costsBetween`) : groupé par persona et par source copiées sur chaque coût,
// sans jamais relire la conversation (elle peut avoir été supprimée) ; hors « Tester ».
const m = vi.hoisted(() => ({
  groupByArgs: [] as unknown[],
  groups: [] as Array<{
    personaId: string | null;
    source: string | null;
    _sum: { costEur: unknown };
  }>,
  conversationRead: vi.fn(async () => {
    throw new Error("la conversation ne doit pas être relue");
  }),
}));

vi.mock("@linkaffipro/db", () => ({
  Prisma: { join: vi.fn() },
  ourPlayers: vi.fn(async () => ({})),
  prisma: {
    aiConversationUsage: {
      groupBy: vi.fn(async (args: unknown) => {
        m.groupByArgs.push(args);
        return m.groups;
      }),
    },
    conversation: { findMany: m.conversationRead, findUnique: m.conversationRead },
  },
}));

import { costsBetween } from "./stats-queries";
import { aggregateConversationStats } from "./stats";

const START = new Date("2026-10-01T00:00:00Z");
const END = new Date("2026-10-18T00:00:00Z");

beforeEach(() => {
  m.groupByArgs.length = 0;
  m.groups = [];
  m.conversationRead.mockClear();
});

describe("coût de l'IA par persona et par source", () => {
  it("groupé par (persona, source) des coûts enregistrés, sur la période, sans les essais « Tester »", async () => {
    await costsBetween(START, END);
    expect(m.groupByArgs).toEqual([
      {
        by: ["personaId", "source"],
        where: { createdAt: { gte: START, lt: END }, purpose: { not: "TEST" } },
        _sum: { costEur: true },
      },
    ]);
  });

  it("conversation supprimée : son coût reste compté avec sa source, la conversation n'est jamais relue", async () => {
    m.groups = [
      { personaId: "p1", source: "tk01", _sum: { costEur: "0.1250" } },
      { personaId: "p1", source: null, _sum: { costEur: 0.05 } },
      // Persona supprimée depuis : coût gardé, sans persona, avec sa source.
      { personaId: null, source: "ig02", _sum: { costEur: "0.0200" } },
      { personaId: "p2", source: "tk01", _sum: { costEur: null } },
    ];
    const costs = await costsBetween(START, END);
    expect(costs).toEqual([
      { personaId: "p1", source: "tk01", costEur: 0.125 },
      { personaId: "p1", source: null, costEur: 0.05 },
      { personaId: null, source: "ig02", costEur: 0.02 },
      { personaId: "p2", source: "tk01", costEur: 0 },
    ]);
    expect(m.conversationRead).not.toHaveBeenCalled();
    // Rangé sous sa source dans les Chiffres, même sans aucune conversation de la période.
    const stats = aggregateConversationStats({
      conversations: [],
      linksSent: [],
      linksOpened: [],
      players: [],
      costs,
      personaNames: { p1: "Léa" },
    });
    expect(stats.total.costEur).toBeCloseTo(0.195, 6);
    const tk01 = stats.bySource.find((r) => r.key === "tk01");
    expect(tk01?.costEur).toBeCloseTo(0.125, 6);
  });
});

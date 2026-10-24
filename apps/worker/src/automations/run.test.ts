import { describe, expect, it, vi } from "vitest";

// Relance « inactifs » (phase 17) : jamais vers une personne qui n'a parlé qu'à un bot assistant de conversation.
const h = vi.hoisted(() => ({ wheres: [] as unknown[] }));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    automationRule: {
      findMany: vi.fn(async () => [{ id: "r1", conditions: { inactiveDays: 7 } }]),
    },
    member: {
      findMany: vi.fn(async ({ where }: { where: unknown }) => {
        h.wheres.push(where);
        return [];
      }),
    },
  },
  recordEvent: vi.fn(),
  toJsonValue: (v: unknown) => v,
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("./context", () => ({ buildMemberContext: vi.fn(), graphConditionEvaluator: vi.fn() }));
vi.mock("./executor", () => ({ prismaExecutor: {} }));
vi.mock("./graph-engine", () => ({ executeGraph: vi.fn() }));

import { inactiveCandidatesWhere, sweepInactive } from "./run";

describe("relance INACTIVE : candidats", () => {
  it("joignables seulement par un bot normal actif (jamais un membre qui n'a démarré que l'assistant)", async () => {
    const now = new Date("2026-10-18T10:00:00Z");
    await sweepInactive(now);
    expect(h.wheres[0]).toEqual(inactiveCandidatesWhere("r1", new Date("2026-10-11T10:00:00Z")));
    expect(inactiveCandidatesWhere("r1", now).botStates.some).toEqual({
      canDm: true,
      startedAt: { not: null },
      blockedAt: null,
      bot: { mode: "STANDARD", isActive: true, role: "CHANNEL" },
    });
  });
});

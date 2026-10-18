/**
 * Rappel « rejoins les canaux » (phase 17) : jamais par un bot devenu assistant de conversation (il n'a plus le bouton
 * « ✅ J'ai rejoint ») ; le bot qui agit pour le canal le remplace.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findFirst: vi.fn(async (_args: unknown): Promise<unknown> => null),
  acting: vi.fn(async (_channelId: string): Promise<unknown> => null),
}));

vi.mock("@linkaffipro/db", () => ({
  prisma: { bot: { findFirst: m.findFirst } },
  recordEvent: vi.fn(),
  toJsonValue: (v: unknown) => v,
}));
vi.mock("@linkaffipro/queue", () => ({ emitLinkaffiEvent: vi.fn(), enqueueDm: vi.fn() }));
vi.mock("@linkaffipro/telegram", () => ({ createPrismaGateLinkDeps: () => ({}) }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("./telegram-actions", () => ({
  actingBotFor: m.acting,
  apiForBot: vi.fn(),
  approveMembership: vi.fn(),
  declineMembership: vi.fn(),
}));

import { reminderBotId } from "./jobs";

beforeEach(() => {
  m.findFirst.mockReset();
  m.acting.mockReset();
  m.findFirst.mockResolvedValue(null);
  m.acting.mockResolvedValue({ id: "normal" });
});

describe("bot qui écrit le rappel d'une demande", () => {
  it("bot de la demande encore actif et normal : c'est lui", async () => {
    m.findFirst.mockResolvedValue({ id: "b1" });
    expect(await reminderBotId("b1", "c1")).toBe("b1");
    expect(m.findFirst.mock.calls[0]![0]).toMatchObject({
      where: { id: "b1", isActive: true, mode: "STANDARD" },
    });
    expect(m.acting).not.toHaveBeenCalled();
  });

  it("bot de la demande devenu assistant (ou désactivé) : le bot qui agit pour le canal", async () => {
    expect(await reminderBotId("assistant", "c1")).toBe("normal");
    expect(m.acting).toHaveBeenCalledWith("c1");
  });

  it("aucun bot normal pour le canal : aucun rappel", async () => {
    m.acting.mockResolvedValue(null);
    expect(await reminderBotId("assistant", "c1")).toBeNull();
  });
});

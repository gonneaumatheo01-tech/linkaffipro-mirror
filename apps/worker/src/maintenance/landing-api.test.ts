/**
 * Liens des pages d'atterrissage (phase 17) : un lien créé par un bot devenu assistant de conversation reste révocable
 * (Telegram ne laisse révoquer un lien que par le bot qui l'a créé) ; seul un bot désactivé ou inconnu ne s'ouvre pas.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findFirst: vi.fn(async (_args: unknown): Promise<unknown> => null),
}));

vi.mock("@linkaffipro/db", () => ({ prisma: { bot: { findFirst: m.findFirst } } }));
vi.mock("@linkaffipro/queue", () => ({ enqueue: vi.fn() }));
vi.mock("@linkaffipro/telegram", () => ({
  createPrismaLandingDeps: vi.fn(),
  landingApiOf: (api: unknown) => ({ wrapped: api }),
  refreshLandingChatsWithDb: vi.fn(),
  retryMissingLandingLinksWithDb: vi.fn(),
  revokeDetachedLandingLinksWithDb: vi.fn(),
  syncLandingAdLinksWithDb: vi.fn(),
}));
vi.mock("../approvals/telegram-actions", () => ({
  apiForBot: (bot: { id: string }) => ({ botId: bot.id }),
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { workerLandingApi } from "./landing";

beforeEach(() => m.findFirst.mockReset());

describe("bot qui ouvre l'API pour les liens des pages", () => {
  it("bot actif, quel que soit son mode (révocation par le bot créateur, même assistant)", async () => {
    m.findFirst.mockResolvedValue({ id: "lea", tokenEncrypted: "x" });
    expect(await workerLandingApi("lea")).toEqual({ wrapped: { botId: "lea" } });
    expect(m.findFirst.mock.calls[0]![0]).toEqual({
      where: { id: "lea", isActive: true, role: "CHANNEL" },
      select: { id: true, tokenEncrypted: true },
    });
  });

  it("bot désactivé ou inconnu : rien", async () => {
    m.findFirst.mockResolvedValue(null);
    expect(await workerLandingApi("parti")).toBeNull();
  });
});

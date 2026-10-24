import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  channel: vi.fn(async (_args: unknown): Promise<unknown> => null),
  admins: vi.fn(async (_args: unknown): Promise<unknown[]> => []),
}));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    channel: { findUnique: db.channel },
    channelBotAdmin: { findMany: db.admins },
  },
}));

import { actingStandardBotFor } from "./acting-bot";

// Bot qui agit pour un canal côté site : même choix que le webhook, jamais un assistant de conversation (phase 17).

const admin = (id: string) => ({ botId: id, bot: { id, username: `${id}_bot` } });

beforeEach(() => {
  db.channel.mockReset();
  db.admins.mockReset();
  db.channel.mockResolvedValue({ primaryBotId: null });
  db.admins.mockResolvedValue([]);
});

describe("bot qui agit pour un canal (site)", () => {
  it("bot principal administrateur d'abord, sinon le plus ancien administrateur", async () => {
    db.channel.mockResolvedValue({ primaryBotId: "b2" });
    db.admins.mockResolvedValue([admin("b1"), admin("b2")]);
    expect((await actingStandardBotFor("c1"))?.id).toBe("b2");
    db.channel.mockResolvedValue({ primaryBotId: "parti" });
    expect((await actingStandardBotFor("c1"))?.id).toBe("b1");
  });

  it("aucun administrateur normal et actif : aucun bot", async () => {
    expect(await actingStandardBotFor("c1")).toBeNull();
  });

  it("la base ne lit que les bots normaux et actifs, dans le même ordre que le webhook (date, puis identifiant)", async () => {
    await actingStandardBotFor("c1");
    const args = db.admins.mock.calls[0]![0] as { where: unknown; orderBy: unknown };
    expect(args.where).toEqual({
      channelId: "c1",
      revokedAt: null,
      bot: { isActive: true, mode: "STANDARD", role: "CHANNEL" },
    });
    expect(args.orderBy).toEqual([{ detectedAt: "asc" }, { id: "asc" }]);
  });
});

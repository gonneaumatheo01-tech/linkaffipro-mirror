import { describe, expect, it, vi } from "vitest";

type W = {
  subIdSource?: string;
  subId?: null;
  createdAt?: unknown;
  registeredAt?: { gte?: Date };
  affiliateCampaignId?: { in: string[] };
};
const db = vi.hoisted(() => ({
  prisma: {
    player: { count: vi.fn(async (_args: { where: W }) => 0) },
    click: { count: vi.fn(async () => 4) },
    trackingLink: { findMany: vi.fn(async () => [{ affiliateCampaignId: "aff1" }]) },
  },
}));
vi.mock("@linkaffipro/db", () => ({ prisma: db.prisma }));

import { computeSubIdHealth } from "./sub-id-health";

describe("santé du sub-ID (Réglages → Connecteurs)", () => {
  it("compte les joueurs à leur date d'inscription Link Affi, pas à la date d'import", async () => {
    // Joueur importé aujourd'hui (createdAt) mais inscrit il y a 60 jours (registeredAt) : il ne compte pas.
    db.prisma.player.count.mockImplementation(async ({ where }: { where: W }) =>
      where.createdAt ? 10 : 0,
    );
    const now = new Date("2026-10-09T12:00:00Z");
    const h = await computeSubIdHealth(now);
    expect(h).toMatchObject({ postback: 0, timeMatch: 0, missingWithClicks: 0, offerClicks: 4 });
    for (const [args] of db.prisma.player.count.mock.calls) {
      expect(args.where.createdAt).toBeUndefined();
      expect(args.where.registeredAt?.gte).toEqual(new Date("2026-10-02T12:00:00Z"));
    }
    expect(db.prisma.player.count).toHaveBeenCalledTimes(3);
  });
});

/**
 * Lectures de la page Campagnes en cartes : requêtes envoyées à la base (Prisma simulé) et réutilisation du calcul
 * existant du total (`totalsForScopes`, simulé ici : il est testé dans queries.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  dailyStat: { findMany: vi.fn() },
  campaign: { findMany: vi.fn() },
}));
const totals = vi.hoisted(() => ({ totalsForScopes: vi.fn() }));
vi.mock("@linkaffipro/db", () => ({ prisma: db }));
vi.mock("@/lib/dashboard/cache", () => ({ cachedDashboard: <T>(_n: string, fn: T) => fn }));
vi.mock("./queries", () => ({ campaignScopeInclude: { inviteLinks: true }, ...totals }));

import { resolvePeriod } from "@/lib/periods";
import {
  loadCampaignTrends,
  loadCampaignTrendsUncached,
  totalForCampaigns,
  totalForCampaignsUncached,
} from "./card-queries";

const NOW = new Date("2026-10-09T10:00:00Z");
const period = resolvePeriod({ range: "7d" }, NOW);
const zero = {
  spend: 0,
  members: 0,
  registrations: 0,
  ftds: 0,
  revenue: 0,
  entryClicks: 0,
  offerClicks: 0,
  deposits: 0,
  depositAmount: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("mini-tendances lues dans les statistiques journalières", () => {
  it("lit seulement les dimensions campaign:<id> de la période et rend une série par jour", async () => {
    db.dailyStat.findMany.mockResolvedValue([
      {
        dimension: "campaign:c1",
        date: new Date("2026-10-09T00:00:00Z"),
        approved: 4,
        ftds: 1,
        spend: "12.50",
        ngr: "20.00",
      },
    ]);
    const t = await loadCampaignTrendsUncached(["c1", "c2", "c1"], period);
    const where = db.dailyStat.findMany.mock.calls[0]![0].where;
    expect(where.dimension.in).toEqual(["campaign:c1", "campaign:c2"]);
    expect(where.date.gte.toISOString()).toBe("2026-10-03T00:00:00.000Z");
    expect(where.date.lte.toISOString()).toBe("2026-10-09T00:00:00.000Z");
    expect(t.c1!.members).toEqual([0, 0, 0, 0, 0, 0, 4]);
    expect(t.c1!.spend.at(-1)).toBe(12.5);
    expect(t.c1!.profit.at(-1)).toBe(7.5);
    expect(t.c2!.members).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("aucune campagne : aucune requête", async () => {
    expect(await loadCampaignTrendsUncached([], period)).toEqual({});
    expect(db.dailyStat.findMany).not.toHaveBeenCalled();
  });

  it("la version en cache trie les identifiants (même clé quel que soit l'ordre)", async () => {
    db.dailyStat.findMany.mockResolvedValue([]);
    await loadCampaignTrends(["b", "a"], period);
    expect(db.dailyStat.findMany.mock.calls[0]![0].where.dimension.in).toEqual([
      "campaign:a",
      "campaign:b",
    ]);
  });
});

describe("total des campagnes affichées", () => {
  it("réutilise totalsForScopes sur le périmètre des campagnes demandées, sans doublon", async () => {
    db.campaign.findMany.mockResolvedValue([
      {
        id: "c1",
        channelIds: ["ch1"],
        affiliateCampaignIds: ["off1"],
        inviteLinks: [{ id: "il1" }],
        trackingLinks: [{ id: "tl1" }],
        adSets: [],
      },
    ]);
    totals.totalsForScopes.mockResolvedValue({ ...zero, spend: 100, members: 20, revenue: 250 });
    const r = await totalForCampaignsUncached(["c1", "c1"], period, false);
    expect(db.campaign.findMany.mock.calls[0]![0].where).toEqual({ id: { in: ["c1"] } });
    const [items, p] = totals.totalsForScopes.mock.calls[0]!;
    expect(items).toHaveLength(1);
    expect(items[0].campaignId).toBe("c1");
    expect(items[0].scope.affiliateCampaignIds).toEqual(["off1"]);
    expect(items[0].scope.inviteLinkIds).toEqual(["il1"]);
    expect(p).toEqual(period);
    expect(r.total.cpl).toBe(5);
    expect(r.total.profit).toBe(150);
    expect(r.previousTotal).toBeNull();
    expect(totals.totalsForScopes).toHaveBeenCalledTimes(1);
  });

  it("avec comparaison : la période précédente de même longueur", async () => {
    db.campaign.findMany.mockResolvedValue([]);
    totals.totalsForScopes.mockResolvedValue(zero);
    const r = await totalForCampaigns(["c2", "c1"], period, true);
    expect(totals.totalsForScopes).toHaveBeenCalledTimes(2);
    const prev = totals.totalsForScopes.mock.calls[1]![1];
    expect(prev).toMatchObject({ from: "2026-09-26", to: "2026-10-02", days: 7 });
    expect(r.previousTotal).not.toBeNull();
    expect(db.campaign.findMany.mock.calls[0]![0].where.id.in).toEqual(["c1", "c2"]);
  });

  it("aucune campagne : total à zéro sans lire les campagnes", async () => {
    totals.totalsForScopes.mockResolvedValue(zero);
    const r = await totalForCampaignsUncached([], period);
    expect(db.campaign.findMany).not.toHaveBeenCalled();
    expect(r.total.spend).toBe(0);
  });
});

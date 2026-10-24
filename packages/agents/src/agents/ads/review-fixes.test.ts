/** Relecture adverse (phase 25) : plafond IA de 0 €, « Infinity % », commissions par univers sans doublon. */
import { describe, expect, it } from "vitest";
import { buildDaily } from "./build";
import type { AdsDataset } from "./dataset";
import { spendSpikes, type CampaignAlertFigures } from "./alerts";
import { adsLlmAllowed, weeklyFacts } from "./run";
import { defaultAdsThresholds } from "./thresholds";
import type { AdsContext } from "./analysis";
import { addDaysToDay } from "../../rules/time";

describe("Agent Ads : relecture adverse", () => {
  it("plafond IA : absent = sans limite, 0 € = aucun appel", () => {
    expect(adsLlmAllowed(undefined, 10_000)).toBe(true);
    expect(adsLlmAllowed(0, 0)).toBe(false);
    expect(adsLlmAllowed(500, 499)).toBe(true);
    expect(adsLlmAllowed(500, 500)).toBe(false);
  });

  it("dépense anormale : moyenne des 7 jours à 0 → ligne ignorée (jamais « Infinity % »)", () => {
    const row: CampaignAlertFigures = { id: "c1", name: "Casino FR", today: "2026-10-24", spendToday: 40, spendYesterday: 0, avg7: 0, budgetDaily: null, registrations7: 0, prevRegistrations7: 0, spend7: 0, prevSpend7: 0 };
    const found = spendSpikes([row], { spikePct: 50, dropPct: 50, minDailySpend: 0, minRegistrations: 5 });
    expect(found).toEqual([]);
    expect(spendSpikes([{ ...row, avg7: 10 }], { spikePct: 50, dropPct: 50, minDailySpend: 0, minRegistrations: 5 })[0]!.message).toContain("300 %");
  });

  it("semaine : univers lus sur la ligne sans doublon `campaigns:<univers>` ; somme des univers = total", () => {
    const now = new Date("2026-10-24T10:00:00Z");
    const days = Array.from({ length: 7 }, (_, i) => addDaysToDay("2026-10-17", i));
    // Deux campagnes Casino partagent une offre : la part du revenu (30 €/jour) est sur chacune, une seule fois au total.
    const stats = days.flatMap((day) => [
      { dimension: "campaign:c1", day, raw: { spend: 10, commissions: 30 } },
      { dimension: "campaign:c2", day, raw: { spend: 5, commissions: 30 } },
      { dimension: "campaign:c3", day, raw: { spend: 4, commissions: 6 } },
      { dimension: "campaigns:CASINO", day, raw: { spend: 15, commissions: 30 } },
      { dimension: "campaigns:DATING", day, raw: { spend: 4, commissions: 6 } },
      { dimension: "campaigns", day, raw: { spend: 19, commissions: 36 } },
    ]);
    const dataset: AdsDataset = {
      today: "2026-10-24",
      from: "2026-08-29",
      to: "2026-10-24",
      campaigns: [
        { id: "c1", name: "Casino A", vertical: "CASINO", budgetDaily: null, status: "ACTIVE" },
        { id: "c2", name: "Casino B", vertical: "CASINO", budgetDaily: null, status: "ACTIVE" },
        { id: "c3", name: "Rencontres", vertical: "DATING", budgetDaily: null, status: "ACTIVE" },
      ],
      adSets: [],
      ads: [],
      stats,
      costs: [],
      firstSpend: [],
      activeConnections: 0,
    };
    const ctx = { now, dataset, daily: buildDaily(dataset), thresholds: { thresholds: defaultAdsThresholds(null) }, cohorts: [] } as unknown as AdsContext;
    const f = weeklyFacts(ctx, []);
    const casino = f.verticals.find((v) => v.label === "Casino")!;
    expect(casino.spend).toBe(105);
    expect(casino.gains).toBe(7 * 30 - 105);
    const sumGains = f.verticals.reduce((s, v) => s + v.gains, 0);
    const sumSpend = f.verticals.reduce((s, v) => s + v.spend, 0);
    expect(Math.round(sumGains * 100) / 100).toBe(f.gains);
    expect(sumSpend).toBe(f.spend);
  });

  it("semaine : sans ligne par univers (anciens jours), repli sur la somme des campagnes", () => {
    const now = new Date("2026-10-24T10:00:00Z");
    const stats = [{ dimension: "campaign:c1", day: "2026-10-20", raw: { spend: 10, commissions: 25 } }];
    const dataset = { today: "2026-10-24", from: "2026-08-29", to: "2026-10-24", campaigns: [{ id: "c1", name: "A", vertical: "CASINO", budgetDaily: null, status: "ACTIVE" }], adSets: [], ads: [], stats, costs: [], firstSpend: [], activeConnections: 0 } as AdsDataset;
    const ctx = { now, dataset, daily: buildDaily(dataset), thresholds: { thresholds: defaultAdsThresholds(null) }, cohorts: [] } as unknown as AdsContext;
    expect(weeklyFacts(ctx, []).verticals[0]).toMatchObject({ label: "Casino", spend: 10, gains: 15 });
  });
});

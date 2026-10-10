import { describe, expect, it } from "vitest";
import {
  buildCampaignTrends,
  campaignDimension,
  campaignIdOfDimension,
  emptyTrend,
  hasTrend,
} from "./trend";

const days = ["2026-10-07", "2026-10-08", "2026-10-09"];
const row = (dimension: string, date: string, v: Partial<Record<string, number>> = {}) => ({
  dimension,
  date: new Date(`${date}T00:00:00Z`),
  approved: v.approved ?? 0,
  ftds: v.ftds ?? 0,
  spend: v.spend ?? 0,
  ngr: v.ngr ?? 0,
});

describe("mini-tendances des campagnes", () => {
  it("lit l'identifiant d'une dimension campaign:<id> et rien d'autre", () => {
    expect(campaignDimension("c1")).toBe("campaign:c1");
    expect(campaignIdOfDimension("campaign:c1")).toBe("c1");
    expect(campaignIdOfDimension("campaigns")).toBeNull();
    expect(campaignIdOfDimension("campaigns:CASINO")).toBeNull();
    expect(campaignIdOfDimension("campaign:")).toBeNull();
    expect(campaignIdOfDimension("channel:c1")).toBeNull();
  });

  it("donne une série complète par campagne, 0 les jours sans ligne", () => {
    const t = buildCampaignTrends(["c1", "c2"], days, [
      row("campaign:c1", "2026-10-07", { approved: 3, ftds: 1, spend: 10, ngr: 25 }),
      row("campaign:c1", "2026-10-09", { approved: 2, spend: 5.5 }),
    ]);
    expect(t.get("c1")).toEqual({
      members: [3, 0, 2],
      ftds: [1, 0, 0],
      spend: [10, 0, 5.5],
      profit: [15, 0, -5.5],
    });
    expect(t.get("c2")).toEqual(emptyTrend(3));
  });

  it("ignore les jours hors période, les autres dimensions et les campagnes non demandées", () => {
    const t = buildCampaignTrends(["c1"], days, [
      row("campaign:c1", "2026-10-06", { approved: 9 }),
      row("campaigns", "2026-10-07", { approved: 9 }),
      row("campaign:autre", "2026-10-07", { approved: 9 }),
    ]);
    expect(t.get("c1")!.members).toEqual([0, 0, 0]);
    expect(t.has("autre")).toBe(false);
  });

  it("additionne deux lignes du même jour et arrondit les montants au centime", () => {
    const t = buildCampaignTrends(["c1"], days, [
      { ...row("campaign:c1", "2026-10-08", { approved: 1, spend: 0.1, ngr: 0.2 }) },
      { ...row("campaign:c1", "2026-10-08", { approved: 1, spend: 0.2 }), date: "2026-10-08" },
    ]);
    expect(t.get("c1")!.members).toEqual([0, 2, 0]);
    expect(t.get("c1")!.spend).toEqual([0, 0.3, 0]);
    expect(t.get("c1")!.profit).toEqual([0, -0.1, 0]);
  });

  it("une valeur illisible compte pour 0", () => {
    const t = buildCampaignTrends(["c1"], days, [
      { ...row("campaign:c1", "2026-10-07"), spend: Number.NaN, approved: Number.NaN },
    ]);
    expect(t.get("c1")!.spend).toEqual([0, 0, 0]);
    expect(t.get("c1")!.members).toEqual([0, 0, 0]);
  });

  it("ne dessine une courbe qu'avec deux jours et une valeur non nulle", () => {
    expect(hasTrend([0, 0, 0])).toBe(false);
    expect(hasTrend([4])).toBe(false);
    expect(hasTrend(undefined)).toBe(false);
    expect(hasTrend([0, 1])).toBe(true);
    expect(hasTrend([-3, 0])).toBe(true);
    expect(emptyTrend(0).members).toEqual([]);
  });
});

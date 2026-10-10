import { describe, expect, it } from "vitest";
import { groupRows, levelKeyOf, modeFor, needsRefresh, normalizeAdName, splitRange, windowFor } from "./plan";

describe("synchro des pubs : règles pures", () => {
  it("regroupe campagnes, groupes et pubs par identifiant externe", () => {
    const g = groupRows([
      { date: "2026-10-01", campaignExternalId: "c1", campaignName: "Camp", adSetExternalId: "s1", adSetName: "Set", adExternalId: "a1", adName: "Ad 1", spend: 1, currency: "EUR", impressions: 1, clicks: 1 },
      { date: "2026-10-02", campaignExternalId: "c1", campaignName: "Camp renommée", adSetExternalId: "s1", adSetName: "Set", adExternalId: "a2", adName: "Ad 2", spend: 1, currency: "EUR", impressions: 1, clicks: 1 },
      { date: "2026-10-02", campaignExternalId: "c2", campaignName: "Autre", spend: 1, currency: "EUR", impressions: 1, clicks: 1 },
    ]);
    expect(g.campaigns).toEqual([{ externalId: "c1", name: "Camp renommée" }, { externalId: "c2", name: "Autre" }]);
    expect(g.adSets).toHaveLength(1);
    expect(g.ads.map((a) => a.externalId)).toEqual(["a1", "a2"]);
  });
  it("clé de niveau et normalisation des noms", () => {
    expect(levelKeyOf({ adId: "a", adSetId: "s", campaignId: "c" })).toBe("ad:a");
    expect(levelKeyOf({ adSetId: "s", campaignId: "c" })).toBe("adset:s");
    expect(levelKeyOf({ campaignId: "c" })).toBe("campaign:c");
    expect(normalizeAdName("  TT-Casino_FR (Été) ")).toBe("tt casino fr ete");
  });
  it("fenêtres : 3, 28 ou 90 jours jusqu'à aujourd'hui, découpées par 30", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    expect(windowFor("recent", now)).toEqual({ from: "2026-10-08", to: "2026-10-10" });
    expect(windowFor("full", now).from).toBe("2026-09-13");
    expect(windowFor("backfill", now).from).toBe("2026-07-13");
    const chunks = splitRange(windowFor("backfill", now), 30);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ from: "2026-07-13", to: "2026-08-11" });
    expect(chunks[2]!.to).toBe("2026-10-10");
  });
  it("mode selon l'état de la connexion", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    expect(modeFor({ backfilledAt: null, nextFullSyncAt: null }, now)).toBe("backfill");
    expect(modeFor({ backfilledAt: now, nextFullSyncAt: null }, now)).toBe("full");
    expect(modeFor({ backfilledAt: now, nextFullSyncAt: new Date("2026-10-11T03:00:00Z") }, now)).toBe("recent");
    expect(modeFor({ backfilledAt: now, nextFullSyncAt: new Date("2026-10-10T03:00:00Z") }, now)).toBe("full");
  });
  it("renouvellement du jeton sous 7 jours", () => {
    const now = new Date("2026-10-10T00:00:00Z");
    expect(needsRefresh(new Date("2026-10-15T00:00:00Z"), now)).toBe(true);
    expect(needsRefresh(new Date("2026-11-15T00:00:00Z"), now)).toBe(false);
    expect(needsRefresh(null, now)).toBe(false);
  });
});

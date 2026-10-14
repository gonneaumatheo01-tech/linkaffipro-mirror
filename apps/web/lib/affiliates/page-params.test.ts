import { describe, expect, it } from "vitest";
import { affiliatesHref, affiliatesParams, parseAffiliatesFilters } from "./page-params";

const NOW = new Date("2026-10-14T10:00:00Z");

describe("adresse de la page des affiliés", () => {
  it("30 derniers jours par défaut ; période choisie sinon ; canal et affilié lus", () => {
    const f = parseAffiliatesFilters({}, NOW);
    expect(f.period.key).toBe("30d");
    expect(f).toMatchObject({ channelId: "", affiliateId: "" });
    const g = parseAffiliatesFilters({ range: "7d", channelId: "ch1", affiliateId: " aff " }, NOW);
    expect(g.period.key).toBe("7d");
    expect(g).toMatchObject({ channelId: "ch1", affiliateId: "aff" });
    expect(
      parseAffiliatesFilters({ from: "2026-10-01", to: "2026-10-05" }, NOW).period,
    ).toMatchObject({ key: "custom", from: "2026-10-01", to: "2026-10-05" });
  });

  it("liens : période, puis filtres ; un filtre retiré disparaît de l'adresse", () => {
    const f = parseAffiliatesFilters({ range: "7d", channelId: "ch1", affiliateId: "aff" }, NOW);
    expect(affiliatesParams(f)).toEqual({ range: "7d", channelId: "ch1", affiliateId: "aff" });
    expect(affiliatesHref(f, { channelId: "" })).toBe(
      "/campaigns/affiliates?range=7d&affiliateId=aff",
    );
    expect(affiliatesHref(f, {}, "/campaigns/affiliates/export")).toBe(
      "/campaigns/affiliates/export?range=7d&channelId=ch1&affiliateId=aff",
    );
  });
});

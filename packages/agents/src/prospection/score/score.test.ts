/** Phase 31, chantier C — score pur : composantes, plafonds, niveaux, poids. */
import { describe, expect, it } from "vitest";
import type { ScoreInput } from "../contract";
import { audiencePoints, interactionPoints, scoreProspect, viewRatePoints, type ScoreInputExtras } from "./score";
import { DEFAULT_SCORE_SETTINGS } from "./settings";

const S = DEFAULT_SCORE_SETTINGS;

function input(over: Partial<ScoreInput & ScoreInputExtras> = {}): ScoreInput & ScoreInputExtras {
  return {
    kind: "CHANNEL",
    region: "EU",
    countries: ["FR"],
    vertical: "SPORTS",
    contentType: "tips_free",
    regulatoryFlag: null,
    medianViews: 2100,
    subscribers: 17_000,
    viewRate: 0.12,
    reactionRate: 0.01,
    commentRate: null,
    hasPosts: true,
    authenticity: "REAL",
    fakeFlags: [],
    riskFlags: [],
    monetization: { sellsAds: true, pushesAffiliate: true, sellsVip: true },
    competitiveState: "ROTATING",
    contactConfidence: "HIGH",
    offers: [{ id: "o1", brand: "Winamax", vertical: "SPORTS", countries: ["FR", "BE"], dealTypes: { cpa: 100 } }],
    brands: [{ brand: "1xbet" }],
    bestContact: "@admin_pub",
    bestContactLabel: "pub",
    ...over,
  };
}

describe("audience", () => {
  it("paliers exacts et interpolation logarithmique", () => {
    expect(audiencePoints(100)).toBe(5);
    expect(audiencePoints(300)).toBeCloseTo(10);
    expect(audiencePoints(1000)).toBeCloseTo(16);
    expect(audiencePoints(3000)).toBeCloseTo(22);
    expect(audiencePoints(10_000)).toBeCloseTo(27);
    expect(audiencePoints(25_000)).toBe(30);
    expect(audiencePoints(200_000)).toBe(30);
    expect(audiencePoints(50)).toBeCloseTo(2.5);
    expect(audiencePoints(2100)).toBeCloseTo(20.05, 1);
    expect(audiencePoints(null)).toBe(0);
  });
  it("× 0,6 et −8 si canal générique", () => {
    const r = scoreProspect(input({ authenticity: "SUSPECT_GENERIC", medianViews: 25_000 }), S);
    expect(r.breakdown.audience).toBe(18);
    expect(r.breakdown.penalties).toBe(-8);
  });
});

describe("composantes", () => {
  it("cas complet : 20 + 9 + 20 + 14 + 8 + 10 = 81 → A", () => {
    const r = scoreProspect(input(), S);
    expect(r.breakdown).toEqual({ audience: 20, engagement: 9, fit: 20, openness: 14, competition: 8, reach: 10, penalties: 0 });
    expect(r.score).toBe(81);
    expect(r.tier).toBe("A");
    expect(r.status).toBe("QUALIFIED");
    expect(r.matchedOfferId).toBe("o1");
    expect(r.tierReason).toBe("2,1k vues/post, FR, pousse 1xbet (rotatif), contact pub : @admin_pub — A");
  });
  it("engagement : paliers du taux de vue et bonus plafonné à 5", () => {
    expect([0.25, 0.1, 0.05, 0.03, 0.02].map(viewRatePoints)).toEqual([10, 7, 4, 2, 0]);
    expect(interactionPoints(0.05, 0.01)).toBe(5);
    expect(interactionPoints(0.005, 0.001)).toBe(2);
    const r = scoreProspect(input({ hasPosts: false }), S);
    expect(r.breakdown.engagement).toBe(0);
    expect(r.caps.join(" ")).toContain("aperçu sans posts");
  });
  it("adéquation : sans offre, autre pays, règle du pays, actualités", () => {
    const none = scoreProspect(input({ offers: [] }), S);
    expect(none.breakdown.fit).toBe(20);
    expect(none.matchedOfferId).toBeNull();
    expect(none.caps.join(" ")).toContain("aucune offre active");
    expect(scoreProspect(input({ countries: ["IT"] }), S).breakdown.fit).toBe(8);
    expect(scoreProspect(input({ regulatoryFlag: "FR: règle" }), S).breakdown.fit).toBe(14);
    expect(scoreProspect(input({ contentType: "news" }), S).breakdown.fit).toBe(18);
  });
  it("meilleure offre : verticale compatible obligatoire, pays accepté de préférence", () => {
    const offers = [
      { id: "casino", brand: "Casino", vertical: "CASINO" as const, countries: ["FR"], dealTypes: {} },
      { id: "it", brand: "Snai", vertical: "SPORTS" as const, countries: ["IT"], dealTypes: {} },
      { id: "fr", brand: "Winamax", vertical: "BOTH" as const, countries: ["FR"], dealTypes: {} },
    ];
    expect(scoreProspect(input({ offers }), S).matchedOfferId).toBe("fr");
  });
  it("ouverture plafonnée à 15, concurrence, joignabilité", () => {
    expect(scoreProspect(input({ monetization: { sellsAds: true, pushesAffiliate: true, sellsVip: true, marketplaceListing: "https://telega.io/x" } }), S).breakdown.openness).toBe(15);
    expect(scoreProspect(input({ competitiveState: "FREE" }), S).breakdown.competition).toBe(10);
    expect(scoreProspect(input({ competitiveState: "EXCLUSIVE" }), S).breakdown.competition).toBe(3);
    expect(scoreProspect(input({ competitiveState: "OURS" }), S).breakdown.competition).toBe(2);
    expect(scoreProspect(input({ competitiveState: null }), S).breakdown.competition).toBe(5);
    expect(scoreProspect(input({ contactConfidence: "MEDIUM" }), S).breakdown.reach).toBe(6);
    expect(scoreProspect(input({ contactConfidence: "LOW" }), S).breakdown.reach).toBe(3);
  });
  it("pénalités : faux (18 au plus), groupe, gains garantis", () => {
    expect(scoreProspect(input({ fakeFlags: ["SUSPECT_FAKE_SUBS", "SUSPECT_VIEW_BOT", "SUSPECT_BOT_CONTENT", "GROWTH_SPIKE"] }), S).breakdown.penalties).toBe(-18);
    expect(scoreProspect(input({ kind: "GROUP" }), S).breakdown.penalties).toBe(-5);
    expect(scoreProspect(input({ riskFlags: ["GUARANTEED_WINS"] }), S).breakdown.penalties).toBe(-15);
  });
});

describe("plafonds et exclusions", () => {
  it("hors Europe, matchs truqués, robot, transferts → D écarté", () => {
    for (const over of [{ region: "NON_EU" as const }, { riskFlags: ["SCAM_FIXED_MATCHES" as const] }, { authenticity: "SUSPECT_BOT" as const }, { authenticity: "REPOST" as const }]) {
      const r = scoreProspect(input(over), S);
      expect(r.tier).toBe("D");
      expect(r.status).toBe("DISQUALIFIED");
      expect(r.matchedOfferId).toBeNull();
    }
  });
  it("région inconnue : 49 au plus, jamais A ni B", () => {
    const r = scoreProspect(input({ region: "UNKNOWN", medianViews: 50_000, viewRate: 0.3, reactionRate: 0.05 }), S);
    expect(r.score).toBeLessThanOrEqual(49);
    expect(r.tier).toBe("C");
    expect(r.caps.join(" ")).toContain("pays incertain");
  });
  it("2 signaux de faux : jamais A", () => {
    const r = scoreProspect(input({ medianViews: 25_000, viewRate: 0.25, reactionRate: 0.05, commentRate: 0.01, fakeFlags: ["SUSPECT_FAKE_SUBS", "GROWTH_SPIKE"] }), S);
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.tier).toBe("B");
    expect(r.caps.join(" ")).toContain("jamais A");
  });
  it("sans contact : jamais A", () => {
    const r = scoreProspect(input({ contactConfidence: "NONE", bestContact: null }), S);
    expect(r.score).toBe(71);
    expect(r.tier).toBe("B");
    expect(r.tierReason).toContain("sans contact");
  });
  it("niveaux par seuils et D sous le seuil", () => {
    expect(scoreProspect(input({ contactConfidence: "MEDIUM" }), S).tier).toBe("A");
    expect(scoreProspect(input({ medianViews: 120, viewRate: 0.01, reactionRate: null, monetization: null, contactConfidence: "LOW", competitiveState: "EXCLUSIVE" }), S).tier).toBe("D");
  });
});

describe("poids réglables", () => {
  it("chaque composante est mise à l'échelle poids / poids par défaut", () => {
    const r = scoreProspect(input(), { ...S, weights: { ...S.weights, audience: 60, engagement: 0 } });
    expect(r.breakdown.audience).toBe(40);
    expect(r.breakdown.engagement).toBe(0);
    expect(r.score).toBe(92);
  });
  it("seuils réglables", () => {
    expect(scoreProspect(input(), { ...S, tierA: 90 }).tier).toBe("B");
  });
});

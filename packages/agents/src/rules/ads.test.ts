import { describe, expect, it } from "vitest";
import { adsActionFor, adsRecommendations, budgetExhausted, trendOk, type AdsRuleInput } from "./ads";
import { toMetrics, EMPTY_RAW, type AdsRaw } from "../agents/ads/metrics";
import { defaultAdsThresholds } from "../agents/ads/thresholds";

const T = defaultAdsThresholds(null); // 30 € par inscription, retour 1,5, 3 jours, 20 €
const t = T.CASINO;
const m = (p: Partial<AdsRaw>) => toMetrics({ ...EMPTY_RAW, ...p });

function input(p: Partial<AdsRuleInput> = {}): AdsRuleInput {
  return {
    level: "ad",
    id: "a1",
    name: "Vidéo roulette",
    vertical: "CASINO",
    campaignId: "c1",
    campaignName: "Casino FR",
    adSetId: "s1",
    adSetName: "Hommes 25-45",
    ageDays: 10,
    window: m({ spend: 60, registrations: 3, commissions: 60 }),
    windowFrom: "2026-10-21",
    windowTo: "2026-10-23",
    last7: m({ spend: 140, commissions: 140 }),
    prev7: m({ spend: 140, commissions: 140 }),
    spendYesterday: 20,
    budget: { daily: 100, spentYesterday: 40 },
    ...p,
  };
}

describe("règles de l'Agent Ads", () => {
  it("rien à dire : coût et retour dans les clous", () => {
    expect(adsActionFor(input(), t)).toBeNull();
  });

  it("Arrêter : coût par inscription au-dessus du seuil sur 3 jours, avec preuves et seuil", () => {
    const p = adsActionFor(input({ window: m({ spend: 120, registrations: 2, commissions: 20 }) }), t)!;
    expect(p.action).toBe("STOP");
    expect(p.evidence.threshold).toBe(30);
    expect(p.evidence.thresholdName).toBe("targetCostPerRegistration");
    expect(p.evidence.figures.costPerRegistration).toBe(60);
    expect(p.evidence.period).toEqual({ from: "2026-10-21", to: "2026-10-23", days: 3 });
    expect(p.evidence.sentence).toContain("60,00 € par inscription sur 3 jours (seuil : 30,00 €)");
    expect(p.evidence.comparison.previous7.spend).toBe(140);
  });

  it("Arrêter : dépense au-dessus du coût cible sans aucune inscription", () => {
    const p = adsActionFor(input({ window: m({ spend: 45 }) }), t)!;
    expect(p.action).toBe("STOP");
    expect(p.evidence.sentence).toContain("sans aucune inscription");
  });

  it("pas d'arrêt si la pub ne dépense plus, ou si elle rapporte assez malgré le coût", () => {
    expect(adsActionFor(input({ window: m({ spend: 120, registrations: 2, commissions: 20 }), spendYesterday: 0 }), t)).toBeNull();
    expect(adsActionFor(input({ window: m({ spend: 120, registrations: 2, commissions: 400 }) }), t)?.action).toBe("SCALE");
  });

  it("Augmenter : retour au-dessus du minimum, gains positifs, budget non épuisé, tendance stable", () => {
    const p = adsActionFor(input({ window: m({ spend: 60, registrations: 3, commissions: 150 }) }), t)!;
    expect(p.action).toBe("SCALE");
    expect(p.evidence.threshold).toBe(1.5);
    expect(p.evidence.sentence).toContain("Retour sur dépense 2,5 sur 3 jours (minimum : 1,5)");
  });

  it("pas d'augmentation si le budget du jour est épuisé ou si la tendance baisse", () => {
    const good = { window: m({ spend: 60, registrations: 3, commissions: 150 }) };
    expect(adsActionFor(input({ ...good, budget: { daily: 100, spentYesterday: 99 } }), t)).toBeNull();
    expect(adsActionFor(input({ ...good, last7: m({ spend: 100, commissions: 100 }), prev7: m({ spend: 100, commissions: 200 }) }), t)).toBeNull();
    expect(budgetExhausted({ daily: null, spentYesterday: 500 })).toBe(false);
    expect(trendOk(m({ spend: 10, commissions: 20 }), m({}))).toBe(true);
  });

  it("Surveiller : trop jeune ou trop peu de dépense, jamais d'arrêt ni d'augmentation", () => {
    const young = adsActionFor(input({ ageDays: 2, window: m({ spend: 200, commissions: 0 }) }), t)!;
    expect(young.action).toBe("WATCH");
    expect(young.evidence.threshold).toBeNull();
    expect(young.evidence.sentence).toContain("il faut 3 jours et 20,00 €");
    expect(adsActionFor(input({ window: m({ spend: 15, commissions: 100 }) }), t)?.action).toBe("WATCH");
    // Plus aucune dépense depuis 7 jours : rien.
    expect(adsActionFor(input({ ageDays: 1, window: m({}), last7: m({}) }), t)).toBeNull();
  });

  it("Tester : à partir de ce qui marche (autre visuel, même audience ; même visuel, autre audience) ; classement", () => {
    const winner = input({ window: m({ spend: 60, registrations: 3, commissions: 150 }) });
    const loser = input({ id: "a2", name: "Image bonus", window: m({ spend: 120, registrations: 1, commissions: 0 }) });
    const watch = input({ id: "a3", name: "Nouvelle", ageDays: 1 });
    const otherSet = { ...input({ level: "adset", id: "s2", name: "Femmes 25-45", adSetId: "s2" }) };
    const recs = adsRecommendations([winner, loser, watch], T, [winner, loser, watch, otherSet]);
    expect(recs.map((r) => `${r.action}:${r.level}:${r.targetId}`)).toEqual(["STOP:ad:a2", "SCALE:ad:a1", "TEST:adset:s1", "TEST:ad:a1", "WATCH:ad:a3"]);
    const test = recs.find((r) => r.action === "TEST" && r.level === "ad")!;
    expect(test.evidence.sentence).toContain("Femmes 25-45");
    expect(test.evidence.basedOn).toEqual({ id: "a1", name: "Vidéo roulette" });
  });

  it("seuil de coût réglé plus haut : plus d'arrêt", () => {
    const tt = { ...T, CASINO: { ...t, targetCostPerRegistration: 80 } };
    expect(adsRecommendations([input({ window: m({ spend: 120, registrations: 2, commissions: 20 }) })], tt)).toEqual([]);
  });
});

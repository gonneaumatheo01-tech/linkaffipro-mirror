/** Phase 32, chantier B — Valorisateur : formule, fourchette, réductions, confiance, revshare sans ARPU, offre sans montant. */
import { describe, expect, it } from "vitest";
import { createProspectKit } from "../score/prospect-test-kit";
import { DEFAULT_VALUE_SETTINGS, dealFromOffer, dealFromSigned, estimateValue, observedPromoShare, roundEuros, type EstimateInput } from "./estimate";
import { formatValueRange } from "./format";
import { estimateProspectValue, explainProspectValue, pipelineValue, refreshValues } from "./index";
import { segmentLookupKeys, segmentOf } from "./segment";

const NOW = new Date("2026-10-27T08:00:00Z");
const base: EstimateInput = { postsPerDay: 2, medianViews: 2000, promoShareObserved: null, authenticity: "REAL", fakeFlags: [], postsRead: 40, geoConfidence: 0.9, deal: { kind: "cpa", cpa: 100 }, offerId: "o1" };

describe("estimation (pur)", () => {
  it("formule exacte et fourchette × [0,4 ; 1 ; 2,2]", () => {
    const r = estimateValue(base, DEFAULT_VALUE_SETTINGS, null, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 2 × 30 × 2000 × 0,25 = 30 000 vues ; 450 clics ; 45 inscrits ; 13,5 dépôts × 100 € = 1 350 €.
    expect(r.estimate.assumptions.promoReach).toBe(30_000);
    expect(r.estimate.base).toBe(1350);
    expect(r.estimate.low).toBe(540);
    expect(r.estimate.high).toBe(roundEuros(1350 * 2.2));
    expect(r.estimate.calibratedBy).toBe("default");
    expect(r.estimate.confidence).toBe("medium");
  });

  it("réductions : canal générique × 0,6, chaque signal de faux × 0,8", () => {
    const r = estimateValue({ ...base, authenticity: "SUSPECT_GENERIC", fakeFlags: ["SUSPECT_FAKE_SUBS", "SUSPECT_VIEW_BOT"] }, DEFAULT_VALUE_SETTINGS, null, NOW);
    if (!r.ok) throw new Error("attendu");
    expect(r.estimate.base).toBe(roundEuros(1350 * 0.6 * 0.8 * 0.8));
    expect(r.estimate.assumptions.reductions).toHaveLength(3);
  });

  it("confiance : haute seulement calibrée ; faible avec peu de posts et pays douteux", () => {
    const cal = { segment: "SPORTS|FR|*|*", ctrFactor: 1.5, ftdFactor: 1, source: "calibrated" };
    const r = estimateValue(base, DEFAULT_VALUE_SETTINGS, cal, NOW);
    if (!r.ok) throw new Error("attendu");
    expect(r.estimate.confidence).toBe("high");
    expect(r.estimate.calibratedBy).toBe("SPORTS|FR|*|*");
    expect(r.estimate.base).toBe(roundEuros(1350 * 1.5));
    const low = estimateValue({ ...base, postsRead: 5, geoConfidence: 0.3 }, DEFAULT_VALUE_SETTINGS, null, NOW);
    expect(low.ok && low.estimate.confidence).toBe("low");
  });

  it("revshare sans ARPU : absent (jamais inventé) ; hybride : part CPA seule, revshare noté manquant", () => {
    const rs = estimateValue({ ...base, deal: { kind: "revshare", revsharePct: 30 } }, DEFAULT_VALUE_SETTINGS, null, NOW);
    expect(rs.ok).toBe(false);
    if (!rs.ok) expect(rs.missing).toContain("arpu_month");
    const hy = estimateValue({ ...base, deal: { kind: "hybrid", cpa: 50, revsharePct: 15 } }, DEFAULT_VALUE_SETTINGS, null, NOW);
    if (!hy.ok) throw new Error("attendu");
    expect(hy.estimate.base).toBe(roundEuros(13.5 * 50));
    expect(hy.estimate.assumptions.missing).toEqual(["arpu_month"]);
    const withArpu = estimateValue({ ...base, deal: { kind: "revshare", revsharePct: 30 } }, { ...DEFAULT_VALUE_SETTINGS, arpuMonth: 40 }, null, NOW);
    expect(withArpu.ok && withArpu.estimate.base).toBe(roundEuros(13.5 * 40 * 0.3));
  });

  it("offres : formes lues ; type sans montant → pas de valeur, avec raison", () => {
    expect(dealFromOffer({ cpa: 100 })).toEqual({ kind: "cpa", cpa: 100 });
    expect(dealFromOffer({ revshare: 30 })).toEqual({ kind: "revshare", revsharePct: 30 });
    expect(dealFromOffer({ hybrid: { cpa: 50, revshare: 15 } })).toEqual({ kind: "hybrid", cpa: 50, revsharePct: 15 });
    expect(dealFromOffer({ pending: "HYBRID" })).toEqual({ kind: "pending", type: "HYBRID" });
    expect(dealFromSigned("CPA", { cpa: 120 })).toEqual({ kind: "cpa", cpa: 120 });
    const r = estimateValue({ ...base, deal: { kind: "pending", type: "HYBRID" } }, DEFAULT_VALUE_SETTINGS, null, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/sans montant/);
    expect(estimateValue({ ...base, medianViews: null }, DEFAULT_VALUE_SETTINGS, null, NOW).ok).toBe(false);
  });

  it("part promo observée bornée ; segments du plus précis au plus large", () => {
    expect(observedPromoShare([{ brand: "x", links: 10 }], 20)).toBe(0.5);
    expect(observedPromoShare([{ brand: "x", links: 50 }], 20)).toBe(0.8);
    expect(observedPromoShare([], 20)).toBeNull();
    expect(segmentLookupKeys(segmentOf({ vertical: "SPORTS", countries: ["fr"], contentType: "tips_free", tier: "A" }))).toEqual(["SPORTS|FR|tips_free|A", "SPORTS|FR|*|*", "SPORTS|*|*|*"]);
  });

  it("texte : toujours une fourchette, jamais « rapportera »", () => {
    const t = formatValueRange({ low: 210, high: 1150, calibratedBy: "default" });
    expect(t).toBe("210 – 1 150 €/mois estimés, non calibrée");
    expect(t).not.toMatch(/rapportera/);
  });
});

describe("valeur en base", () => {
  it("enregistre, explique l'absence, recalcule, somme du pipeline", async () => {
    const k = createProspectKit(NOW);
    const offer = await k.offer({ dealTypes: { cpa: 100 } });
    const pending = await k.offer({ dealTypes: { pending: "HYBRID" } });
    const a = await k.prospect({ matchedOfferId: offer.id, postsPerDay: 2, medianViews: 2000, status: "NEGOTIATING", brands: [] });
    const b = await k.prospect({ matchedOfferId: pending.id, postsPerDay: 2, medianViews: 2000 });
    const v = await estimateProspectValue(k.deps as never, a.id);
    expect(v?.base).toBeGreaterThan(0);
    expect(await estimateProspectValue(k.deps as never, b.id)).toBeNull();
    expect((await explainProspectValue(k.deps as never, b.id))?.reason).toMatch(/sans montant/);
    await k.prisma.prospectCalibration.create({ data: { segment: "SPORTS|*|*|*", ctrFactor: 2, ftdFactor: 1, source: "calibrated" } as never });
    const r = await refreshValues(k.deps as never, NOW);
    expect(r.updated).toBeGreaterThanOrEqual(1);
    const pv = await pipelineValue(k.deps);
    const neg = pv.byStatus.find((l) => l.status === "NEGOTIATING")!;
    expect(neg.estimated).toBe(1);
    expect(neg.calibration).toBe("all");
    expect(pv.text).toMatch(/En négociation/);
    expect(pv.text).toMatch(/–/);
  });
});

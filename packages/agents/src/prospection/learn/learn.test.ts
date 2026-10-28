/**
 * Phase 32, chantier B — boucle Link Affi : rattachement, résultats réels (champs manquants), ACTIVE au premier dépôt,
 * arrêt proposé jamais posé, calibrage (médiane écrêtée, échantillon minimal, bornes), attribution, application,
 * annulation, suivi. Faux lecteur sur les fixtures, aucun réseau.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { resetVoiceRotation } from "../../boss/voice";
import { applyRecommendationImpl, undoRecommendationImpl } from "../../agents/synthese/apply";
import { createProspectKit } from "../score/prospect-test-kit";
import { DAY_MS } from "../score/settings";
import { estimateProspectValue } from "../value/index";
import { aggregateAffiliateStats, profileNameOf, recentAffiliatesFrom } from "./linkaffi-rows";
import { answerLinkChoice, askLinkAffiId, linkAffiliate, runLinkReminders } from "./link";
import { pullAffiliateResults } from "./pull";
import {
  attribution,
  boundedFactor,
  clippedMedian,
  coefficientProposals,
  proposeCalibration,
  proposeShares,
  proposeWeights,
  withinCoefficientBounds,
  withinWeightBounds,
  DEFAULT_DISCOVERY_SHARES,
  type CalibrationSample,
} from "./calibrate";
import { applyCalibration, listCalibrationChoices, undoCalibration, closeCalibrationExperiments } from "./apply";
import { affiliatePerformance, estimatedVsReal } from "./performance";
import { buildMonthlyReport, sendMonthlyReport } from "./report";
import { createFakeLinkAffiReader, learnFixtures } from "./testing";
import { DEFAULT_VALUE_SETTINGS } from "../value/estimate";
import { PROSPECTION_SETTINGS } from "../contract";

beforeEach(() => resetVoiceRotation());

const NOW = new Date("2026-11-02T08:00:00Z");
const SIGNED_AT = new Date("2026-09-01T00:00:00Z");

async function signedKit() {
  const k = createProspectKit(NOW);
  const reader = createFakeLinkAffiReader();
  (k.deps as Record<string, unknown>).linkAffiReader = reader;
  const offer = await k.offer({ dealTypes: { cpa: 100 } });
  const ids: string[] = [];
  for (const [i, aff] of ["aff-a", "aff-b", "aff-c"].entries()) {
    const p = await k.prospect({ username: `signe_${i}`, status: "SIGNED", signedAt: SIGNED_AT, contactedAt: new Date("2026-08-20T00:00:00Z"), matchedOfferId: offer.id, postsPerDay: 2, medianViews: 2000, contentType: "tips_free", tier: "A", brands: [] });
    await estimateProspectValue(k.deps as never, p.id);
    expect((await linkAffiliate(k.deps as never, p.id, aff, "client")).ok).toBe(true);
    ids.push(p.id);
  }
  return { k, reader, ids };
}

describe("lignes Link Affi (pur)", () => {
  it("agrégats, champ manquant noté, aucune ligne = zéros ; nom seulement", () => {
    const fx = learnFixtures();
    const a = aggregateAffiliateStats(fx.stats["aff-a"]!["2026-09"]!);
    expect(a).toEqual({ clicks: 900, regs: 30, ftd: 3, revenueCents: 13500, missing: [] });
    const c = aggregateAffiliateStats(fx.stats["aff-c"]!["2026-09"]!);
    expect(c.revenueCents).toBeNull();
    expect(c.missing).toEqual(["revenue"]);
    expect(aggregateAffiliateStats([])).toEqual({ clicks: 0, regs: 0, ftd: 0, revenueCents: 0, missing: [] });
    expect(recentAffiliatesFrom(fx.campaigns, 2).map((r) => r.affiliateId)).toEqual(["aff-d", "aff-c"]);
    expect(profileNameOf(fx.profiles[0])).toBe("Pronos Alpha");
    expect(profileNameOf(fx.profiles[2])).toBeNull();
  });
});

describe("rattachement", () => {
  it("signé seulement, un identifiant par prospect, question numérotée puis « 2 »", async () => {
    const k = createProspectKit(NOW);
    (k.deps as Record<string, unknown>).linkAffiReader = createFakeLinkAffiReader();
    const q = await k.prospect({ username: "pas_signe" });
    expect((await linkAffiliate(k.deps as never, q.id, "1234", "client")).ok).toBe(false);
    const s1 = await k.prospect({ username: "un", status: "SIGNED", signedAt: SIGNED_AT });
    const s2 = await k.prospect({ username: "deux", status: "SIGNED", signedAt: SIGNED_AT });
    expect((await linkAffiliate(k.deps as never, s1.id, "affilié 1234", "client")).ok).toBe(true);
    expect((await k.row(s1.id) as unknown as { linkAffiAffiliateId: string }).linkAffiAffiliateId).toBe("1234");
    expect((await linkAffiliate(k.deps as never, s2.id, "1234", "client")).ok).toBe(false);
    expect(k.tables("auditLog").some((a) => a.action === "prospection.linkaffi.linked")).toBe(true);

    const ask = await askLinkAffiId(k.deps as never, s2.id);
    expect(ask?.candidates.map((c) => c.name)).toContain("Pronos Alpha");
    expect(ask?.text).toMatch(/^1\. /m);
    // Aucune autre donnée de `profiles` ne passe.
    expect(JSON.stringify(k.tables("setting"))).not.toMatch(/secret@|iban|FR76|\+336/);
    expect(await answerLinkChoice(k.deps as never, "bonjour")).toBeNull();
    const second = ask!.candidates[1]!.affiliateId;
    expect(await answerLinkChoice(k.deps as never, "2")).toMatch(/rattaché/);
    expect((await k.row(s2.id) as unknown as { linkAffiAffiliateId: string }).linkAffiAffiliateId).toBe(second);
  });

  it("rappel du lundi : une fois par semaine, 3 fois au plus", async () => {
    const k = createProspectKit(NOW);
    const s = await k.prospect({ username: "sans_id", status: "SIGNED", signedAt: SIGNED_AT });
    const sent: number[] = [];
    for (let w = 0; w < 5; w++) {
      sent.push((await runLinkReminders(k.deps as never, k.now())).sent);
      expect((await runLinkReminders(k.deps as never, k.now())).sent).toBe(0);
      k.advance(7 * DAY_MS);
    }
    expect(sent).toEqual([1, 1, 1, 0, 0]);
    expect((await k.row(s.id) as unknown as { linkAffiAskCount: number }).linkAffiAskCount).toBe(3);
  });
});

describe("résultats réels", () => {
  it("AffiliateResult par mois, champ manquant, ACTIVE au premier dépôt", async () => {
    const { k, ids } = await signedKit();
    const r = await pullAffiliateResults(k.deps as never, null);
    expect(r).toMatchObject({ affiliates: 3, rows: 6, activated: 3, configured: true });
    const rows = k.tables("affiliateResult");
    expect(rows).toHaveLength(6);
    const c = rows.find((x) => x.prospectId === ids[2] && x.month === "2026-10")!;
    expect(c.revenueCents).toBeNull();
    expect(c.missing).toEqual(["revenue"]);
    expect((await k.row(ids[0]!)).status).toBe("ACTIVE");
    expect(k.events("STATUS_CHANGED").some((e) => (e.payload as { by?: string }).by === "system")).toBe(true);
  });

  it("sans lecteur : rien lu, « non configuré »", async () => {
    const k = createProspectKit(NOW);
    expect(await pullAffiliateResults(k.deps as never)).toMatchObject({ configured: false, rows: 0 });
  });

  it("60 jours sans clic : arrêt proposé, jamais posé", async () => {
    const k = createProspectKit(NOW);
    (k.deps as Record<string, unknown>).linkAffiReader = createFakeLinkAffiReader({ "aff-z": [{ date: "2026-10-01", clicks: 0, signups: 0, qualified_ftds: 0, revenue: 0 }] });
    const p = await k.prospect({ username: "muet", status: "ACTIVE", signedAt: SIGNED_AT });
    await linkAffiliate(k.deps as never, p.id, "aff-z", "client");
    const r = await pullAffiliateResults(k.deps as never, "2026-10");
    expect(r.churnProposed).toBe(1);
    expect((await k.row(p.id)).status).toBe("ACTIVE");
    expect(k.events("CHURN_PROPOSED")).toHaveLength(1);
    expect((await pullAffiliateResults(k.deps as never, "2026-10")).churnProposed).toBe(0);
  });
});

describe("calibrage (pur)", () => {
  it("médiane écrêtée [0,25 ; 4] et bornes ± 50 %", () => {
    expect(clippedMedian([0.1, 1, 10])).toBe(1);
    expect(clippedMedian([0.01, 0.02, 0.1])).toBe(0.25);
    expect(clippedMedian([9, 10, 20])).toBe(4);
    expect(boundedFactor(1, 3)).toBe(1.5);
    expect(boundedFactor(1, 0.1)).toBe(0.5);
    expect(withinCoefficientBounds(1, 1.5)).toBe(true);
    expect(withinCoefficientBounds(1, 1.6)).toBe(false);
  });

  const sample = (id: string, days: number, clicks: number): CalibrationSample => ({
    prospectId: id,
    handle: id,
    segment: { vertical: "SPORTS", country: "FR", contentType: "tips_free", tier: "A" },
    sourceType: "DIRECTORY",
    days,
    realClicks: clicks,
    realRegs: null,
    realFtd: 1,
    revenueCents: null,
    promoReach: 30_000,
    estimate: null,
    missing: [],
  });
  const cur = () => ({ value: 1, monthBase: 1 });

  it("échantillon minimal : 3 affiliés, 30 jours chacun", () => {
    expect(coefficientProposals([sample("a", 60, 2000), sample("b", 60, 2000)], DEFAULT_VALUE_SETTINGS, cur)).toEqual([]);
    expect(coefficientProposals([sample("a", 60, 2000), sample("b", 60, 2000), sample("c", 29, 2000)], DEFAULT_VALUE_SETTINGS, cur)).toEqual([]);
    const ok = coefficientProposals([sample("a", 60, 2000), sample("b", 60, 2000), sample("c", 30, 1000)], DEFAULT_VALUE_SETTINGS, cur);
    const ctr = ok.find((p) => p.field === "ctrFactor")!;
    expect(ctr.level).toBe("full");
    expect(ctr.after).toBe(1.5);
    expect(ctr.capped).toBe(true);
    // Le groupe large n'apporte personne de plus : pas de doublon.
    expect(ok.filter((p) => p.field === "ctrFactor")).toHaveLength(1);
  });

  it("poids : ± 20 % au plus, somme gardée ; rien sous 3 de chaque côté", () => {
    const w = { ...PROSPECTION_SETTINGS.weights.value };
    const signed = [1, 2, 3].map(() => ({ openness: 14, audience: 15 }));
    const others = [1, 2, 3].map(() => ({ openness: 2, audience: 15 }));
    const p = proposeWeights(signed, others, w, w)!;
    expect(p.component).toBe("openness");
    expect(p.after.openness).toBe(18);
    expect(Object.values(p.after).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5);
    expect(withinWeightBounds(w, p.after)).toBe(true);
    expect(withinWeightBounds(w, { ...w, openness: 19, audience: 26 })).toBe(false);
    expect(proposeWeights(signed.slice(0, 2), others, w, w)).toBeNull();
  });

  it("attribution par source et pays ; parts de la recherche bornées à 20 %", () => {
    const ps = [
      ...[1, 2, 3].map(() => ({ status: "SIGNED", tier: "A", sourceType: "DIRECTORY", countries: ["FR"] })),
      ...[1, 2, 3, 4].map(() => ({ status: "QUALIFIED", tier: "C", sourceType: "SOCIAL", countries: ["IT"] })),
      { status: "DISCOVERED", tier: null, sourceType: "SOCIAL", countries: ["IT"] },
    ];
    const bySource = attribution(ps, "source");
    expect(bySource[0]).toMatchObject({ key: "DIRECTORY", total: 3, signed: 3, tierA: 3 });
    expect(bySource.find((r) => r.key === "SOCIAL")?.total).toBe(4);
    expect(attribution(ps, "country")[0]?.key).toBe("FR");
    const sh = proposeShares(ps, DEFAULT_DISCOVERY_SHARES, DEFAULT_DISCOVERY_SHARES)!;
    expect(sh.after.directories).toBeCloseTo(0.24, 3);
    for (const v of Object.values(sh.after)) expect(Math.abs(v - 0.2)).toBeLessThanOrEqual(0.2 * 0.2 + 0.002);
    expect(proposeShares(ps.slice(1), DEFAULT_DISCOVERY_SHARES, DEFAULT_DISCOVERY_SHARES)).toBeNull();
  });
});

describe("calibrage proposé, appliqué, annulé", () => {
  it("2 mois de résultats → propositions numérotées → « applique 1 » dans les bornes + Experiment → annule", async () => {
    const { k, ids } = await signedKit();
    await pullAffiliateResults(k.deps as never, "2026-09");
    await pullAffiliateResults(k.deps as never, "2026-10");
    (k.deps as Record<string, unknown>).prospectionLlm = null;
    const r = await proposeCalibration(k.deps as never, k.now());
    expect(r.proposed).toBe(2);
    expect(r.approved).toBe(2);
    expect(r.sent).toBe(true);
    expect(k.sent.at(-1)!.html).toMatch(/^1\. /m);
    const recs = k.tables("recommendation");
    expect(recs.every((x) => x.teamKey === "prospection" && x.source === "prospection_calibration" && x.status === "PROPOSED")).toBe(true);
    expect(recs.map((x) => [x.target, x.field, x.after])).toEqual(
      expect.arrayContaining([
        ["PROSPECTION_CALIBRATION", "ctrFactor", 1.5],
        ["PROSPECTION_CALIBRATION", "ftdFactor", 0.5],
      ]),
    );

    // Jamais par la mécanique de l'Algorithme, jamais seul.
    expect((await applyRecommendationImpl(k.deps, recs[0]!.id as string, { by: "GRAND_CHEF" })).ok).toBe(false);
    expect((await applyCalibration(k.deps as never, [1], "system")).ok).toBe(false);
    expect(k.tables("prospectCalibration")).toHaveLength(0);

    const { choices } = await listCalibrationChoices(k.deps as never);
    expect(choices.map((c) => c.n)).toEqual([1, 2]);
    expect((await applyCalibration(k.deps as never, [3], "client")).ok).toBe(false);
    const ctrN = choices.find((c) => c.field === "ctrFactor")!.n;
    const ap = await applyCalibration(k.deps as never, [ctrN], { userId: null });
    expect(ap.ok).toBe(true);
    expect(ap.experimentId).toBeTruthy();
    const cal = k.tables("prospectCalibration")[0]!;
    expect(cal).toMatchObject({ segment: "SPORTS|FR|tips_free|A", ctrFactor: 1.5, source: "calibrated" });
    const exp = k.tables("experiment")[0]!;
    expect(exp).toMatchObject({ teamKey: "prospection", status: "RUNNING", metric: "prospection_calibration" });
    // L'estimation est maintenant calibrée.
    const v = await estimateProspectValue(k.deps as never, ids[0]!);
    expect(v?.calibratedBy).toBe("SPORTS|FR|tips_free|A");
    expect((await undoRecommendationImpl(k.deps, ap.experimentId ? (k.tables("recommendation").find((x) => x.status === "APPLIED")!.id as string) : "", { userId: null } as never)).ok).toBe(false);

    const un = await undoCalibration(k.deps as never, "client");
    expect(un).toMatchObject({ ok: true, undone: 1 });
    expect(k.tables("prospectCalibration")[0]).toMatchObject({ ctrFactor: 1, source: "default" });
    expect(k.tables("experiment")[0]!.status).toBe("CANCELLED");
    expect((await undoCalibration(k.deps as never, "client")).ok).toBe(false);
    expect(k.tables("auditLog").filter((a) => String(a.action).startsWith("prospection.calibration")).map((a) => a.action)).toEqual(["prospection.calibration.applied", "prospection.calibration.undone"]);
  });

  it("suivi clos à 30 jours ; propositions du mois d'avant remplacées", async () => {
    const { k } = await signedKit();
    await pullAffiliateResults(k.deps as never, "2026-09");
    await pullAffiliateResults(k.deps as never, "2026-10");
    (k.deps as Record<string, unknown>).prospectionLlm = null;
    await proposeCalibration(k.deps as never, k.now());
    await applyCalibration(k.deps as never, [1], "client");
    k.advance(31 * DAY_MS);
    expect(await closeCalibrationExperiments(k.deps as never, k.now())).toBe(1);
    expect(k.tables("experiment")[0]!.status).toBe("CLOSED");
    await proposeCalibration(k.deps as never, k.now());
    expect(k.tables("recommendation").some((x) => x.status === "REJECTED" && x.comment === "Remplacée par le calibrage suivant.")).toBe(true);
  });

  it("Opus : une ligne avec un chiffre inventé est remplacée par celle du code", async () => {
    const { k } = await signedKit();
    await pullAffiliateResults(k.deps as never, "2026-09");
    await pullAffiliateResults(k.deps as never, "2026-10");
    const calls: string[] = [];
    (k.deps as Record<string, unknown>).prospectionLlm = {
      async complete(req: { model: string }) {
        calls.push(req.model);
        return { text: "Le taux de clic passe de 1 à 1,5 pour ce groupe.\nLes dépôts vont tripler, 37 de plus.", costCents: 3 };
      },
    };
    await proposeCalibration(k.deps as never, k.now());
    expect(calls).toEqual(["claude-opus-5-5"]);
    const gains = k.tables("recommendation").map((x) => String(x.expectedGain));
    expect(gains.some((g) => g.startsWith("Le taux de clic passe"))).toBe(true);
    expect(gains.some((g) => /37|tripler/.test(g))).toBe(false);
  });
});

describe("performance, estimé contre réel, rapport du mois", () => {
  it("chiffres réels, comparaison, rapport QA", async () => {
    const { k, ids } = await signedKit();
    await pullAffiliateResults(k.deps as never, "2026-09");
    await pullAffiliateResults(k.deps as never, "2026-10");
    const perf = (await affiliatePerformance(k.deps, ids[0]!))!;
    expect(perf.totals).toMatchObject({ clicks: 2140, ftd: 9 });
    expect(perf.ratio?.clicks).toBeGreaterThan(1);
    expect(perf.text).toMatch(/clics/);
    const evr = await estimatedVsReal(k.deps);
    expect(evr.rows).toHaveLength(3);
    expect(evr.segments[0]!.withEnoughData).toBe(3);
    const text = await buildMonthlyReport(k.deps as never, "2026-10");
    expect(text).toMatch(/3 affiliés signés/);
    expect(text).toMatch(/revenus non fournis/);
    expect(text).not.toMatch(/rapportera/);
    expect(await sendMonthlyReport(k.deps as never, "2026-10")).toEqual({ sent: true, qaBlocked: false });
  });
});

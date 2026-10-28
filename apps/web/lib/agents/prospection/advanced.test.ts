import { describe, expect, it } from "vitest";
import {
  ALERT_KINDS,
  ALERT_KIND_HINTS,
  ALERT_KIND_LABELS,
  accountSearchBadge,
  accountSearchState,
  alertFacts,
  alertFilterParams,
  alertStatusesOf,
  assumptionLines,
  attribution,
  calibrationNote,
  calibrationProposals,
  estimateVsReal,
  evidenceText,
  maskAccount,
  missingResultsText,
  monthLabel,
  mutedKindsOf,
  networkEvidenceOf,
  parisDay,
  parseAlertFilters,
  parseChoiceNumbers,
  parseValueEstimate,
  pipelineValue,
  safeAffiliateId,
  segmentLabel,
  snapshotSeries,
  valueRangeShort,
  valueRangeText,
} from "./advanced";
import { jargonIn } from "@/tests/vocabulary/jargon-scan";

const NB = " "; // espace fine insécable des montants fr-FR (Intl)
const clean = (s: string) => s.replace(/[  ]/g, " ");

const estimate = (over: Record<string, unknown> = {}) => ({
  low: 120,
  base: 300,
  high: 660,
  currency: "EUR",
  assumptions: { promoReach: 90000, promoShare: 0.25, ctr: 0.015, regRate: 0.1, ftdRate: 0.3, cpa: 100, revsharePct: null, arpuMonth: null, reductions: ["SUSPECT_GENERIC"], missing: ["arpu_month"] },
  calibratedBy: "default",
  confidence: "medium",
  computedAt: "2026-10-27T08:00:00.000Z",
  offerId: "off1",
  ...over,
});

describe("alertes", () => {
  it("chaque type a un libellé et une explication, sans jargon", () => {
    for (const k of ALERT_KINDS) {
      expect(ALERT_KIND_LABELS[k]).toBeTruthy();
      expect(jargonIn(ALERT_KIND_LABELS[k])).toEqual([]);
      expect(jargonIn(ALERT_KIND_HINTS[k])).toEqual([]);
    }
  });

  it("filtres de l'adresse : par défaut les alertes à voir ; valeurs inconnues ignorées", () => {
    expect(parseAlertFilters({})).toEqual({ kind: null, status: "open", family: null });
    expect(parseAlertFilters({ type: "GROWTH_SPIKE", statut: "SEEN", famille: "opportunity" })).toEqual({ kind: "GROWTH_SPIKE", status: "SEEN", family: "opportunity" });
    expect(parseAlertFilters({ type: "DROP TABLE", statut: "tous", famille: "x" })).toEqual({ kind: null, status: null, family: null });
    expect(alertStatusesOf({ status: "open" })).toEqual(["NEW", "SENT"]);
    expect(alertStatusesOf({ status: null })).toBeNull();
    expect(alertFilterParams({ kind: "DECLINE", status: null, family: null })).toEqual({ type: "DECLINE", statut: "tous" });
    expect(alertFilterParams({ kind: null, status: "open", family: null })).toEqual({});
  });

  it("chiffres mesurés : clés connues seulement, pourcentages signés", () => {
    const f = alertFacts({ brand: "Betano", days: 18, subsPct: 0.35, secret: "x", nested: { a: 1 } });
    expect(f.map((x) => x.label)).toEqual(["Marque", "Depuis (jours)", "Évolution des abonnés"]);
    expect(clean(f[2]!.value)).toBe("+35 %");
    expect(alertFacts(null)).toEqual([]);
  });

  it("preuve : 15 mots au plus", () => {
    const long = Array.from({ length: 30 }, (_, i) => `mot${i}`).join(" ");
    expect(evidenceText(long)!.split(" ")).toHaveLength(15);
    expect(evidenceText("gains garantis chaque jour")).toBe("gains garantis chaque jour");
    expect(evidenceText("  ")).toBeNull();
  });

  it("types coupés : connus seulement, sans doublon", () => {
    expect(mutedKindsOf(["DECLINE", "DECLINE", "NOPE", 3])).toEqual(["DECLINE"]);
    expect(mutedKindsOf("DECLINE")).toEqual([]);
  });
});

describe("valeur estimée", () => {
  it("lecture tolérante : une fourchette incohérente est refusée", () => {
    expect(parseValueEstimate(estimate())).toMatchObject({ low: 120, base: 300, high: 660, confidence: "medium" });
    expect(parseValueEstimate(estimate({ low: 400 }))).toBeNull();
    expect(parseValueEstimate({ base: 300 })).toBeNull();
    expect(parseValueEstimate(null)).toBeNull();
    expect(parseValueEstimate(estimate({ confidence: "certain" }))!.confidence).toBe("low");
  });

  it("toujours la fourchette, jamais la valeur probable seule", () => {
    const t = clean(valueRangeText({ low: 120, base: 300, high: 660 }));
    expect(t).toBe("120 € – 660 € par mois, probable 300 €");
    expect(clean(valueRangeShort({ low: 2100, high: 11000 }))).toBe("2 100 € – 11 000 €");
    expect(t).not.toMatch(/rapportera/);
    expect(NB).toBeTruthy();
  });

  it("non calibrée tant que le type de canal n'a pas de coefficient corrigé", () => {
    expect(calibrationNote({ calibratedBy: "default" })).toBe("Estimation non calibrée");
    expect(calibrationNote({ calibratedBy: "SPORTS|FR|tips_free|A" })).toContain("Paris sportifs");
  });

  it("hypothèses visibles, réductions et données manquantes dites, sans jargon", () => {
    const lines = assumptionLines(parseValueEstimate(estimate())!).map(clean);
    expect(lines).toContain("Lecteurs qui cliquent : 1,5 %");
    expect(lines).toContain("Prime par joueur : 100 €");
    expect(lines.some((l) => l.startsWith("Contenu générique"))).toBe(true);
    expect(lines.some((l) => l.startsWith("Part du revenu non comptée"))).toBe(true);
    for (const l of lines) expect(jargonIn(l)).toEqual([]);
  });

  it("valeur du pipeline par statut : sommes des fourchettes, canaux sans estimation comptés", () => {
    const rows = pipelineValue([
      { status: "NEGOTIATING", valueEstimate: estimate() },
      { status: "NEGOTIATING", valueEstimate: estimate({ low: 1000, base: 2000, high: 4000, calibratedBy: "SPORTS|FR|?|A" }) },
      { status: "NEGOTIATING", valueEstimate: null },
      { status: "DISCOVERED", valueEstimate: estimate() },
    ]);
    const nego = rows.find((r) => r.status === "NEGOTIATING")!;
    expect(nego).toMatchObject({ count: 3, estimated: 2, low: 1120, base: 2300, high: 4660, uncalibrated: 1 });
    expect(rows.map((r) => r.status)).not.toContain("DISCOVERED");
  });
});

describe("calibrage", () => {
  it("type de canal en mots, jamais le mot technique", () => {
    expect(segmentLabel("SPORTS|FR|tips_free|A")).toBe("Paris sportifs · France · Pronostics gratuits · niveau A");
    expect(segmentLabel("CASINO|?|?|?")).toBe("Casino · Pays inconnu");
    expect(jargonIn(segmentLabel("SPORTS|FR|tips_free|A"))).toEqual([]);
  });

  it("propositions numérotées dans l'ordre (la plus ancienne = 1)", () => {
    const p = calibrationProposals([
      { id: "r2", targetId: "global", field: "openness", before: 15, after: 18, evidence: {}, expectedGain: null, createdAt: new Date("2026-10-02") },
      { id: "r1", targetId: "SPORTS|FR|tips_free|A", field: "ctrFactor", before: 1, after: 1.4, evidence: { affiliates: 4, days: 61, summary: "Clics réels 1,4 fois l'estimation" }, expectedGain: null, createdAt: new Date("2026-10-01") },
    ]);
    expect(p.map((x) => [x.number, x.id])).toEqual([
      [1, "r1"],
      [2, "r2"],
    ]);
    expect(p[0]).toMatchObject({ what: "Coefficient des clics", reason: "Clics réels 1,4 fois l'estimation", sample: "4 affiliés sur 61 jours" });
    expect(clean(p[0]!.change)).toBe("× 1 → × 1,4");
    expect(p[1]).toMatchObject({ what: "Poids de la note : ouverture aux partenariats", target: "Toute la prospection" });
  });

  it("choix « 1 et 3 »", () => {
    expect(parseChoiceNumbers("1 et 3")).toEqual([1, 3]);
    expect(parseChoiceNumbers(["2", "2", "0"])).toEqual([2]);
    expect(parseChoiceNumbers(4)).toEqual([4]);
    expect(parseChoiceNumbers(null)).toEqual([]);
  });
});

describe("réseaux", () => {
  it("preuves lues avec leurs points, les plus fortes d'abord", () => {
    const e = networkEvidenceOf([
      { a: "p1", b: "p2", kind: "same_description", points: 1, detail: "texte" },
      { a: "p1", b: "p3", kind: "same_contact", detail: "@admin_pub" },
      { a: "p1", kind: "same_site" },
      "x",
    ]);
    expect(e.map((x) => [x.label, x.points])).toEqual([
      ["Même contact", 3],
      ["Description presque identique", 1],
    ]);
  });
});

describe("affiliés signés", () => {
  it("mois en français, champs manquants dits", () => {
    expect(monthLabel("2026-09")).toBe("septembre 2026");
    expect(monthLabel("2026-13")).toBe("2026-13");
    expect(missingResultsText(["ftd", "revenueCents"])).toBe("Non fourni par Link Affi : premiers dépôts, revenus");
    expect(missingResultsText([])).toBeNull();
  });

  it("estimé contre réel", () => {
    const e = { low: 100, high: 500 };
    expect(estimateVsReal(e, 5000).verdict).toBe("below");
    expect(estimateVsReal(e, 30000).verdict).toBe("inside");
    expect(estimateVsReal(e, 90000).verdict).toBe("above");
    expect(estimateVsReal(null, 1).verdict).toBe("unknown");
    expect(estimateVsReal(e, null).text).toBe("Revenu réel non fourni");
  });

  it("identifiant d'affilié : simple et borné", () => {
    expect(safeAffiliateId(" #1234 ")).toBe("1234");
    expect(safeAffiliateId(5678)).toBe("5678");
    expect(safeAffiliateId("a b")).toBeNull();
    expect(safeAffiliateId("x".repeat(65))).toBeNull();
  });
});

describe("sources", () => {
  it("attribution : part des A, des signés et des actifs parmi les canaux notés", () => {
    const rows = attribution([
      { key: "DIRECTORY", tier: "A", status: "SIGNED", signedAt: new Date() },
      { key: "DIRECTORY", tier: "B", status: "QUALIFIED", signedAt: null },
      { key: "DIRECTORY", tier: "A", status: "ACTIVE", signedAt: new Date() },
      { key: "DIRECTORY", tier: null, status: "DISCOVERED", signedAt: null },
      { key: "WEB_SEARCH", tier: "C", status: "CHURNED", signedAt: null },
      { key: null, tier: "A", status: "QUALIFIED", signedAt: null },
    ]);
    expect(rows[0]).toMatchObject({ key: "DIRECTORY", total: 3, tierA: 2, signed: 2, active: 1 });
    expect(rows[0]!.shareA).toBeCloseTo(2 / 3);
    expect(rows[1]).toMatchObject({ key: "WEB_SEARCH", total: 1, signed: 1, active: 0 });
  });

  it("recherche par compte réel : compteurs du jour seulement, compte masqué, arrêt dit", () => {
    const now = new Date("2026-10-27T10:00:00Z");
    const s = accountSearchState({ enabled: false, offered: true, counters: { day: parisDay(now), perAccount: { "acc_998877": 42, other: 0 }, flood: { at: "2026-10-27T09:00:00Z", seconds: 120 } } }, now);
    expect(s).toMatchObject({ enabled: false, offered: true, today: 42, capPerAccount: 100 });
    expect(s.perAccount).toEqual([{ account: "Compte …8877", count: 42 }]);
    expect(accountSearchBadge(s)).toBe("STOPPED");
    const old = accountSearchState({ enabled: true, offered: null, counters: { day: "2026-10-26", perAccount: { a: 99 } } }, now);
    expect(old.today).toBe(0);
    expect(accountSearchBadge(old)).toBe("ON");
    expect(accountSearchBadge(accountSearchState({ enabled: undefined, offered: undefined, counters: undefined }, now))).toBe("OFF");
    expect(maskAccount("12")).toBe("Compte");
  });
});

describe("fiche : historique", () => {
  it("points triés, mesures absentes omises", () => {
    const s = snapshotSeries(
      [
        { takenAt: new Date("2026-10-20T10:00:00Z"), subscribers: 5000, medianViews: null },
        { takenAt: new Date("2026-10-01T10:00:00Z"), subscribers: 4000, medianViews: 800 },
      ],
      "medianViews",
    );
    expect(s.values).toEqual([800]);
    expect(snapshotSeries([{ takenAt: new Date("2026-10-20T10:00:00Z"), subscribers: 5000, medianViews: null }, { takenAt: new Date("2026-10-01T10:00:00Z"), subscribers: 4000, medianViews: 800 }], "subscribers").values).toEqual([4000, 5000]);
  });
});

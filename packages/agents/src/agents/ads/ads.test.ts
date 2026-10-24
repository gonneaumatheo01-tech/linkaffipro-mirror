import { describe, expect, it } from "vitest";
import { analysisFor, buildDaily } from "./build";
import type { AdsDataset, AdsStatRow } from "./dataset";
import { bottleneckOf } from "./funnel";
import { adCohorts } from "./cohorts";
import { toMetrics, EMPTY_RAW } from "./metrics";
import { adsMedians, defaultAdsThresholds, parseAdsThresholds, FALLBACK_COST_PER_REGISTRATION } from "./thresholds";
import { ruleInputs } from "./inputs";
import { parseAdsReportOutput, writeAdsReport, adsCodeLines, type AdsDailyFacts } from "./report";
import { budgetsExhausted, conversionDrops, costsOverThreshold, spendSpikes, type CampaignAlertFigures } from "./alerts";
import { adsSetupAnswer, adsSetupQuestion } from "./setup";
import { adsPageUrl, adsReportsDue, dailyFacts } from "./run";
import { addDaysToDay } from "../../rules/time";
import type { AdsMetrics } from "../../ads/contracts";

// Samedi 24 octobre 2026, 12 h à Paris : hier = 23 ; 7 jours = 17 → 23 ; 7 jours d'avant = 10 → 16.
const NOW = new Date("2026-10-24T10:00:00Z");
const T = defaultAdsThresholds(null);

function dataset(stats: AdsStatRow[], extra: Partial<AdsDataset> = {}): AdsDataset {
  return {
    today: "2026-10-24",
    from: "2026-08-29",
    to: "2026-10-24",
    campaigns: [{ id: "c1", name: "Casino FR", vertical: "CASINO", budgetDaily: 100, status: "ACTIVE" }],
    adSets: [{ id: "s1", name: "Hommes 25-45", campaignId: "c1" }],
    ads: [
      { id: "a1", name: "Vidéo roulette", adSetId: "s1" },
      { id: "a2", name: "Image bonus", adSetId: "s1" },
    ],
    stats,
    costs: [],
    firstSpend: [
      { adId: "a1", adSetId: "s1", campaignId: "c1", day: "2026-10-01" },
      { adId: "a2", adSetId: "s1", campaignId: "c1", day: "2026-10-22" },
    ],
    activeConnections: 0,
    ...extra,
  };
}

const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDaysToDay(from, i));

describe("chiffres par pub sur un jeu de DailyStat connu", () => {
  // a1 : 7 jours à 10 € de dépense, 1 inscription et 25 € de commissions par jour ; la semaine d'avant 5 € / jour, 10 €.
  const stats: AdsStatRow[] = [
    ...days("2026-10-17", 7).map((day) => ({ dimension: "ad:a1", day, raw: { spend: 10, registrations: 1, commissions: 25, members: 2, telegramJoins: 3, landingVisits: 30, offerClicks: 4, ftds: 0 } })),
    ...days("2026-10-10", 7).map((day) => ({ dimension: "ad:a1", day, raw: { spend: 5, registrations: 1, commissions: 10, members: 1 } })),
    { dimension: "ad:a2", day: "2026-10-23", raw: { spend: 8, registrations: 0, commissions: 0 } },
    ...days("2026-10-17", 7).map((day) => ({ dimension: "campaign:c1", day, raw: { spend: 12, registrations: 1, commissions: 30 } })),
    { dimension: "campaigns", day: "2026-10-23", raw: { spend: 50, commissions: 40 } },
  ];
  const ds = dataset(stats, {
    costs: [
      { day: "2026-10-23", adId: "a1", adSetId: "s1", campaignId: "c1", spend: 10, impressions: 1000, clicks: 40 },
      { day: "2026-10-23", adId: null, adSetId: "s1", campaignId: "c1", spend: 3, impressions: 200, clicks: 5 },
    ],
  });
  const daily = buildDaily(ds);
  const a = analysisFor(ds, daily, "7d", T, { now: NOW });
  const a1 = a.rows.find((r) => r.id === "a1")!;

  it("dépense, gains, retour, coûts par résultat", () => {
    expect(a.from).toBe("2026-10-17");
    expect(a.to).toBe("2026-10-23");
    expect(a1.current.spend).toBe(70);
    expect(a1.current.commissions).toBe(175);
    expect(a1.current.gains).toBe(105);
    expect(a1.current.roas).toBe(2.5);
    expect(a1.current.costPerRegistration).toBe(10);
    expect(a1.current.costPerMember).toBe(5);
    expect(a1.current.costPerFtd).toBeNull();
    expect(a1.current.impressions).toBe(1000);
    expect(a1.current.adClicks).toBe(40);
    expect(a1.previous.spend).toBe(35);
    expect(a1.enoughData).toBe(true);
    expect(a1.ageDays).toBe(23);
  });

  it("variations par la règle unique (pourcentage, « nouveau »)", () => {
    expect(a1.variations.spend).toEqual({ kind: "pct", pct: 100 });
    expect(a1.variations.ftds).toEqual({ kind: "none" });
    const a2 = a.rows.find((r) => r.id === "a2")!;
    expect(a2.variations.spend).toEqual({ kind: "new", direction: "up" });
    expect(a2.enoughData).toBe(false);
  });

  it("groupe = somme de ses pubs + coûts du groupe ; campagne = sa ligne ; total = ligne sans doublon quand elle existe", () => {
    const s1 = a.rows.find((r) => r.level === "adset")!;
    expect(s1.current.spend).toBe(70 + 8 + 3);
    expect(s1.current.impressions).toBe(1200);
    const c1 = a.rows.find((r) => r.level === "campaign")!;
    expect(c1.current.spend).toBe(84);
    expect(c1.leaf).toBe(false);
    // 6 jours sans ligne « campaigns » (somme des campagnes : 12) + le 23 (ligne sans doublon : 50).
    expect(a.totals.spend).toBe(6 * 12 + 50);
    expect(a.connectorsMissing).toBe(true);
  });

  it("hier seulement", () => {
    const y = analysisFor(ds, daily, "yesterday", T, { now: NOW });
    expect(y.from).toBe("2026-10-23");
    expect(y.rows.find((r) => r.id === "a1")!.current.spend).toBe(10);
  });
});

const m = (p: Partial<AdsMetrics>): AdsMetrics => toMetrics({ ...EMPTY_RAW, ...p });

describe("entonnoir et goulot", () => {
  const peer = m({ impressions: 10_000, adClicks: 200, landingVisits: 150, telegramJoins: 60, offerClicks: 30, registrations: 6, ftds: 2 });
  it("étape la plus en dessous de la valeur du milieu des pubs comparables", () => {
    const weak = m({ impressions: 10_000, adClicks: 200, landingVisits: 150, telegramJoins: 60, offerClicks: 3, registrations: 1, ftds: 0 });
    expect(bottleneckOf(weak, [peer, peer, peer, weak])).toBe("offerClicks");
  });
  it("pas de goulot sans 3 pubs comparables ni quand la pub fait mieux", () => {
    expect(bottleneckOf(peer, [peer, peer])).toBeNull();
    expect(bottleneckOf(peer, [peer, peer, peer])).toBeNull();
  });
});

describe("cohortes", () => {
  it("commissions datées à 7, 14, 30 jours de l'arrivée, par pub", () => {
    const at = new Date("2026-09-01T10:00:00Z");
    const d = (n: number) => new Date(at.getTime() + n * 86_400_000);
    const rows = adCohorts(
      [
        { memberId: "m1", adId: "a1", arrivedAt: at },
        { memberId: "m2", adId: "a1", arrivedAt: at },
        { memberId: "m3", adId: "a2", arrivedAt: at },
      ],
      [
        { memberId: "m1", amount: 50, at: d(3) },
        { memberId: "m1", amount: -50, at: d(20) },
        { memberId: "m2", amount: 40, at: d(10) },
        { memberId: "m3", amount: 30, at: d(-2) },
      ],
      new Map([["a1", "Vidéo"], ["a2", "Image"]]),
    );
    expect(rows[0]).toEqual({ adId: "a1", name: "Vidéo", d7: 50, d14: 90, d30: 40, members: 2 });
    expect(rows[1]).toEqual({ adId: "a2", name: "Image", d7: 0, d14: 0, d30: 0, members: 1 });
  });
});

describe("seuils de départ", () => {
  it("sans assez de pubs : valeurs raisonnables ; avec : valeur du milieu × 1,5 (retour jamais sous 1,2)", () => {
    expect(defaultAdsThresholds(null).CASINO).toEqual({ targetCostPerRegistration: FALLBACK_COST_PER_REGISTRATION, minRoas: 1.5, observationDays: 3, minSpend: 20 });
    const row = (id: string, cpr: number, roas: number) =>
      ({ level: "ad", id, name: id, vertical: "CASINO", current: m({ spend: cpr * 10, registrations: 10, commissions: cpr * 10 * roas }) }) as never;
    const med = adsMedians([row("a", 10, 0.5), row("b", 20, 0.6), row("c", 30, 0.7)]);
    expect(med.CASINO.costPerRegistration).toBe(20);
    const view = parseAdsThresholds({ CASINO: { minSpend: 50 } }, med);
    expect(view.thresholds.CASINO.targetCostPerRegistration).toBe(30);
    expect(view.thresholds.CASINO.minRoas).toBe(1.2);
    expect(view.thresholds.CASINO.minSpend).toBe(50);
    expect(view.sources.CASINO).toEqual({ targetCostPerRegistration: "data", minRoas: "data", observationDays: "default", minSpend: "saved" });
    // Rencontres sans pub : repli sur la valeur du milieu tous univers.
    expect(view.thresholds.DATING.targetCostPerRegistration).toBe(30);
  });
});

describe("question de mise en route", () => {
  it("1 / 2 / chiffre ; sans données, le dit", () => {
    expect(adsSetupAnswer("1")).toEqual({ multiplier: 1.5 });
    expect(adsSetupAnswer("2")).toEqual({ multiplier: 2 });
    expect(adsSetupAnswer("3) 45")).toEqual({ value: 45 });
    expect(adsSetupAnswer("1,8")).toEqual({ value: 1.8 });
    expect(adsSetupAnswer("bof")).toBeNull();
    const q = adsSetupQuestion("cpr", adsMedians([]));
    expect(q.question).toContain("1) 30 €");
    expect(q.question).toContain("2) 40 €");
    expect(q.question).toContain("valeurs raisonnables");
  });
});

describe("rapport : aucun chiffre inventé", () => {
  const facts: AdsDailyFacts = {
    kind: "daily",
    day: "2026-10-23",
    dayLabel: "vendredi 23 octobre",
    spend: 123.45,
    commissions: 150,
    gains: 26.55,
    roas: 1.22,
    connectorsMissing: false,
    best: { name: "Vidéo roulette", campaign: "Casino FR", spend: 10, gains: 15, roas: 2.5 },
    worst: { name: "Image bonus", campaign: "Casino FR", spend: 8, gains: -8, roas: 0 },
    recommendations: { STOP: 1, SCALE: 1, TEST: 1, WATCH: 2, total: 5 },
  };
  const llm = (text: string) => ({ async complete() { return { text, costCents: 1 }; } });

  it("un faux modèle qui invente un chiffre est rejeté : lignes du code à la place", async () => {
    const out = await writeAdsReport(facts, { llm: llm('{"lines":["Hier : 123,45 € dépensés, 999 € de gains."]}'), model: "m", pageUrl: "https://app.linkaffipro.com/agents/ads" });
    expect(out.writtenBy).toBe("code");
    expect(out.rejected).toBe(true);
    expect(out.lines).toEqual(adsCodeLines(facts));
    expect(out.html).toContain("https://app.linkaffipro.com/agents/ads");
  });

  it("une rédaction qui n'utilise que les chiffres fournis est gardée", async () => {
    const out = await writeAdsReport(facts, { llm: llm('{"lines":["Hier, 123,45 € dépensés pour 26,55 € de gains.","La meilleure pub est Vidéo roulette (15 €)."]}'), model: "m", pageUrl: "u" });
    expect(out.writtenBy).toBe("ai");
    expect(out.lines).toHaveLength(2);
  });

  it("HTML, lien, trop de lignes ou format faux : rejet", () => {
    expect(parseAdsReportOutput('{"lines":["<b>x</b>"]}', facts)).toBeNull();
    expect(parseAdsReportOutput('{"lines":["voir https://x.fr"]}', facts)).toBeNull();
    expect(parseAdsReportOutput('{"lines":["a","b","c","d","e"]}', facts)).toBeNull();
    expect(parseAdsReportOutput("pas du json", facts)).toBeNull();
  });

  it("sans clé IA (faux modèle) : écrit par le code, 5 lignes au plus avec le lien", async () => {
    const out = await writeAdsReport(facts, { llm: { fake: true, async complete() { return { text: "", costCents: 0 }; } }, model: "m", pageUrl: "u" });
    expect(out.writtenBy).toBe("code");
    expect(out.html.split("\n").length).toBeLessThanOrEqual(6);
    expect(out.lines.length).toBeLessThanOrEqual(4);
  });
});

describe("alertes", () => {
  const base: CampaignAlertFigures = { id: "c1", name: "Casino FR", today: "2026-10-24", spendToday: 0, spendYesterday: 50, avg7: 50, budgetDaily: 100, registrations7: 10, prevRegistrations7: 10, spend7: 350, prevSpend7: 350 };
  const S = { spikePct: 50, dropPct: 50, minDailySpend: 10, minRegistrations: 5 };
  it("dépense anormale au-delà de +50 % de la moyenne des 7 jours", () => {
    expect(spendSpikes([base], S)).toHaveLength(0);
    const r = spendSpikes([{ ...base, spendToday: 90 }], S);
    expect(r[0]?.key).toBe("campaign:c1");
    expect(r[0]?.message).toContain("80 %");
    expect(spendSpikes([{ ...base, avg7: 5, spendToday: 90 }], S)).toHaveLength(0);
  });
  it("chute des inscriptions alors que la pub dépense", () => {
    expect(conversionDrops([{ ...base, registrations7: 3 }], S)).toHaveLength(1);
    expect(conversionDrops([{ ...base, registrations7: 3, spend7: 100 }], S)).toHaveLength(0);
    expect(conversionDrops([{ ...base, registrations7: 1, prevRegistrations7: 3 }], S)).toHaveLength(0);
  });
  it("budget du jour atteint", () => {
    expect(budgetsExhausted([{ ...base, spendToday: 100 }])[0]?.key).toBe("campaign:c1:2026-10-24");
    expect(budgetsExhausted([{ ...base, spendToday: 99 }, { ...base, budgetDaily: null, spendToday: 500 }])).toHaveLength(0);
  });
  it("coût par inscription au-dessus du seuil depuis N jours", () => {
    const stats = days("2026-10-21", 3).map((day) => ({ dimension: "ad:a1", day, raw: { spend: 40, registrations: 1 } }));
    const ds = dataset(stats);
    const daily = buildDaily(ds);
    const rows = analysisFor(ds, daily, "28d", T, { now: NOW }).rows.filter((r) => r.leaf);
    const found = costsOverThreshold(ruleInputs(rows, daily, ds, T, NOW), T);
    expect(found.map((f) => f.key)).toEqual(["ad:a1"]);
    expect(found[0]?.message).toContain("40,00 € par inscription");
  });
});

describe("rapport quotidien et calendrier", () => {
  it("9 h après le Grand Chef, 10 h au plus tard ; le lundi la semaine", () => {
    const at = (iso: string) => new Date(iso);
    const none = { daily: null, weekly: null, grandChef: null };
    expect(adsReportsDue(at("2026-10-24T06:30:00Z"), none).daily).toBe(false); // 8 h 30
    expect(adsReportsDue(at("2026-10-24T07:10:00Z"), none).daily).toBe(false); // 9 h 10, Grand Chef pas encore passé
    expect(adsReportsDue(at("2026-10-24T07:10:00Z"), { ...none, grandChef: "2026-10-24" }).daily).toBe(true);
    expect(adsReportsDue(at("2026-10-24T08:05:00Z"), none).daily).toBe(true);
    expect(adsReportsDue(at("2026-10-24T08:05:00Z"), { ...none, daily: "2026-10-24" }).daily).toBe(false);
    expect(adsReportsDue(at("2026-10-26T09:05:00Z"), none)).toEqual({ daily: true, weekly: true }); // lundi 10 h 05 (heure d'hiver)
    expect(adsReportsDue(at("2026-10-26T09:05:00Z"), { daily: "2026-10-26", weekly: "2026-10-26", grandChef: null }).weekly).toBe(false);
  });
  it("adresse de la page depuis APP_BASE_URL", () => {
    expect(adsPageUrl("https://exemple.fr/")).toBe("https://exemple.fr/agents/ads");
    expect(adsPageUrl("")).toBe("https://app.linkaffipro.com/agents/ads");
  });
  it("meilleure et pire pub d'hier", () => {
    const ds = dataset([
      { dimension: "ad:a1", day: "2026-10-23", raw: { spend: 10, commissions: 40 } },
      { dimension: "ad:a2", day: "2026-10-23", raw: { spend: 20, commissions: 0 } },
    ]);
    const ctx = { now: NOW, dataset: ds, daily: buildDaily(ds), thresholds: parseAdsThresholds(undefined, null), cohorts: [] };
    const f = dailyFacts(ctx, [{ action: "STOP" }] as never);
    expect(f.best?.name).toBe("Vidéo roulette");
    expect(f.worst?.name).toBe("Image bonus");
    expect(f.recommendations).toEqual({ STOP: 1, SCALE: 0, TEST: 0, WATCH: 0, total: 1 });
  });
});

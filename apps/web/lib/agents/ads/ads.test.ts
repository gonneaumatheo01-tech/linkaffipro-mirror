import { describe, expect, it } from "vitest";
import {
  ADS_ALERT_SETTINGS_KEY,
  DEFAULT_ADS_ALERT_SETTINGS,
  FUNNEL_STEPS as ENGINE_FUNNEL_STEPS,
  parseAdsAlertSettings,
  type AdsMetrics,
  type AdsRow,
} from "@linkaffipro/agents";
import {
  ADS_ALERTS_KEY,
  ADS_ALERT_BOUNDS,
  ADS_ALERT_DEFAULTS,
  ADS_ALERT_FIELDS,
  alertField,
  parseAdsAlertSettingsForm,
  parseAdsAlertSettingsValue,
} from "./alert-settings";
import { METRIC_VIEWS } from "@/lib/dashboard/display";
import { jargonIn } from "@/tests/vocabulary/jargon-scan";
import { statusLabel } from "@/lib/status-badges";
import {
  ADS_METRIC_VIEWS,
  ADS_STATS_EQUIVALENT,
  FUNNEL_STEPS,
  adsEvidenceLines,
  bestAndWorst,
  bottleneckStep,
  canMarkRecommendation,
  cleanComment,
  funnelSteps,
  parseAdsPeriod,
  pickCampaign,
  rankAds,
  reportKind,
  sortRecommendations,
  statsPeriodParams,
} from "./display";
import { figuresCsv, recommendationsCsv } from "./csv";
import { DEFAULT_UNIVERSE_THRESHOLDS, parseAdsThresholds, parseAdsThresholdsForm } from "./thresholds";

const metrics = (o: Partial<AdsMetrics> = {}): AdsMetrics => ({
  spend: 0,
  impressions: 0,
  adClicks: 0,
  landingVisits: 0,
  telegramJoins: 0,
  members: 0,
  offerClicks: 0,
  registrations: 0,
  ftds: 0,
  deposits: 0,
  commissions: 0,
  gains: 0,
  roas: null,
  costPerMember: null,
  costPerRegistration: null,
  costPerFtd: null,
  ...o,
});
const row = (id: string, o: Partial<AdsRow> & { cur?: Partial<AdsMetrics> } = {}): AdsRow => ({
  level: "ad",
  id,
  name: id,
  vertical: "CASINO",
  campaignId: "c1",
  current: metrics(o.cur),
  previous: metrics(),
  variations: {},
  bottleneck: null,
  enoughData: true,
  ...o,
});

describe("période et liens vers Statistiques", () => {
  it("période de l'adresse, 7 jours par défaut", () => {
    expect(parseAdsPeriod("28d")).toBe("28d");
    expect(parseAdsPeriod(["yesterday"])).toBe("yesterday");
    expect(parseAdsPeriod("30d")).toBe("7d");
    expect(parseAdsPeriod(undefined)).toBe("7d");
  });
  it("mêmes jours dans Statistiques ; repli si les dates manquent", () => {
    expect(statsPeriodParams({ period: "28d", from: "2026-09-26", to: "2026-10-23" })).toEqual({
      range: "custom",
      from: "2026-09-26",
      to: "2026-10-23",
    });
    expect(statsPeriodParams({ period: "28d", from: "", to: "" })).toEqual({ range: "30d" });
  });
});

describe("chiffres affichés", () => {
  it("mots du client, jamais de terme technique en surface", () => {
    for (const v of Object.values(ADS_METRIC_VIEWS)) expect(jargonIn(v.label), v.label).toEqual([]);
    expect(ADS_METRIC_VIEWS.roas).toMatchObject({ label: "Retour sur dépense pub", term: "ROAS" });
    expect(ADS_METRIC_VIEWS.costPerRegistration.label).toBe("Coût par inscription");
  });
  it("un mot = un seul chiffre, ici et dans Statistiques", () => {
    const labels = Object.values(ADS_METRIC_VIEWS).map((v) => v.label);
    expect(new Set(labels).size).toBe(labels.length);
    const statsByLabel = new Map(Object.entries(METRIC_VIEWS).map(([k, v]) => [v.label, k]));
    for (const [key, v] of Object.entries(ADS_METRIC_VIEWS)) {
      const statsKey = statsByLabel.get(v.label);
      // même mot que Statistiques seulement pour la même valeur
      expect(statsKey, `${key} : « ${v.label} »`).toBe(ADS_STATS_EQUIVALENT[key as keyof typeof ADS_STATS_EQUIVALENT]);
    }
    expect(ADS_METRIC_VIEWS.adClicks.label).toBe("Clics comptés par Meta / TikTok");
    expect(ADS_METRIC_VIEWS.adClicks.term).toBeTruthy();
    expect(ADS_METRIC_VIEWS.landingVisits.label).toBe(METRIC_VIEWS.entryClicks.label);
  });
});

describe("parcours", () => {
  it("étapes à partir de la première qui a un chiffre, part gardée, étape la plus faible", () => {
    const steps = funnelSteps(
      row("c", { bottleneck: "offerClicks", cur: { adClicks: 200, landingVisits: 100, telegramJoins: 50, offerClicks: 5, registrations: 2 } }),
    );
    expect(steps.map((s) => s.key)).toEqual(["adClicks", "landingVisits", "telegramJoins", "offerClicks", "registrations", "ftds"]);
    expect(steps[0]!.rate).toBeNull();
    expect(steps[1]!.rate).toBe(0.5);
    expect(steps.find((s) => s.weakest)?.key).toBe("offerClicks");
    expect(steps.at(-1)!.rate).toBe(0);
    expect(funnelSteps(row("v"))).toEqual([]);
  });
  it("mêmes étapes que le moteur, dans le même ordre ; chaque goulot du moteur est reconnu", () => {
    expect(FUNNEL_STEPS).toEqual(ENGINE_FUNNEL_STEPS.map((s) => s.key));
    for (const s of ENGINE_FUNNEL_STEPS) expect(bottleneckStep(s.key)).toBe(s.key);
  });
  it("goulot lu de façon tolérante", () => {
    expect(bottleneckStep("landingVisits")).toBe("landingVisits");
    expect(bottleneckStep("visit→join")).toBe("landingVisits");
    expect(bottleneckStep("registration")).toBe("registrations");
    expect(bottleneckStep("ftds")).toBe("ftds");
    expect(bottleneckStep("inconnu")).toBeNull();
    expect(bottleneckStep(null)).toBeNull();
  });
});

describe("classements", () => {
  const rows = [
    row("a", { cur: { gains: 100, spend: 50 } }),
    row("b", { cur: { gains: -40, spend: 80 } }),
    row("c", { cur: { gains: 10, spend: 20 } }),
    row("jeune", { enoughData: false, cur: { gains: 500, spend: 5 } }),
    row("camp", { level: "campaign", cur: { spend: 999 } }),
  ];
  it("par gains, seulement avec assez de chiffres ; jamais dans les deux listes", () => {
    const r = rankAds(rows, 2);
    expect(r.best.map((x) => x.id)).toEqual(["a", "c"]);
    expect(r.worst.map((x) => x.id)).toEqual(["b"]);
    expect(r.young.map((x) => x.id)).toEqual(["jeune"]);
    expect(bestAndWorst(rows)).toMatchObject({ best: { id: "a" }, worst: { id: "b" } });
    expect(bestAndWorst([row("x", { enoughData: false })])).toEqual({ best: null, worst: null });
  });
  it("campagne du parcours : celle demandée, sinon la plus grosse dépense", () => {
    const cs = [row("p", { level: "campaign", cur: { spend: 10 } }), row("q", { level: "campaign", cur: { spend: 90 } })];
    expect(pickCampaign(cs, "p")?.id).toBe("p");
    expect(pickCampaign(cs, "zzz")?.id).toBe("q");
    expect(pickCampaign([], undefined)).toBeNull();
  });
});

describe("recommandations", () => {
  it("à arrêter d'abord, puis augmenter, tester, surveiller", () => {
    const d = new Date("2026-10-24T08:00:00Z");
    const list = sortRecommendations([
      { action: "WATCH", createdAt: d },
      { action: "TEST", createdAt: d },
      { action: "STOP", createdAt: d },
      { action: "SCALE", createdAt: d },
    ]);
    expect(list.map((r) => r.action)).toEqual(["STOP", "SCALE", "TEST", "WATCH"]);
  });
  it("« Fait » / « Refuser » seulement sur une recommandation à décider", () => {
    expect(canMarkRecommendation("PROPOSED")).toBe(true);
    expect(canMarkRecommendation("DONE")).toBe(false);
    expect(canMarkRecommendation("REJECTED")).toBe(false);
  });
  it("commentaire nettoyé et borné", () => {
    expect(cleanComment("  a   b ")).toBe("a b");
    expect(cleanComment("   ")).toBeNull();
    expect(cleanComment(null)).toBeNull();
    expect(cleanComment("x".repeat(900))!.length).toBe(500);
  });
  it("preuves en phrases : texte du moteur, chiffres connus, période", () => {
    const lines = adsEvidenceLines({
      summary: "Coût par inscription au-dessus du seuil depuis 4 jours.",
      metrics: { spend: 150, costPerRegistration: 15 },
      threshold: 10,
      days: 4,
      from: "2026-10-20",
      to: "2026-10-23",
      secret: 3,
    });
    expect(lines[0]).toBe("Coût par inscription au-dessus du seuil depuis 4 jours.");
    expect(lines[1]).toContain("seuil 10");
    expect(lines[1]).toContain("4 jours observés");
    expect(lines[1]).toContain("coût par inscription 15");
    expect(lines[1]).not.toContain("secret");
    expect(lines).toContain("Période : du 20/10/2026 au 23/10/2026.");
    expect(adsEvidenceLines("Texte seul")).toEqual(["Texte seul"]);
    expect(adsEvidenceLines(null)).toEqual([]);
    for (const l of lines) expect(jargonIn(l)).toEqual([]);
  });
  it("libellés des actions et du statut « Fait »", () => {
    expect(statusLabel("adsAction", "STOP")).toBe("Arrêter");
    expect(statusLabel("adsAction", "SCALE")).toBe("Augmenter");
    expect(statusLabel("adsAction", "TEST")).toBe("Tester");
    expect(statusLabel("adsAction", "WATCH")).toBe("Surveiller");
    expect(statusLabel("recommendation", "DONE")).toBe("Fait");
  });
  it("rapport du jour ou de la semaine", () => {
    expect(reportKind({ weekStart: "2026-10-19", stats: { kind: "weekly" } })).toBe("weekly");
    expect(reportKind({ weekStart: "2026-10-24", stats: { kind: "daily" } })).toBe("daily");
    expect(reportKind({ weekStart: "day:2026-10-24", stats: {} })).toBe("daily");
  });
});

describe("seuils", () => {
  it("valeurs de départ pour ce qui manque ou sort des bornes", () => {
    const t = parseAdsThresholds({ CASINO: { targetCostPerRegistration: 12, minRoas: 99, observationDays: 5, minSpend: -1 } });
    expect(t.CASINO).toEqual({ targetCostPerRegistration: 12, minRoas: null, observationDays: 5, minSpend: 20 });
    expect(t.DATING).toEqual(DEFAULT_UNIVERSE_THRESHOLDS);
  });
  it("formulaire : virgule acceptée, vide = automatique, erreur par univers", () => {
    const f = new FormData();
    for (const u of ["CASINO", "SPORTS", "DATING"]) {
      f.set(`${u}.targetCostPerRegistration`, "");
      f.set(`${u}.minRoas`, "1,5");
      f.set(`${u}.observationDays`, "3");
      f.set(`${u}.minSpend`, "20 €");
    }
    const ok = parseAdsThresholdsForm(f);
    expect(ok).toMatchObject({ ok: true, data: { CASINO: { targetCostPerRegistration: null, minRoas: 1.5, minSpend: 20 } } });
    f.set("DATING.targetCostPerRegistration", "abc");
    expect(parseAdsThresholdsForm(f)).toMatchObject({ ok: false, error: expect.stringContaining("Rencontres") });
  });
});

describe("exports", () => {
  it("recommandations : action, preuves, état et commentaire en mots", () => {
    const csv = recommendationsCsv([
      {
        id: "r1",
        target: "AD",
        targetId: "a1",
        action: "STOP",
        evidence: { summary: "Trop cher." },
        expectedGain: null,
        status: "DONE",
        comment: "=fait",
        doneAt: new Date("2026-10-24T08:00:00Z"),
        rejectedAt: null,
        createdAt: new Date("2026-10-23T08:00:00Z"),
        targetLabel: "Pub 1",
        campaignId: "c1",
        vertical: "CASINO",
      },
    ]);
    expect(csv).toContain("Pub;Pub 1;Arrêter;Trop cher.;;Fait;'=fait");
    expect(jargonIn(csv)).toEqual([]);
  });
  it("chiffres : campagnes d'abord, période et période d'avant", () => {
    const csv = figuresCsv({
      from: "2026-10-17",
      to: "2026-10-23",
      rows: [row("a", { cur: { spend: 12.5, registrations: 3 } }), row("c", { level: "campaign", bottleneck: "landingVisits" })],
    });
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Retour sur dépense pub (×)");
    expect(lines[1]).toContain("Campagne;c");
    expect(lines[1]).toContain("Clics sur les pubs");
    expect(lines[2]).toContain("Pub;a;Casino;12,50");
    expect(jargonIn(lines[0]!)).toEqual([]);
  });
});

describe("réglages des alertes de l'Agent Ads (agents.ads.alerts)", () => {
  const form = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.set(alertField(k as keyof typeof ADS_ALERT_DEFAULTS), v);
    return f;
  };
  it("même clé, mêmes valeurs de départ et mêmes champs que le moteur", () => {
    expect(ADS_ALERTS_KEY).toBe(ADS_ALERT_SETTINGS_KEY);
    expect(ADS_ALERT_DEFAULTS).toEqual(DEFAULT_ADS_ALERT_SETTINGS);
    expect(ADS_ALERT_FIELDS.map((f) => f.key).sort()).toEqual(Object.keys(DEFAULT_ADS_ALERT_SETTINGS).sort());
    for (const f of ADS_ALERT_FIELDS) expect(jargonIn(`${f.label} ${f.hint}`)).toEqual([]);
  });
  it("chaque valeur acceptée par le formulaire est gardée telle quelle par le moteur ; bornes identiques", () => {
    for (const [key, b] of Object.entries(ADS_ALERT_BOUNDS)) {
      for (const v of [b.min, b.max]) {
        const over = { ...ADS_ALERT_DEFAULTS, [key]: v };
        expect(parseAdsAlertSettings(over)).toEqual(over);
        expect(parseAdsAlertSettingsValue(over)).toEqual(over);
      }
      const out = { ...ADS_ALERT_DEFAULTS, [key]: b.max + 1 };
      expect(parseAdsAlertSettings(out)).toEqual(ADS_ALERT_DEFAULTS);
      expect(parseAdsAlertSettingsValue(out)).toEqual(ADS_ALERT_DEFAULTS);
    }
  });
  it("lecture du formulaire : virgule, entiers, bornes", () => {
    expect(parseAdsAlertSettingsForm(form({ spikePct: "80", dropPct: "40", minDailySpend: "12,5", minRegistrations: "3" }))).toEqual({
      ok: true,
      data: { spikePct: 80, dropPct: 40, minDailySpend: 12.5, minRegistrations: 3 },
    });
    expect(parseAdsAlertSettingsForm(form({ spikePct: "80", dropPct: "140", minDailySpend: "10", minRegistrations: "3" })).ok).toBe(false);
    expect(parseAdsAlertSettingsForm(form({ spikePct: "80,5", dropPct: "40", minDailySpend: "10", minRegistrations: "3" })).ok).toBe(false);
    expect(parseAdsAlertSettingsForm(form({ spikePct: "", dropPct: "40", minDailySpend: "10", minRegistrations: "3" })).ok).toBe(false);
  });
});

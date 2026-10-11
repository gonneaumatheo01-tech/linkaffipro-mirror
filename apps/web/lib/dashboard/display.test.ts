import { describe, expect, it } from "vitest";
import { MAX_COLUMNS } from "@/components/admin/data-table-logic";
import {
  ADS_COLUMNS,
  DETAIL_ORDER,
  FUNNEL_LABELS,
  METRIC_VIEWS,
  activeSummary,
  adsDefaultSort,
  beforeHint,
  biggestDrop,
  comparableDelta,
  comparableVariation,
  cohortsChronological,
  costPerMemberNote,
  fmtMetric,
  fmtMetricExact,
  fmtPercent,
  fmtPerPost,
  fmtSigned,
  growthVariation,
  hourBars,
  hourLabel,
  metricGroupFormatter,
  metricValue,
  moneyColumn,
  perPostText,
  postsClicksNote,
  gainsNote,
  shareOf,
  stepNote,
  sumSeries,
  trendOrNone,
  unknownBefore,
} from "./display";
import { EMPTY_TOTALS, FUNNEL_STEPS, deltaPct, derive, funnel } from "./metrics";

const sp = (s: string) => s.replace(/[  ]/g, " ");

describe("vocabulaire des chiffres", () => {
  it("chaque chiffre des statistiques journalières et chaque indicateur dérivé a son mot", () => {
    const keys = [...Object.keys(EMPTY_TOTALS), ...Object.keys(derive(EMPTY_TOTALS))].sort();
    expect(Object.keys(METRIC_VIEWS).sort()).toEqual(keys);
    // Volet d'une campagne : tous les chiffres sauf les départs ; commissions puis gains en fin de volet.
    expect([...DETAIL_ORDER].sort()).toEqual(keys.filter((k) => k !== "left"));
    expect(DETAIL_ORDER.slice(-1)).toEqual(["gains"]);
    expect(DETAIL_ORDER.indexOf("commissions")).toBeGreaterThan(DETAIL_ORDER.indexOf("ngr"));
    expect(keys).not.toContain("profit");
  });

  it("aucun sigle en surface : le terme technique est au survol", () => {
    for (const v of Object.values(METRIC_VIEWS))
      expect(v.label).not.toMatch(/\b(FTD|NGR|ROAS|CPL|CPA|LTV)\b/);
    expect(METRIC_VIEWS.ftds).toMatchObject({ label: "Premiers dépôts", term: "FTD" });
    expect(METRIC_VIEWS.ngr).toMatchObject({ label: "Revenu net", term: "NGR" });
    expect(METRIC_VIEWS.cpl).toMatchObject({ label: "Coût par membre", term: "CPL" });
    expect(METRIC_VIEWS.cpa).toMatchObject({ label: "Coût par inscription", term: "CPA" });
    expect(METRIC_VIEWS.roas).toMatchObject({ label: "Retour sur dépense pub", term: "ROAS" });
    expect(METRIC_VIEWS.gains).toMatchObject({ label: "Gains", favorable: "up", format: "money" });
    expect(METRIC_VIEWS.commissions).toMatchObject({ label: "Commissions", format: "money" });
    // Un total (pas « par joueur »), jamais confondu avec le coût par inscription (CPA).
    expect(METRIC_VIEWS.cpaCommissions).toMatchObject({
      label: "Primes des joueurs",
      term: "commission CPA",
    });
    expect(METRIC_VIEWS.cpaCommissions.label).not.toMatch(/par joueur/i);
    expect(METRIC_VIEWS.revshareCommissions).toMatchObject({
      label: "Part du revenu",
      term: "revshare",
    });
  });

  it("une baisse est favorable pour une dépense, un coût ou un départ", () => {
    for (const k of ["spend", "cpl", "cpa", "costPerFtd", "left"] as const)
      expect(METRIC_VIEWS[k].favorable).toBe("down");
    expect(METRIC_VIEWS.ngr.favorable).toBe("up");
  });

  it("formats français : euros, rapport avec une virgule (jamais « 1.00× »), « — »", () => {
    expect(fmtMetric("roas", 1)).toBe("1,00×");
    expect(fmtMetric("roas", null)).toBe("—");
    expect(sp(fmtMetric("spend", 1234.4))).toBe("1 234 €");
    expect(sp(fmtMetric("cpl", 2.1))).toBe("2,10 €");
    expect(sp(fmtMetric("joined", 1240))).toBe("1 240");
    expect(sp(fmtMetricExact("spend", 1234.4))).toBe("1 234,40 €");
    expect(fmtMetricExact("ftds", 3)).toBe("3");
    expect(fmtMetricExact("cpa", null)).toBe("—");
  });

  it("variation : pas de pourcentage sur une base négative (gains ou revenu net d'avant en perte)", () => {
    // De −1,74 € de perte à 323 € de gains : deltaPct donne −18 661 %, en rouge, à l'envers.
    expect(deltaPct(323, -1.74)).toBeLessThan(-1000);
    expect(comparableDelta(deltaPct(323, -1.74), -1.74)).toBeNull();
    expect(comparableDelta(deltaPct(-50, -100), -100)).toBeNull();
    // Base positive : la variation reste, y compris quand le chiffre passe en perte.
    expect(comparableDelta(deltaPct(120, 100), 100)).toBe(20);
    expect(comparableDelta(deltaPct(-50, 100), 100)).toBe(-150);
    // Base nulle : la règle de deltaPct (« 0 % » si rien ne bouge, sinon pas de comparaison).
    expect(comparableDelta(deltaPct(0, 0), 0)).toBe(0);
    expect(comparableDelta(deltaPct(5, 0), 0)).toBeNull();
    // Indicateur non calculable d'avant (null) : rien n'est inventé.
    expect(comparableDelta(null, null)).toBeNull();
    expect(comparableDelta(undefined, 3)).toBeNull();
  });

  it("variation affichée (règle commune) : « nouveau » depuis 0, rien si les deux valent 0, pas de % sur une base négative", () => {
    expect(comparableVariation(120, 100)).toEqual({ kind: "pct", pct: 20 });
    expect(comparableVariation(12, 0)).toEqual({ kind: "new", direction: "up" });
    expect(comparableVariation(-40, 0)).toEqual({ kind: "new", direction: "down" });
    expect(comparableVariation(0, 0)).toEqual({ kind: "none" });
    expect(comparableVariation(323, -1.74)).toEqual({ kind: "unknown" });
    expect(comparableVariation(null, 2)).toEqual({ kind: "unknown" });
    expect(comparableVariation(1.5, null)).toEqual({ kind: "unknown" });
  });

  it("« Avant : X » : jamais avec « nouveau » (déjà dit) ; sur les chiffres compacts, seulement sans pourcentage", () => {
    expect(beforeHint(comparableVariation(15, 0), "0")).toBeNull();
    expect(beforeHint(comparableVariation(120, 100), "100")).toBe("Avant : 100");
    expect(beforeHint(comparableVariation(540, -676), "−676 €")).toBe("Avant : −676 €");
    expect(beforeHint(comparableVariation(0, 0), "0")).toBe("Avant : 0");
    expect(beforeHint(undefined, "3")).toBeNull();
    expect(unknownBefore(comparableVariation(-18, -62), "−62 €")).toBe("Avant : −62 €");
    expect(unknownBefore(comparableVariation(120, 100), "100 €")).toBeNull();
    expect(unknownBefore(comparableVariation(5, 0), "0 €")).toBeNull();
  });

  it("canaux : même règle (« nouveau » depuis 0, rien si les deux valent 0, pas de % sur une base négative)", () => {
    expect(growthVariation(4, 0, true)).toEqual({ kind: "new", direction: "up" });
    expect(growthVariation(0, 0, true)).toEqual({ kind: "none" });
    expect(growthVariation(3, -2, true)).toEqual({ kind: "unknown" });
    expect(growthVariation(12, 10, true)).toEqual({ kind: "pct", pct: 20 });
    expect(growthVariation(12, 10, false)).toBeUndefined();
    expect(growthVariation(12, null, true)).toBeUndefined();
  });

  it("valeur d'un total ou d'un indicateur dérivé", () => {
    const t = { ...EMPTY_TOTALS, spend: 100, joined: 50, ngr: 900, commissions: 180 };
    const d = derive(t);
    expect(metricValue(t, d, "joined")).toBe(50);
    expect(metricValue(t, d, "cpl")).toBe(2);
    expect(metricValue(t, d, "roas")).toBe(1.8);
    expect(metricValue(t, d, "gains")).toBe(80);
    expect(metricValue(t, d, "cpa")).toBeNull();
  });
});

describe("Pubs : tableau par campagne", () => {
  it("5 colonnes au plus, mots du client, terme technique au survol", () => {
    expect(ADS_COLUMNS.length).toBeLessThanOrEqual(MAX_COLUMNS);
    expect(ADS_COLUMNS.map((c) => c.header)).toEqual([
      "Campagne",
      "Dépense pub",
      "Membres entrés",
      "Premiers dépôts",
      "Retour sur dépense pub",
    ]);
  });

  it("sur téléphone : la dépense face au retour sur dépense pub (les gains sont écrits dessous)", () => {
    const phone = ADS_COLUMNS.filter((c) => !("hideOnMobile" in c && c.hideOnMobile)).map(
      (c) => c.key,
    );
    expect(phone).toEqual(["name", "spend", "roas"]);
  });

  it("tri d'une ancienne adresse appliqué s'il vise une colonne, sinon dépense décroissante", () => {
    expect(adsDefaultSort("roas", "asc")).toEqual({ key: "roas", direction: "asc" });
    expect(adsDefaultSort("ftds", "")).toEqual({ key: "ftds", direction: "desc" });
    expect(adsDefaultSort("cpa", "asc")).toEqual({ key: "spend", direction: "desc" });
    expect(adsDefaultSort("", "")).toEqual({ key: "spend", direction: "desc" });
  });

  it("phrases sous les chiffres : coût par membre, gains ou perte", () => {
    expect(sp(costPerMemberNote({ cpl: 2.1 })!)).toBe("2,10 € par membre");
    expect(costPerMemberNote({ cpl: null })).toBeNull();
    expect(sp(gainsNote(420)!)).toBe("420 € de gains");
    expect(sp(gainsNote(-120.4)!)).toBe("120 € de perte");
    expect(sp(gainsNote(-96.9)!)).toBe("97 € de perte");
    expect(gainsNote(0)).toBeNull();
    expect(gainsNote(0.3)).toBeNull();
  });

  it("une colonne de montants garde une seule précision", () => {
    const fmt = moneyColumn([530, 1735, 0]);
    expect(sp(fmt(530))).toBe("530 €");
    expect(sp(fmt(0))).toBe("0 €");
    const small = moneyColumn([12.5, 0]);
    expect(sp(small(12.5))).toBe("12,50 €");
    expect(sp(small(0))).toBe("0,00 €");
    expect(fmt(null)).toBe("—");
  });
});

describe("grille de cartes", () => {
  it("une seule précision pour les montants affichés ensemble", () => {
    const fmt = metricGroupFormatter([
      { key: "spend", value: 0.26 },
      { key: "ngr", value: 214.1 },
      { key: "gains", value: 213.84 },
      { key: "joined", value: 1234 },
    ]);
    // « 0,26 € » ne côtoie pas « 214 € » : tout à l'euro (le montant exact reste au survol).
    expect(sp(fmt("spend", 0.26))).toBe("0 €");
    expect(sp(fmt("ngr", 214.1))).toBe("214 €");
    expect(sp(fmt("gains", -213.84))).toBe("−214 €");
    // Les chiffres qui ne sont pas des montants ne changent pas.
    expect(sp(fmt("joined", 1234))).toBe("1 234");
    expect(fmt("roas", 1.53)).toBe("1,53×");
    // Tous sous 100 € : au centime.
    const small = metricGroupFormatter([
      { key: "spend", value: 12.5 },
      { key: "ngr", value: 40 },
    ]);
    expect(sp(small("spend", 12.5))).toBe("12,50 €");
    expect(sp(small("ngr", 40))).toBe("40,00 €");
    expect(small("ngr", null)).toBe("—");
  });

  it("pas de mini-courbe pour une période sans aucune valeur", () => {
    expect(trendOrNone([0, 0, 0, 0])).toBeUndefined();
    expect(trendOrNone([])).toBeUndefined();
    expect(trendOrNone(null)).toBeUndefined();
    expect(trendOrNone([0, 2, 0])).toEqual([0, 2, 0]);
    expect(trendOrNone([0, -1])).toEqual([0, -1]);
  });
});

describe("Parcours", () => {
  it("chaque étape a son nom en mots du client", () => {
    for (const s of FUNNEL_STEPS) expect(FUNNEL_LABELS[s.key]).toBeDefined();
    expect(FUNNEL_LABELS.ftds).toEqual({ label: "Premiers dépôts", term: "FTD" });
  });

  it("un seul libellé par chiffre : le parcours dit comme les cartes et les volets", () => {
    for (const s of FUNNEL_STEPS) {
      const view = METRIC_VIEWS[s.key];
      expect(FUNNEL_LABELS[s.key]?.label).toBe(view.label);
      expect(FUNNEL_LABELS[s.key]?.term).toBe(view.term);
    }
    expect(FUNNEL_LABELS.offerClicks?.label).toBe("Clics sur les offres");
    expect(FUNNEL_LABELS.joined?.label).toBe("Membres entrés");
  });

  it("la plus grosse perte, hors dépôts répétés", () => {
    const steps = funnel({
      ...EMPTY_TOTALS,
      entryClicks: 1000,
      requests: 600,
      approved: 590,
      joined: 500,
      offerClicks: 200,
      registrations: 20,
      ftds: 10,
      deposits: 2,
    });
    const drop = biggestDrop(steps)!;
    expect(drop.from.key).toBe("offerClicks");
    expect(drop.to.key).toBe("registrations");
    expect(drop.loss).toBe(90);
  });

  it("rien à signaler quand tout est vide ou sans perte", () => {
    expect(biggestDrop(funnel(EMPTY_TOTALS))).toBeNull();
  });

  it("précision sous une étape : part gardée, ou multiplication au-delà de 100 %", () => {
    expect(sp(stepNote(80.7)!)).toBe("80,7 % de l'étape d'avant");
    expect(sp(stepNote(100)!)).toBe("100 % de l'étape d'avant");
    expect(stepNote(389.5)).toBe("×3,9 par rapport à l'étape d'avant");
    expect(stepNote(null)).toBeNull();
  });

  it("pourcentages à la française", () => {
    expect(sp(fmtPercent(18.5))).toBe("18,5 %");
    expect(fmtPercent(null)).toBe("—");
  });
});

describe("Vue d'ensemble : ligne « En ce moment »", () => {
  it("accords au singulier et au pluriel (« canaux », jamais « canalaux »)", () => {
    expect(sp(activeSummary({ bots: 4, channels: 7, members: 301 }))).toBe(
      "En ce moment : 4 bots actifs, 7 canaux actifs, 301 membres vus par vos bots.",
    );
    expect(activeSummary({ bots: 1, channels: 1, members: 1 })).toBe(
      "En ce moment : 1 bot actif, 1 canal actif, 1 membre vu par vos bots.",
    );
    expect(activeSummary({ bots: 0, channels: 0, members: 0 })).toBe(
      "En ce moment : 0 bot actif, 0 canal actif, 0 membre vu par vos bots.",
    );
    expect(sp(activeSummary({ bots: 2, channels: 2, members: 1234 }))).toBe(
      "En ce moment : 2 bots actifs, 2 canaux actifs, 1 234 membres vus par vos bots.",
    );
    expect(activeSummary({ bots: 2, channels: 3, members: 2 })).not.toMatch(/canalaux/);
  });
});

describe("Canaux : meilleurs horaires d'envoi", () => {
  const hours = [
    { hour: 21, posts: 5, clicks: 12, clicksPerPost: 2.4 },
    { hour: 9, posts: 2, clicks: 3, clicksPerPost: 1.5 },
    { hour: 14, posts: 1, clicks: 1, clicksPerPost: 1 },
    ...[0, 1, 2, 3, 4, 5, 6].map((h) => ({ hour: h, posts: 1, clicks: 0, clicksPerPost: 0 })),
  ];

  it("heure de Paris en toutes lettres", () => {
    expect(hourLabel(21)).toBe("21 h");
    expect(hourLabel(9)).toBe("9 h");
    expect(hourLabel(0)).toBe("0 h");
  });

  it("clics par message et précision « messages · clics » accordés", () => {
    expect(perPostText(2.4)).toBe("2,4 clics par message");
    expect(perPostText(1.5)).toBe("1,5 clic par message");
    expect(perPostText(1)).toBe("1 clic par message");
    expect(perPostText(0)).toBe("0 clic par message");
    expect(postsClicksNote(5, 12)).toBe("5 messages · 12 clics");
    expect(postsClicksNote(1, 1)).toBe("1 message · 1 clic");
    expect(postsClicksNote(1, 0)).toBe("1 message · 0 clic");
  });

  it("les 8 meilleures heures, dans l'ordre reçu (meilleures d'abord), avec tous leurs chiffres", () => {
    const bars = hourBars(hours);
    expect(bars).toHaveLength(8);
    expect(bars[0]).toEqual({
      key: "21",
      label: "21 h",
      value: 2.4,
      valueText: "2,4 clics par message",
      note: "5 messages · 12 clics",
    });
    expect(bars.map((b) => b.label).slice(0, 3)).toEqual(["21 h", "9 h", "14 h"]);
    expect(hourBars(hours, 2)).toHaveLength(2);
    expect(hourBars([])).toEqual([]);
  });
});

describe("Membres dans le temps et canaux", () => {
  it("part dans la semaine", () => {
    expect(sp(shareOf(1, 3))).toBe("33 %");
    expect(shareOf(1, 0)).toBe("—");
  });

  it("semaines dans l'ordre du temps", () => {
    const rows = [
      {
        week: "2026-10-05",
        members: 1,
        registered: 0,
        ftd: 0,
        deposits7: 0,
        deposits30: 0,
        ltv: 0,
      },
      {
        week: "2026-09-28",
        members: 2,
        registered: 0,
        ftd: 0,
        deposits7: 0,
        deposits30: 0,
        ltv: 0,
      },
    ];
    expect(cohortsChronological(rows).map((r) => r.week)).toEqual(["2026-09-28", "2026-10-05"]);
    expect(rows[0]!.week).toBe("2026-10-05"); // copie, pas de modification
  });

  it("croissance avec son signe, somme des canaux jour par jour", () => {
    expect(fmtSigned(12)).toBe("+12");
    expect(fmtSigned(-3)).toBe("−3");
    expect(fmtSigned(0)).toBe("0");
    expect(
      sumSeries(
        [
          [1, 2, 3],
          [0, -5, 1],
        ],
        3,
      ),
    ).toEqual([1, -3, 4]);
    expect(sumSeries([], 2)).toEqual([0, 0]);
    expect(fmtPerPost(2.456)).toBe("2,46");
  });
});

describe("jours", () => {
  it("libellé court en français", async () => {
    const { dayLabel, dayLabels } = await import("./display");
    expect(dayLabel("2026-10-04")).toBe("4 oct.");
    expect(dayLabels(["2026-09-30", "2026-10-01"])).toEqual(["30 sept.", "1 oct."]);
  });
});

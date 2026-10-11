import { describe, expect, it } from "vitest";
import {
  STATS_PAGES,
  funnelDimension,
  funnelScopeLabel,
  moreFiltersCount,
  parseFunnelDim,
  parseStatsFilters,
  periodSentence,
  statsDefaultRange,
  statsHref,
  statsPage,
  statsParams,
  statsParamsFromForm,
} from "./stats-pages";

const NOW = new Date("2026-10-10T10:00:00Z");
const sp = (s: string) => s.replace(/[  ]/g, " ");

describe("rubriques des statistiques", () => {
  it("cinq pages dans l'ordre de la spécification, mots du client", () => {
    expect(STATS_PAGES.map((p) => [p.path, p.label])).toEqual([
      ["/stats", "Vue d'ensemble"],
      ["/stats/ads", "Pubs"],
      ["/stats/funnel", "Parcours"],
      ["/stats/channels", "Canaux"],
      ["/stats/cohorts", "Membres dans le temps"],
    ]);
    // Terme technique seulement au survol.
    expect(STATS_PAGES.find((p) => p.key === "funnel")?.term).toBe("entonnoir");
    expect(STATS_PAGES.find((p) => p.key === "cohorts")?.term).toBe("cohorte");
    for (const p of STATS_PAGES) {
      if (p.termOn) expect(p.description).toContain(p.termOn);
      expect(`${p.label} ${p.title} ${p.description}`).not.toMatch(
        /\b(FTD|NGR|ROAS|CPL|CPA|sub-ID|cohorte|entonnoir)\b/i,
      );
    }
  });
});

describe("titres des pages", () => {
  it("un titre qui ne se confond pas avec une entrée du menu ou un onglet de campagne", () => {
    // « Canaux » est aussi une entrée du menu, « Pubs » un onglet de chaque campagne : le <h1> précise.
    expect(statsPage("channels").title).toBe("Statistiques des canaux");
    expect(statsPage("ads").title).toBe("Statistiques des pubs");
    // L'onglet garde le mot court.
    expect(statsPage("channels").label).toBe("Canaux");
    expect(statsPage("ads").label).toBe("Pubs");
  });
});

describe("période par défaut de chaque page", () => {
  it("7 derniers jours partout, 90 jours pour « Membres dans le temps » (plusieurs semaines à comparer)", () => {
    expect(statsDefaultRange("/stats")).toBe("7d");
    expect(statsDefaultRange("/stats/ads")).toBe("7d");
    expect(statsDefaultRange("/stats/cohorts")).toBe("90d");
    expect(statsDefaultRange("/ailleurs")).toBe("7d");
  });

  it("sans période dans l'adresse : celle de la page ; une période choisie l'emporte", () => {
    const cohorts = (q: Record<string, string>) => parseStatsFilters(q, NOW, "90d");
    expect(cohorts({}).period).toMatchObject({ key: "90d", days: 90, to: "2026-10-10" });
    expect(cohorts({}).defaultPeriod).toBe(true);
    expect(cohorts({ range: "7d" }).period.key).toBe("7d");
    expect(cohorts({ range: "7d" }).defaultPeriod).toBe(false);
    expect(cohorts({ from: "2026-09-01", to: "2026-09-30" }).period).toMatchObject({
      key: "custom",
      days: 30,
    });
    // Période personnalisée incomplète : la période de la page.
    expect(cohorts({ range: "custom", from: "2026-09-01" }).period.key).toBe("90d");
    expect(parseStatsFilters({}, NOW).period.key).toBe("7d");
  });

  it("liens entre pages : une période par défaut n'est pas recopiée, chaque page prend la sienne", () => {
    const overview = parseStatsFilters({}, NOW);
    // De la vue d'ensemble (7 jours par défaut), « Membres dans le temps » s'ouvre sur 90 jours…
    expect(statsHref("/stats/cohorts", overview)).toBe("/stats/cohorts");
    // … et en revient sur les 7 jours de la vue d'ensemble.
    expect(statsHref("/stats", parseStatsFilters({}, NOW, "90d"))).toBe("/stats");
    // Période choisie : gardée, sauf si c'est celle par défaut de la page visée.
    const sevenDays = parseStatsFilters({ range: "7d" }, NOW, "90d");
    expect(statsHref("/stats/cohorts", sevenDays)).toBe("/stats/cohorts?range=7d");
    expect(statsHref("/stats", sevenDays)).toBe("/stats");
    const ninety = parseStatsFilters({ range: "90d" }, NOW);
    expect(statsHref("/stats/cohorts", ninety)).toBe("/stats/cohorts");
    expect(statsHref("/stats/ads", ninety)).toBe("/stats/ads?range=90d");
  });
});

describe("sélecteur commun", () => {
  it("lit période, comparaison, univers, campagne et canal", () => {
    const f = parseStatsFilters(
      { range: "30d", compare: "1", vertical: "CASINO", campaignId: "c1", channelId: "ch1" },
      NOW,
    );
    expect(f.period).toMatchObject({ key: "30d", to: "2026-10-10", days: 30 });
    expect(f.compare).toBe(true);
    expect(f.vertical).toBe("CASINO");
    expect(f.campaignId).toBe("c1");
    expect(f.channelId).toBe("ch1");
  });

  it("valeurs inconnues ignorées ; par défaut 7 jours sans comparaison", () => {
    const f = parseStatsFilters({ vertical: "POKER", compare: "non" }, NOW);
    expect(f).toMatchObject({ vertical: "", compare: false, campaignId: "", channelId: "" });
    expect(f.period.key).toBe("7d");
  });

  it("ancienne adresse du parcours : la dimension remplit le filtre vide correspondant", () => {
    expect(parseStatsFilters({ dim: "campaign:c9" }, NOW).campaignId).toBe("c9");
    expect(parseStatsFilters({ dim: "channel:ch9" }, NOW).channelId).toBe("ch9");
    expect(parseStatsFilters({ dim: "vertical:SPORTS" }, NOW).vertical).toBe("SPORTS");
    // Le filtre posé l'emporte.
    expect(parseStatsFilters({ dim: "campaign:c9", campaignId: "c1" }, NOW).campaignId).toBe("c1");
    expect(parseStatsFilters({ dim: "all" }, NOW)).toMatchObject({ campaignId: "", channelId: "" });
  });

  it("paramètres d'adresse : période, comparaison puis filtres posés", () => {
    const f = parseStatsFilters(
      { range: "custom", from: "2026-09-01", to: "2026-09-30", compare: "1", campaignId: "c1" },
      NOW,
    );
    expect(statsParams(f)).toEqual({
      range: "custom",
      from: "2026-09-01",
      to: "2026-09-30",
      compare: "1",
      campaignId: "c1",
    });
  });

  it("les liens entre pages gardent le sélecteur (sans écrire la période par défaut)", () => {
    const f = parseStatsFilters({ range: "30d", vertical: "DATING", channelId: "ch1" }, NOW);
    expect(statsHref("/stats/ads", f)).toBe("/stats/ads?range=30d&vertical=DATING&channelId=ch1");
    expect(statsHref("/stats", parseStatsFilters({}, NOW))).toBe("/stats");
    expect(statsHref("/stats/funnel", parseStatsFilters({ compare: "1" }, NOW))).toBe(
      "/stats/funnel?compare=1",
    );
    expect(
      statsHref("/stats/ads", parseStatsFilters({}, NOW), { ok: "Fait", error: undefined }),
    ).toBe("/stats/ads?ok=Fait");
  });

  it("retour d'une action : seules les clés du sélecteur sont reprises du formulaire", () => {
    expect(
      statsParamsFromForm([
        ["range", "90d"],
        ["compare", "1"],
        ["campaignId", "c1"],
        ["redirect", "https://ailleurs.example"],
        ["vertical", "INCONNU"],
      ]),
    ).toEqual({ range: "90d", compare: "1", campaignId: "c1" });
    expect(statsParamsFromForm([])).toEqual({});
  });

  it("« Plus de filtres » compte le canal", () => {
    expect(moreFiltersCount({ channelId: "" })).toBe(0);
    expect(moreFiltersCount({ channelId: "x" })).toBe(1);
  });
});

describe("parcours : une dimension à la fois", () => {
  it("campagne, puis canal, puis univers, puis tout (comme l'ancien tableau de bord)", () => {
    expect(funnelDimension({ campaignId: "c1", channelId: "ch1", vertical: "CASINO" })).toBe(
      "campaign:c1",
    );
    expect(funnelDimension({ campaignId: "", channelId: "ch1", vertical: "CASINO" })).toBe(
      "channel:ch1",
    );
    expect(funnelDimension({ campaignId: "", channelId: "", vertical: "CASINO" })).toBe(
      "vertical:CASINO",
    );
    expect(funnelDimension({ campaignId: "", channelId: "", vertical: "" })).toBe("all");
  });

  it("dimension de l'ancienne adresse", () => {
    expect(parseFunnelDim("campaign:c1")).toEqual({ kind: "campaign", id: "c1" });
    expect(parseFunnelDim("vertical:CASINO")).toEqual({ kind: "vertical", id: "CASINO" });
    expect(parseFunnelDim("vertical:POKER")).toBeNull();
    expect(parseFunnelDim("all")).toBeNull();
    expect(parseFunnelDim("")).toBeNull();
  });

  it("phrase qui dit ce qui est montré", () => {
    const none = { campaignId: "", channelId: "", vertical: "" as const };
    expect(funnelScopeLabel(none, {})).toBe("Parcours de toutes vos pubs et de tous vos canaux");
    expect(funnelScopeLabel({ ...none, campaignId: "c1" }, { campaign: "TT casino" })).toBe(
      "Parcours de la campagne « TT casino »",
    );
    expect(funnelScopeLabel({ ...none, channelId: "x" }, { channel: "VIP" })).toBe(
      "Parcours du canal « VIP »",
    );
    expect(funnelScopeLabel({ ...none, vertical: "DATING" }, {})).toBe(
      "Parcours de l'univers Rencontres",
    );
  });
});

describe("phrase de la période", () => {
  it("avec les dates, et la période précédente quand on compare", () => {
    const p = parseStatsFilters({ range: "7d" }, NOW).period;
    expect(sp(periodSentence(p, false))).toBe("7 derniers jours (4 oct. – 10 oct. 2026)");
    expect(sp(periodSentence(p, true))).toBe(
      "7 derniers jours (4 oct. – 10 oct. 2026), comparés à la période précédente (du 27 sept. au 3 oct. 2026)",
    );
  });
});

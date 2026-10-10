import { describe, expect, it } from "vitest";
import {
  STATS_PAGES,
  funnelDimension,
  funnelScopeLabel,
  moreFiltersCount,
  parseFunnelDim,
  parseStatsFilters,
  periodSentence,
  statsHref,
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

import { describe, expect, it } from "vitest";
import {
  COUNTRY_CODES,
  DEFAULT_MIN_SCORE,
  countryName,
  evidenceList,
  marketRecView,
  parseAnalysesView,
  parseRuleFilters,
  parseTrendFilters,
  reportLines,
  reportSources,
  reportText,
  safeUrl,
  sourceState,
  viewHref,
  weekStartUtc,
  weeklyCounts,
} from "./analyses";

// Agents → Analyses (phase 29) : fonctions pures de la page.
describe("vues et filtres", () => {
  it("vue lue dans l'adresse, tendances par défaut ; adresses des vues", () => {
    expect(parseAnalysesView(undefined)).toBe("tendances");
    expect(parseAnalysesView("regles")).toBe("regles");
    expect(parseAnalysesView(["sources"])).toBe("sources");
    expect(parseAnalysesView("../x")).toBe("tendances");
    expect(viewHref("tendances")).toBe("/agents/analyses");
    expect(viewHref("regles", { pays: "FR", marche: null })).toBe("/agents/analyses?vue=regles&pays=FR");
  });

  it("filtres des tendances : valeurs connues seulement, pertinence 1 à 10, seuil de la veille par défaut", () => {
    expect(parseTrendFilters({})).toEqual({ market: null, country: null, category: null, sentiment: null, minScore: DEFAULT_MIN_SCORE });
    expect(DEFAULT_MIN_SCORE).toBe(5);
    expect(parseTrendFilters({ marche: "CASINO", pays: "fr", categorie: "AD_BAN", ton: "NEGATIVE", score: "8" })).toEqual({
      market: "CASINO",
      country: "FR",
      category: "AD_BAN",
      sentiment: "NEGATIVE",
      minScore: 8,
    });
    expect(parseTrendFilters({ marche: "POKER", pays: "US", categorie: "x", ton: "y", score: "11" })).toEqual(parseTrendFilters({}));
  });

  it("filtres des règles : plateforme × pays × marché × risque", () => {
    expect(parseRuleFilters({ plateforme: "TIKTOK", pays: "DE", marche: "DATING", risque: "BAN" })).toEqual({ platform: "TIKTOK", country: "DE", market: "DATING", risk: "BAN" });
    expect(parseRuleFilters({ plateforme: "MYSPACE", risque: "HUGE" })).toEqual({ platform: null, country: null, market: null, risk: null });
  });

  it("pays en français, triés ; « tous les pays »", () => {
    expect(countryName("FR")).toBe("France");
    expect(countryName("DE")).toBe("Allemagne");
    expect(countryName("ALL")).toBe("Tous les pays");
    expect(COUNTRY_CODES[0]).toBe("DE");
    expect(COUNTRY_CODES).toContain("PL");
  });
});

describe("courbe des entrées par semaine", () => {
  it("semaines du lundi, de la plus ancienne à la semaine en cours ; entrées plus anciennes ignorées", () => {
    expect(weekStartUtc(new Date("2026-10-25T12:00:00Z")).toISOString()).toBe("2026-10-19T00:00:00.000Z");
    const now = new Date("2026-10-25T12:00:00Z");
    const c = weeklyCounts([new Date("2026-10-20T08:00:00Z"), new Date("2026-10-25T08:00:00Z"), new Date("2026-10-13T08:00:00Z"), new Date("2025-01-01T00:00:00Z")], now, 3);
    expect(c.values).toEqual([0, 1, 2]);
    expect(c.labels).toEqual(["sem. du 5 oct.", "sem. du 12 oct.", "sem. du 19 oct."]);
  });
});

describe("sources et preuves", () => {
  it("adresses http(s) seulement", () => {
    expect(safeUrl("https://x.com/a")).toBe("https://x.com/a");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("pas une adresse")).toBeNull();
  });

  it("preuves : liste d'objets, de liens, ou { sources } ; sans adresse valable : écartée", () => {
    expect(
      evidenceList([
        { url: "https://www.facebook.com/policies/ads", date: "2026-10-12", description: "Politique jeux d'argent" },
        "https://forum.example/t/1",
        { url: "javascript:x" },
        { title: "sans lien" },
      ]),
    ).toEqual([
      { url: "https://www.facebook.com/policies/ads", date: "2026-10-12", description: "Politique jeux d'argent" },
      { url: "https://forum.example/t/1", date: null, description: null },
    ]);
    expect(evidenceList({ sources: [{ url: "https://a.example", title: "A" }] })).toEqual([{ url: "https://a.example/", date: null, description: "A" }]);
    expect(evidenceList(null)).toEqual([]);
  });

  it("état d'une source : en erreur, active, à valider (trouvée par la veille, jamais lue), inactive", () => {
    const base = { isActive: true, errorCount: 0, lastError: null, origin: "seed", lastScrapedAt: null };
    expect(sourceState(base)).toBe("ACTIVE");
    expect(sourceState({ ...base, errorCount: 5, lastError: "403", isActive: false })).toBe("ERROR");
    expect(sourceState({ ...base, isActive: false, origin: "discovered" })).toBe("PROPOSED");
    expect(sourceState({ ...base, isActive: false, origin: "discovered", lastScrapedAt: new Date() })).toBe("INACTIVE");
    expect(sourceState({ ...base, isActive: false })).toBe("INACTIVE");
  });
});

describe("rapports et recommandations", () => {
  it("texte d'un rapport : remis en clair (briefing échappé), adresses en liens, sources sans doublon", () => {
    expect(reportText({ text: "Briefing casino, France\n- Les streams &amp; les bonus (https://www.reddit.com/r/x)." })).toBe(
      "Briefing casino, France\n- Les streams & les bonus (https://www.reddit.com/r/x).",
    );
    expect(reportText({ writtenBy: "ai" })).toBeNull();
    expect(reportLines("- Hausse du live (https://news.example/a).\n\nFin")).toEqual([
      [
        { text: "- Hausse du live (", url: null },
        { text: "news.example", url: "https://news.example/a" },
        { text: ").", url: null },
      ],
      [{ text: "", url: null }],
      [{ text: "Fin", url: null }],
    ]);
    expect(reportSources({ sources: [{ url: "https://a.example/x", date: null }, { url: "https://a.example/x", date: null }, { url: "ftp://b" }] })).toEqual([
      { url: "https://a.example/x", date: null, description: null },
    ]);
  });

  it("recommandation du Stratège : titre, marché (« DATING:ES »), pays, risque, type, angle, format, preuves, non vérifiée", () => {
    const v = marketRecView(
      {
        id: "r1",
        field: "strategy",
        targetId: "DATING:ES",
        after: { title: "Vidéos face caméra de 15 s", description: "Témoignage sans texte", countries: ["ES", "zz"], adType: "UGC", angle: "TEMOIGNAGE", format: "15 s vertical", platform: "TIKTOK", risk: "LOW", priority: 1 },
        evidence: { agent: "stratege", sources: [{ url: "https://forum.example/t/9", date: "2026-10-20" }], verified: false },
        status: "PROPOSED",
        comment: null,
        createdAt: new Date(),
        appliedAt: null,
        rejectedAt: null,
      },
      { adType: { UGC: "vidéo façon témoignage d'utilisateur" }, angle: { TEMOIGNAGE: "témoignage" } },
    );
    expect(v).toMatchObject({
      title: "Vidéos face caméra de 15 s",
      market: "DATING",
      countries: ["ES"],
      risk: "LOW",
      priority: "1",
      platform: "TIKTOK",
      details: ["vidéo façon témoignage d'utilisateur", "angle témoignage", "15 s vertical"],
      evidence: [{ url: "https://forum.example/t/9" }],
      verified: false,
    });
    const bare = marketRecView({ ...v, field: "angle", targetId: "x", after: "Angle témoignage", evidence: {}, appliedAt: new Date() });
    expect(bare).toMatchObject({ title: "Angle témoignage", market: null, evidence: [], verified: false, acceptedAt: expect.any(Date) });
  });
});

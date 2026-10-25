import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { h1Count, primaryButtonCount, visibleText } from "../../settings/categories/page-checks";
import { AGENTS_JARGON, jargonIn } from "@/tests/vocabulary/jargon-scan";
import type { ReportDetail, ReportRow, RuleRow, SourceRow, TrendRow } from "@/lib/agents/analyses-queries";
import type { MarketRecView } from "@/lib/agents/analyses";

// Pages Agents → Analyses (5 vues) et lecture d'un rapport, rendues côté serveur, données simulées.
const m = vi.hoisted(() => ({
  user: { id: "u1", role: "ADMIN" as "ADMIN" | "MANAGER" },
  trends: { rows: [] as unknown[], total: 0, weekDates: [] as Date[] },
  rules: [] as unknown[],
  reports: [] as unknown[],
  report: null as unknown,
  sources: [] as unknown[],
  recs: [] as unknown[],
  calls: {} as Record<string, unknown[]>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/agents/analyses",
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => m.user) }));
vi.mock("@/app/(admin)/agents/analyses/actions", () => ({
  activateSourceAction: vi.fn(),
  deactivateSourceAction: vi.fn(),
  deleteSourceAction: vi.fn(),
  decideMarketRecommendationAction: vi.fn(),
}));
vi.mock("@/lib/agents/queries", () => ({ loadPendingCounts: vi.fn(async () => ({ validations: 0, requests: 0 })) }));
vi.mock("@/lib/agents/analyses-queries", () => {
  const track =
    <T,>(name: string, value: () => T) =>
    async (...a: unknown[]) => {
      m.calls[name] = a;
      return value();
    };
  return {
    loadTrends: track("trends", () => m.trends),
    loadRules: track("rules", () => m.rules),
    loadReports: track("reports", () => m.reports),
    loadReport: track("report", () => m.report),
    loadSources: track("sources", () => m.sources),
    loadMarketRecommendations: track("recs", () => m.recs),
    loadAnalysesCounts: vi.fn(async () => ({ sourcesInError: 1, sourcesProposed: 1, recsOpen: 1 })),
  };
});
vi.mock("@linkaffipro/db", () => ({ prisma: {}, audit: vi.fn() }));

import Page from "./page";
import ReportPage from "./rapports/[id]/page";

const trend = (o: Partial<TrendRow> = {}): TrendRow => ({
  id: "t1",
  market: "CASINO",
  countries: ["FR"],
  language: "fr",
  title: "Les pubs « gros gain » bannies sur TikTok",
  summary: "Plusieurs affiliés disent que TikTok coupe les pubs casino qui montrent un gain en France.",
  url: "https://www.blackhatworld.com/threads/1",
  author: "affil75",
  publishedAt: new Date("2026-10-20T10:00:00Z"),
  createdAt: new Date("2026-10-21T10:00:00Z"),
  category: "AD_BAN",
  sentiment: "NEGATIVE",
  relevanceScore: 8,
  verified: false,
  tags: ["tiktok_ban"],
  sourceName: "BlackHatWorld",
  ...o,
});

const rule = (o: Partial<RuleRow> = {}): RuleRow => ({
  id: "c1",
  platform: "META",
  market: "CASINO",
  country: "FR",
  rule: "Les pubs casino doivent viser les plus de 18 ans et avoir l'accord écrit de Meta.",
  riskLevel: "BAN",
  evidence: [{ url: "https://www.facebook.com/policies/ads/restricted", date: "2026-10-12", description: "Politique jeux d'argent" }],
  verified: true,
  workaround: null,
  lastVerifiedAt: new Date("2026-10-22T08:00:00Z"),
  updatedAt: new Date("2026-10-22T08:00:00Z"),
  ...o,
});

const reportRow = (o: Partial<ReportRow> = {}): ReportRow => ({
  id: "w1",
  market: null,
  countries: [],
  period: "2026-W43",
  reportType: "WEEKLY",
  title: "Rapport de la semaine 43",
  summary: "Casino : les vidéos de gains marchent en Allemagne.",
  requestText: null,
  sentAt: new Date("2026-10-19T06:00:00Z"),
  createdAt: new Date("2026-10-19T06:00:00Z"),
  ...o,
});

const source = (o: Partial<SourceRow> = {}): SourceRow => ({
  id: "s1",
  name: "Reddit r/gambling",
  url: "https://www.reddit.com/r/gambling",
  sourceType: "REDDIT",
  market: "CASINO",
  countries: ["GB", "IE"],
  languages: ["en"],
  isActive: true,
  origin: "seed",
  lastScrapedAt: new Date("2026-10-25T04:00:00Z"),
  nextScrapeAt: new Date("2026-10-26T04:00:00Z"),
  errorCount: 0,
  lastError: null,
  entries: 42,
  ...o,
});

const rec = (o: Partial<MarketRecView> = {}): MarketRecView => ({
  id: "r1",
  title: "Vidéos face caméra de 15 secondes",
  description: "Témoignage sans texte incrusté pour les rencontres en Espagne.",
  market: "DATING",
  countries: ["ES"],
  risk: "LOW",
  priority: "1",
  details: ["vidéo façon témoignage d'utilisateur", "angle témoignage"],
  platform: "TIKTOK",
  evidence: [{ url: "https://forum.example/t/9", date: "2026-10-20", description: "Retour d'un affilié" }],
  verified: false,
  status: "PROPOSED",
  comment: null,
  createdAt: new Date("2026-10-20T08:00:00Z"),
  acceptedAt: null,
  rejectedAt: null,
  ...o,
});

function checks(html: string) {
  expect(h1Count(html)).toBe(1);
  expect(primaryButtonCount(html)).toBeLessThanOrEqual(1);
  const text = visibleText(html);
  expect(jargonIn(text)).toEqual([]);
  expect(AGENTS_JARGON.filter((r) => r.re.test(text)).map((r) => r.word)).toEqual([]);
  return text;
}
const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(sp) } as never));
const renderReport = async (id = "w1") => renderToStaticMarkup(await ReportPage({ params: Promise.resolve({ id }) } as never));

beforeEach(() => {
  m.user = { id: "u1", role: "ADMIN" };
  m.trends = { rows: [trend(), trend({ id: "t2", market: "SPORTS", verified: true, sentiment: "POSITIVE", category: "AD_CREATIVE", title: null, summary: "Les pronostics en vidéo courte progressent en Allemagne.", countries: ["DE"], sourceName: "SBC News", url: "https://sbcnews.co.uk/a", author: null })], total: 2, weekDates: [new Date(), new Date()] };
  m.rules = [rule({ id: "c2", riskLevel: "LOW", verified: false, platform: "TIKTOK", country: "ALL", rule: "Les pubs de rencontres sans contenu suggestif passent.", market: "DATING" }), rule()];
  m.reports = [reportRow(), reportRow({ id: "b1", reportType: "ON_DEMAND", market: "CASINO", countries: ["DE"], period: "2026-10-24", title: "Briefing casino Allemagne", requestText: "briefing casino Allemagne" })];
  m.report = null;
  m.sources = [
    source(),
    source({ id: "s2", name: "BlackHatWorld", url: "https://www.blackhatworld.com/forums/gambling", sourceType: "FORUM", isActive: false, origin: "discovered", lastScrapedAt: null, nextScrapeAt: null, entries: 0 }),
    source({ id: "s3", name: "iGaming Business", url: "https://igamingbusiness.com", sourceType: "NEWS", isActive: false, errorCount: 5, lastError: "le site répond 503" }),
  ];
  m.recs = [rec(), rec({ id: "r2", status: "APPLIED", title: "Couper les pubs bonus en France", comment: "fait lundi", acceptedAt: new Date("2026-10-22T08:00:00Z"), risk: "HIGH", verified: true })];
  m.calls = {};
});

describe("Agents → Analyses : tendances (vue par défaut)", () => {
  it("entrées par marché, source cliquable, date, « non vérifiée », courbe par semaine, onglet de la sous-navigation", async () => {
    const html = await render({ pays: "FR", categorie: "AD_BAN", score: "7" });
    const text = checks(html);
    expect(m.calls.trends?.[0]).toMatchObject({ country: "FR", category: "AD_BAN", minScore: 7, market: null });
    for (const t of [
      "Analyses",
      "Tendances",
      "Règles publicitaires",
      "Rapports",
      "Sources",
      "Recommandations",
      "Casino",
      "Paris sportifs",
      "Ce qui fait bannir",
      "Négatif",
      "Pertinence 8/10",
      "Non vérifiée",
      "BlackHatWorld (blackhatworld.com)",
      "publié le",
      "par affil75",
      "France",
      "Entrées par semaine",
      "Voir les chiffres semaine par semaine",
      "Parler à Kevin",
    ])
      expect(text).toContain(t);
    expect(html).toContain('href="https://www.blackhatworld.com/threads/1"');
    expect(html).toContain('href="/agents/analyses"');
    expect(html).toMatch(/<svg[^>]*role="img"/);
    // Une seule entrée « non vérifiée » (la seconde est recoupée).
    expect(text.match(/Non vérifiée/g)).toHaveLength(1);
  });

  it("rien pour ces filtres : effacer les filtres ; rien du tout : premier passage", async () => {
    m.trends = { rows: [], total: 0, weekDates: [] };
    expect(checks(await render({ marche: "DATING" }))).toContain("Rien pour ces filtres");
    expect(checks(await render())).toContain("Pas encore de tendance");
  });
});

describe("Agents → Analyses : règles publicitaires", () => {
  it("filtres, plus risquées d'abord, preuves avec liens, vérifiée ou non, dernière vérification, mention fixe", async () => {
    const html = await render({ vue: "regles", plateforme: "META", risque: "BAN", pays: "FR", marche: "CASINO" });
    const text = checks(html);
    expect(m.calls.rules?.[0]).toEqual({ platform: "META", country: "FR", market: "CASINO", risk: "BAN" });
    for (const t of [
      "Ce qui est observé sur les plateformes, pas un avis juridique",
      "Fait bannir",
      "Risque faible",
      "Meta (Facebook, Instagram)",
      "TikTok",
      "Tous les pays",
      "Vérifiée par plusieurs sources",
      "Non vérifiée",
      "Dernière vérification le",
      "Politique jeux d'argent",
    ])
      expect(text).toContain(t);
    expect(html).toContain('href="https://www.facebook.com/policies/ads/restricted"');
    expect(text.indexOf("accord écrit de Meta")).toBeLessThan(text.indexOf("sans contenu suggestif"));
  });
});

describe("Agents → Analyses : rapports", () => {
  it("liste du lundi et à la demande, lien vers la lecture en ligne", async () => {
    const html = await render({ vue: "rapports" });
    const text = checks(html);
    for (const t of ["Rapport de la semaine 43", "Rapport du lundi", "À la demande", "Briefing casino Allemagne", "Tous les marchés"]) expect(text).toContain(t);
    expect(html).toContain('href="/agents/analyses/rapports/w1"');
  });

  it("lecture d'un rapport : résumé, parties avec sources, recommandations ; inconnu : introuvable", async () => {
    m.report = {
      ...reportRow(),
      content: {
        text: "📊 Rapport de la semaine 43\n\n🎰 Casino\n- Les vidéos de gains marchent en Allemagne (https://news.example/a)",
        writtenBy: "ai",
        markets: [],
        sources: [{ url: "https://news.example/a", date: null }],
      },
      recommendations: [{ title: "Tester trois vidéos de gains", description: "Allemagne, 15 s", risk: "MEDIUM", sources: [{ url: "https://news.example/a", date: "2026-10-18" }], verified: false }],
    } satisfies ReportDetail;
    const html = await renderReport();
    const text = checks(html);
    for (const t of ["Rapport de la semaine 43", "Tous les rapports", "Le rapport", "🎰 Casino", "Les vidéos de gains marchent en Allemagne", "news.example", "Tester trois vidéos de gains", "Risque moyen", "Non vérifiée", "Sources du rapport", "envoyé par Kevin le"])
      expect(text).toContain(t);
    expect(text).not.toContain("writtenBy");
    expect(html).toContain('href="https://news.example/a"');
    m.report = null;
    await expect(renderReport()).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(renderReport("../x")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("Agents → Analyses : sources", () => {
  it("administrateur : états, dernière erreur, dernière collecte, boutons Activer / Désactiver / Supprimer (mot SUPPRIMER)", async () => {
    const html = await render({ vue: "sources" });
    const text = checks(html);
    for (const t of ["Active", "À valider", "En erreur", "5 échecs de suite : le site répond 503", "Dernière collecte le", "Jamais lue", "42 entrées", "Trouvée par la veille", "Activer", "Désactiver", "Supprimer la source", "Pour confirmer, tapez SUPPRIMER"])
      expect(text).toContain(t);
    expect(html).toContain('name="sourceId"');
    expect(html).toContain('name="confirm"');
  });

  it("responsable : lecture seule, aucun bouton", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    const html = await render({ vue: "sources" });
    const text = checks(html);
    expect(text).toContain("Seuls les administrateurs peuvent activer, désactiver ou supprimer une source.");
    expect(html).not.toContain('name="sourceId"');
    expect(text).toContain("Reddit r/gambling");
  });
});

describe("Agents → Analyses : recommandations", () => {
  it("à décider (numérotées) puis décidées ; Accepter / Refuser avec commentaire ; aucune action externe", async () => {
    const html = await render({ vue: "recommandations" });
    const text = checks(html);
    for (const t of ["À décider", "1. Vidéos face caméra de 15 secondes", "Rencontres", "Espagne", "Risque faible", "Retour d'un affilié", "vidéo façon témoignage d'utilisateur · angle témoignage · Espagne · priorité 1", "Non vérifiée", "Accepter", "Refuser", "Acceptées ou refusées", "Acceptée", "Votre commentaire : fait lundi", "rien chez Meta, TikTok"])
      expect(text).toContain(t);
    expect((html.match(/name="id"/g) ?? []).length).toBe(1);
  });

  it("responsable : peut décider aussi", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    expect(await render({ vue: "recommandations" })).toContain('value="APPLIED"');
  });
});

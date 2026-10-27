import { describe, expect, it } from "vitest";
import { DEFAULT_COUNTRIES_SCOPE, type ProspectMetrics, type ProspectPost } from "../contract";
import { fakeSignals } from "./fake";
import { hardFilters } from "./filters";
import { detectGeo } from "./geo";
import { detectLanguage, detectLanguageConfirmed, detectTextLanguage } from "./language";
import { computeMetrics } from "./metrics";
import { parseProspectPreview } from "./posts";
import { createFakePrisma } from "../../testing/fake-prisma";
import { ENRICH_FIXTURE_NOW, fakeProspectionLlm, readEnrichFixture } from "./testing";

const NOW = ENRICH_FIXTURE_NOW;
const scope = [...DEFAULT_COUNTRIES_SCOPE];

/** Posts d'une fixture d'aperçu (une page), avec le texte décodé par le lecteur de la phase 27. */
async function fixturePosts(name: string): Promise<ProspectPost[]> {
  const { parsePreviewPage } = await import("../../inspiration/sources/web-preview");
  const html = readEnrichFixture(`tme-s/${name}.html`);
  const base = parsePreviewPage(html, name).posts;
  const extra = new Map(parseProspectPreview(html, name).posts.map((p) => [p.id, p]));
  return base.map((p) => {
    const x = extra.get(p.externalId)!;
    return { ...x, id: p.externalId, postedAt: p.postedAt, text: p.text ?? "", mediaKind: p.mediaKind, views: p.views };
  });
}

const metrics = (over: Partial<ProspectMetrics>): ProspectMetrics => ({
  postsPerDay: 1,
  medianViews: 1000,
  avgViews: 1000,
  viewRate: 0.1,
  viewVarianceCv: 0.3,
  forwardRatio: 0,
  reactionRate: null,
  commentRate: null,
  linkDensity: 0,
  postingHours: null,
  firstSeenPostAt: new Date(NOW.getTime() - 30 * 86_400_000),
  lastPostAt: new Date(NOW.getTime() - 86_400_000),
  posts30d: 30,
  postCount: 30,
  ...over,
});
const settings = { minPosts30d: 8, minMedianViews: 100, now: NOW };

describe("filtres durs", () => {
  it("aucun filtre pour un canal vivant", () => expect(hardFilters(metrics({}), settings)).toEqual([]));
  it("abandonné > 21 jours", () => {
    const hits = hardFilters(metrics({ lastPostAt: new Date(NOW.getTime() - 40 * 86_400_000) }), settings);
    expect(hits[0]).toEqual({ code: "ABANDONED", reason: "abandonné : aucun post depuis 40 jours" });
  });
  it("quasi mort, audience faible, repost", () => {
    expect(hardFilters(metrics({ postsPerDay: 0.2 }), settings).map((h) => h.code)).toEqual(["NEARLY_DEAD"]);
    expect(hardFilters(metrics({ medianViews: 60 }), settings).map((h) => h.code)).toEqual(["LOW_AUDIENCE"]);
    expect(hardFilters(metrics({ forwardRatio: 0.71 }), settings).map((h) => h.code)).toEqual(["REPOST"]);
    expect(hardFilters(metrics({ forwardRatio: 0.7 }), settings)).toEqual([]);
  });
  it("aucun post lu : rien n'est jugé", () => expect(hardFilters(metrics({ postCount: 0, postsPerDay: 0 }), settings)).toEqual([]));
});

describe("signaux de faux", () => {
  it("canal à vues constantes et textes mécaniques : 3 signaux", async () => {
    const posts = await fixturePosts("bot_odds_feed");
    const m = computeMetrics(posts, 250_310, NOW);
    expect(fakeSignals(posts, m).sort()).toEqual(["SUSPECT_BOT_CONTENT", "SUSPECT_FAKE_SUBS", "SUSPECT_VIEW_BOT"]);
  });
  it("vues achetées : variation < 0,05 sur au moins 20 posts", () => {
    const posts = Array.from({ length: 20 }, (_, i) => ({ id: i, postedAt: NOW, text: `post ${"x".repeat(i * 7)}`, mediaKind: "text", views: 5000 + (i % 2) * 10, forwardedFrom: null, comments: null, reactions: null, buttons: [], signature: null, links: [], mentions: [] }));
    const m = computeMetrics(posts, 20_000, NOW);
    expect(fakeSignals(posts, m)).toContain("SUSPECT_VIEW_BOT");
    expect(fakeSignals(posts.slice(0, 19), computeMetrics(posts.slice(0, 19), 20_000, NOW))).not.toContain("SUSPECT_VIEW_BOT");
  });
  it("vues élevées sans engagement alors que les réactions sont activées", () => {
    const posts = Array.from({ length: 20 }, (_, i) => ({ id: i, postedAt: NOW, text: `un texte ${"y".repeat(i * 9)}`, mediaKind: "text", views: 3000 + i * 400, forwardedFrom: null, comments: null, reactions: i === 0 ? 1 : 0, buttons: [], signature: null, links: [], mentions: [] }));
    expect(fakeSignals(posts, computeMetrics(posts, 20_000, NOW))).toEqual(["SUSPECT_NO_ENGAGEMENT"]);
  });
  it("vrai canal : aucun signal", async () => {
    const posts = await fixturePosts("pronos_maxime");
    expect(fakeSignals(posts, computeMetrics(posts, 17_345, NOW))).toEqual([]);
  });
});

describe("langue", () => {
  it("un texte par langue", () => {
    expect(detectTextLanguage("Je pense que la victoire est jouable ce soir pour le match")).toBe("fr");
    expect(detectTextLanguage("Heute haben wir eine sehr gute Wette für das Spiel")).toBe("de");
    expect(detectTextLanguage("Secondo me la partita di oggi finisce con almeno due gol")).toBe("it");
    expect(detectTextLanguage("Hoy tenemos una apuesta muy buena para el partido")).toBe("es");
    expect(detectTextLanguage("Hoje temos uma aposta muito boa para o jogo, você vai ganhar")).toBe("pt");
    expect(detectTextLanguage("Прогноз на матч сегодня, ставка на победу")).toBe("ru");
    expect(detectTextLanguage("Σήμερα έχουμε ένα πολύ καλό στοίχημα")).toBe("el");
    expect(detectTextLanguage("Bugün maç için çok iyi bir bahis var")).toBe("tr");
  });
  it("canal français : confiance haute, pas de mélange", async () => {
    const g = detectLanguage((await fixturePosts("pronos_maxime")).map((p) => p.text));
    expect(g.language).toBe("fr");
    expect(g.confidence).toBeGreaterThanOrEqual(0.8);
    expect(g.mixed).toBe(false);
  });
  it("canal multilingue : mélange → confirmation Haiku (500 jetons au plus)", async () => {
    const texts = (await fixturePosts("multi_bets_world")).map((p) => p.text);
    expect(detectLanguage(texts).mixed).toBe(true);
    const llm = fakeProspectionLlm();
    const r = await detectLanguageConfirmed({ prisma: createFakePrisma(), enqueue: { async orchestrator() {}, async step() {} }, now: () => NOW, prospectionLlm: llm }, texts, { channel: "multi_bets_world" });
    expect(r).toMatchObject({ language: "en", mixed: true, confirmedByAi: true });
    expect(llm.calls[0]!.model).toBe("claude-haiku-5-5");
    expect(llm.calls[0]!.maxTokens).toBeLessThanOrEqual(500);
  });
  it("IA absente : résultat du code gardé", async () => {
    const r = await detectLanguageConfirmed({ prisma: createFakePrisma(), enqueue: { async orchestrator() {}, async step() {} }, prospectionLlm: null }, ["Hello", "Hola"]);
    expect(r.confirmedByAi).toBe(false);
  });
});

const geoOf = (texts: string[], language: string, brands: string[] = [], links: string[] = [], description: string | null = null) => detectGeo({ texts, description, brands, links, language }, scope);

describe("pays et région : par les signaux, pas par la langue", () => {
  it("pt-PT contre pt-BR", () => {
    const pt = geoOf(["Prognóstico Primeira Liga: Benfica x FC Porto. A equipa da casa marca, apostas desportivas, golo no fim, 10 €"], "pt", ["placard", "betano"]);
    expect(pt).toMatchObject({ region: "EU" });
    expect(pt.countries[0]).toBe("PT");
    expect(pt.geoSignals.spelling).toBe("pt-PT");
    const br = geoOf(["Palpite Brasileirão: Flamengo x Palmeiras. O time vem forte, galera, apostas esportivas, R$ 50 no pix"], "pt", ["estrelabet"]);
    expect(br.countries[0]).toBe("BR");
    expect(br.region).toBe("NON_EU");
  });
  it("es-ES contre Amérique latine (Caliente, pesos, Liga MX)", () => {
    const es = geoOf(["Pronóstico LaLiga: Real Madrid - Sevilla, apuestas deportivas con Codere, 20 euros, vosotros"], "es", ["codere"]);
    expect(es.countries[0]).toBe("ES");
    expect(es.region).toBe("EU");
    const mx = geoOf(["Pronóstico Liga MX: América vs Chivas, ahorita en Caliente, gana 500 pesos desde tu celular"], "es", ["caliente"]);
    expect(mx.countries[0]).toBe("MX");
    expect(mx.region).toBe("NON_EU");
  });
  it("en-GB contre en-US, en-IN, en-NG", () => {
    expect(geoOf(["Premier League acca tonight, each way on Arsenal, £10 at bet365, the bookies favourite"], "en", ["bet365"]).countries[0]).toBe("GB");
    expect(geoOf(["NFL parlay tonight, moneyline on the Chiefs, $50 at the sportsbook"], "en").countries[0]).toBe("US");
    expect(geoOf(["IPL match prediction today, cricket, win 1 lakh rupees"], "en").countries[0]).toBe("IN");
    const ng = geoOf(["Sure odds booking code for today, naija punters, bet9ja 1000 naira"], "en", ["bet9ja"]);
    expect(ng.countries[0]).toBe("NG");
    expect(ng.region).toBe("NON_EU");
  });
  it("de-DE contre de-AT et de-CH", () => {
    expect(geoOf(["Bundesliga heute: Bayern München gegen BVB, Sportwetten bei Tipico, 10 €"], "de", ["tipico"]).countries[0]).toBe("DE");
    expect(geoOf(["Servus! Rapid Wien gegen Sturm Graz, ÖFB-Cup, win2day, 10 € Einsatz, Jänner"], "de", ["win2day"]).countries[0]).toBe("AT");
    expect(geoOf(["Grüezi! FC Basel gegen Young Boys, Super League, Einsatz 20 CHF, Zürich"], "de").countries[0]).toBe("CH");
  });
  it("fr-FR contre fr-BE, fr-CH, fr-CA", () => {
    expect(geoOf(["Ligue 1 ce soir : PSG - OM, cote 1.85 chez Winamax, 10 €"], "fr", ["winamax"]).countries[0]).toBe("FR");
    expect(geoOf(["Jupiler Pro League : Anderlecht - Club Brugge, septante euros chez Betfirst"], "fr", ["betfirst"]).countries[0]).toBe("BE");
    expect(geoOf(["Super League : Servette - FC Lugano, mise de 20 CHF, Genève, septante"], "fr").countries[0]).toBe("CH");
    expect(geoOf(["LNH ce soir à Québec, envoie-moi un courriel"], "fr").countries[0]).toBe("CA");
  });
  it("russe → hors Europe par défaut", () => {
    const ru = geoOf(["Прогноз на матч сегодня, ставка на победу"], "ru");
    expect(ru.countries[0]).toBe("RU");
    expect(ru.region).toBe("NON_EU");
  });
  it("marque offshore hors Europe : −2 pour les pays européens", () => {
    const g = geoOf(["Ligue 1 ce soir, 1win bonus"], "fr", ["1win"]);
    expect(g.geoSignals.offshoreBrands).toContain("1win");
    expect(g.region).not.toBe("EU");
  });
  it("aucun signal : région inconnue", () => {
    expect(geoOf(["Today we have a strong pick for you"], "en")).toMatchObject({ region: "UNKNOWN", countries: [] });
  });
});

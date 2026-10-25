/**
 * Phase 29, chantier A : sources de départ de la veille (prompt, section 2) ; `seedSources` est idempotent (une source
 * déjà présente, même modifiée ou désactivée par l'équipe, n'est jamais retouchée).
 *
 * Choix (voir `docs/DECISIONS-TECH.md`, phase 29) :
 * - Forums dont la lecture directe exige un compte (STM Forum) ou dont les adresses de section changent souvent
 *   (BlackHatWorld, AffLift, GPWA) : lus par la recherche web restreinte au domaine (`mode: "search"`), jamais par
 *   connexion. L'admin peut passer une source en lecture directe (`mode: "page"` + sélecteurs) depuis le site.
 * - Reddit : JSON public `new.json` (25 posts par passage).
 * - Actualités : recherche web restreinte au site + lecture polie de 3 articles.
 * - Telegram et X : recherche web par marché et par pays (France, Allemagne, Espagne), une fois par semaine
 *   (coût des recherches), dans la langue locale.
 */
import { EUROPE_COUNTRIES, type Market, type TrendSourceType } from "../contract";
import { nowOf, type WatchDeps } from "./ai";
import type { WatchScrapeConfig } from "./readers";
import { localQuery, languageOfCountry } from "./terms";

export type SeedSource = {
  name: string;
  url: string;
  sourceType: TrendSourceType;
  market: Market;
  countries: string[];
  languages: string[];
  scrapeConfig: WatchScrapeConfig;
};

const ALL_EUROPE = Object.keys(EUROPE_COUNTRIES);
const EN = ["en"];

const forumSearch = (query: string, domain: string): WatchScrapeConfig => ({ mode: "search", query, allowedDomains: [domain], rateLimitMs: 15_000, intervalHours: 48 });
const newsSearch = (domain: string, query?: string): WatchScrapeConfig => ({ mode: "search", allowedDomains: [domain], fetchArticles: 3, intervalHours: 48, ...(query ? { query } : {}) });
const reddit = (): WatchScrapeConfig => ({ limit: 25, rateLimitMs: 10_000, intervalHours: 24 });

const MARKET_SLUG: Record<Market, string> = { CASINO: "casino", SPORTS: "paris-sportifs", DATING: "rencontres" };
const SEARCH_COUNTRIES = ["FR", "DE", "ES"] as const;

function bySearch(kind: "TELEGRAM" | "TWITTER"): SeedSource[] {
  const out: SeedSource[] = [];
  for (const market of ["CASINO", "SPORTS", "DATING"] as const)
    for (const country of SEARCH_COUNTRIES) {
      const lang = languageOfCountry(country);
      const query = localQuery(market, lang, kind === "TELEGRAM" ? "news" : "ads");
      out.push({
        name: `${kind === "TELEGRAM" ? "Telegram public" : "X"} — ${MARKET_SLUG[market]} ${country} (recherche)`,
        url:
          kind === "TELEGRAM"
            ? `https://t.me/s/?q=${encodeURIComponent(`${MARKET_SLUG[market]}-${country.toLowerCase()}`)}`
            : `https://x.com/search?q=${encodeURIComponent(query)}&veille=${country.toLowerCase()}`,
        sourceType: kind,
        market,
        countries: [country],
        languages: [lang],
        scrapeConfig: { mode: "search", query, intervalHours: 168 },
      });
    }
  return out;
}

export const SEED_SOURCES: readonly SeedSource[] = [
  // Forums
  { name: "BlackHatWorld — gambling", url: "https://www.blackhatworld.com/search/?q=gambling", sourceType: "FORUM", market: "CASINO", countries: ALL_EUROPE, languages: EN, scrapeConfig: forumSearch("gambling casino ads affiliate", "blackhatworld.com") },
  { name: "BlackHatWorld — dating", url: "https://www.blackhatworld.com/search/?q=dating", sourceType: "FORUM", market: "DATING", countries: ALL_EUROPE, languages: EN, scrapeConfig: forumSearch("dating offers ads traffic", "blackhatworld.com") },
  { name: "BlackHatWorld — affiliation paris sportifs", url: "https://www.blackhatworld.com/search/?q=betting", sourceType: "FORUM", market: "SPORTS", countries: ALL_EUROPE, languages: EN, scrapeConfig: forumSearch("sports betting affiliate ads", "blackhatworld.com") },
  { name: "AffLift", url: "https://afflift.com/f/", sourceType: "FORUM", market: "DATING", countries: ALL_EUROPE, languages: EN, scrapeConfig: forumSearch("dating gambling campaign facebook tiktok", "afflift.com") },
  { name: "STM Forum", url: "https://www.stmforum.com/", sourceType: "FORUM", market: "CASINO", countries: ALL_EUROPE, languages: EN, scrapeConfig: forumSearch("igaming gambling facebook ads", "stmforum.com") },
  { name: "GPWA — forums iGaming", url: "https://forums.gpwa.org/", sourceType: "FORUM", market: "CASINO", countries: ALL_EUROPE, languages: EN, scrapeConfig: forumSearch("casino affiliate advertising", "gpwa.org") },
  // Reddit
  { name: "Reddit r/gambling", url: "https://www.reddit.com/r/gambling/", sourceType: "REDDIT", market: "CASINO", countries: ALL_EUROPE, languages: EN, scrapeConfig: reddit() },
  { name: "Reddit r/onlinegambling", url: "https://www.reddit.com/r/onlinegambling/", sourceType: "REDDIT", market: "CASINO", countries: ALL_EUROPE, languages: EN, scrapeConfig: reddit() },
  { name: "Reddit r/casinoonline", url: "https://www.reddit.com/r/casinoonline/", sourceType: "REDDIT", market: "CASINO", countries: ALL_EUROPE, languages: EN, scrapeConfig: reddit() },
  { name: "Reddit r/sportsbetting", url: "https://www.reddit.com/r/sportsbetting/", sourceType: "REDDIT", market: "SPORTS", countries: ALL_EUROPE, languages: EN, scrapeConfig: reddit() },
  { name: "Reddit r/paris_sportifs", url: "https://www.reddit.com/r/paris_sportifs/", sourceType: "REDDIT", market: "SPORTS", countries: ["FR", "BE", "CH", "LU"], languages: ["fr"], scrapeConfig: reddit() },
  { name: "Reddit r/affiliatemarketing", url: "https://www.reddit.com/r/affiliatemarketing/", sourceType: "REDDIT", market: "CASINO", countries: ALL_EUROPE, languages: EN, scrapeConfig: reddit() },
  { name: "Reddit r/datingapps", url: "https://www.reddit.com/r/datingapps/", sourceType: "REDDIT", market: "DATING", countries: ALL_EUROPE, languages: EN, scrapeConfig: reddit() },
  { name: "Reddit r/Tinder", url: "https://www.reddit.com/r/Tinder/", sourceType: "REDDIT", market: "DATING", countries: ALL_EUROPE, languages: EN, scrapeConfig: reddit() },
  // Actualités
  { name: "iGaming Business", url: "https://igamingbusiness.com/", sourceType: "NEWS", market: "CASINO", countries: ALL_EUROPE, languages: EN, scrapeConfig: newsSearch("igamingbusiness.com", "Europe casino advertising marketing") },
  { name: "Casino.org — actualités", url: "https://www.casino.org/news/", sourceType: "NEWS", market: "CASINO", countries: ALL_EUROPE, languages: EN, scrapeConfig: newsSearch("casino.org", "Europe online casino advertising") },
  { name: "EGR Global", url: "https://egr.global/", sourceType: "NEWS", market: "CASINO", countries: ALL_EUROPE, languages: EN, scrapeConfig: newsSearch("egr.global", "Europe marketing affiliates") },
  { name: "SBC News", url: "https://sbcnews.co.uk/", sourceType: "NEWS", market: "SPORTS", countries: ALL_EUROPE, languages: EN, scrapeConfig: newsSearch("sbcnews.co.uk", "sports betting advertising Europe") },
  { name: "GamblingCompliance", url: "https://gamblingcompliance.com/", sourceType: "NEWS", market: "CASINO", countries: ALL_EUROPE, languages: EN, scrapeConfig: newsSearch("gamblingcompliance.com", "gambling advertising rules Europe") },
  { name: "Social Media Today — publicité sociale", url: "https://www.socialmediatoday.com/", sourceType: "NEWS", market: "DATING", countries: ALL_EUROPE, languages: EN, scrapeConfig: newsSearch("socialmediatoday.com", "Meta TikTok ads policy update") },
  { name: "Search Engine Journal — paid social", url: "https://www.searchenginejournal.com/category/paid-media/", sourceType: "NEWS", market: "SPORTS", countries: ALL_EUROPE, languages: EN, scrapeConfig: newsSearch("searchenginejournal.com", "paid social ads policy gambling") },
  // Telegram public et X : par recherche
  ...bySearch("TELEGRAM"),
  ...bySearch("TWITTER"),
];

/** Crée les sources de départ qui manquent (clé : adresse) ; ne modifie jamais une source existante. */
export async function seedSources(deps: WatchDeps): Promise<{ created: number; existing: number }> {
  let created = 0;
  let existing = 0;
  for (const s of SEED_SOURCES) {
    const found = await deps.prisma.trendSource.findUnique({ where: { url: s.url } });
    if (found) {
      existing++;
      continue;
    }
    try {
      await deps.prisma.trendSource.create({
        data: {
          name: s.name,
          url: s.url,
          sourceType: s.sourceType,
          market: s.market,
          countries: s.countries,
          languages: s.languages,
          scrapeConfig: s.scrapeConfig,
          isActive: true,
          origin: "seed",
          errorCount: 0,
          // Due tout de suite : le premier passage de `analysts.schedule` la lit.
          nextScrapeAt: nowOf(deps),
        },
      });
      created++;
    } catch (err) {
      if (/unique|P2002/i.test(String((err as Error)?.message ?? ""))) existing++;
      else throw err;
    }
  }
  return { created, existing };
}

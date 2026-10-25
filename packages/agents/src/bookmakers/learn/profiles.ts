/**
 * Phase 35 (suite) — FICHES FOURNISSEUR : recettes prêtes pour les moteurs de paris reconnus, construites à partir de
 * l'enregistrement du site (origine réelle après redirection, chemin de la page des sports, langue) et essayées AVANT
 * l'IA, comme une recette d'un site du même moteur. Elles sont VALIDÉES comme toute recette : rejouées sur
 * l'enregistrement (≥ 95 % des matchs, 100 % des cotes), puis contrôlées en vrai sur le site ; refusées, l'IA prend le
 * relais. Observé sur les vrais sites le 25 octobre 2026 :
 * - Altenar (Sportaza) : widget en shadow DOM, routeur « mémoire » recopié dans l'adresse (`?page=coupon&sportId=66
 *   &couponType=1` = programme du jour, 2 = demain ; `?page=event&eventId=N` = fiche), onglet « Par Heure », classes
 *   générées à préfixe stable (`EventBoxRoot-sc-…`, `CompetitorName-sc-…`, `OddBoxButton-sc-…`, `OddValue-sc-…`,
 *   `EventDetailsMarketName-sc-…`), identifiant du match dans les données React (`data-lap-event-id`) ;
 * - Betby (Bet Portal) : flux JSON public par manifeste (`/api/v4/prematch/brand/<marque>/<langue>/0` → versions →
 *   `events{}` avec `desc.competitors[]`, `desc.scheduled`, marchés principaux), widget en shadow DOM avec repères
 *   `data-editor-id` (`eventCardContent`, `eventCardStatusLabel`, `marketCard`, `marketCardHeader`, `outcomePlate`,
 *   `marketCardOutcomeName`, `eventMarketTab`), fiches `/…/<equipes>-<id>` ;
 * - site de paris « matches-api » (Celsius, front BetConstruct) : API `GET /api/v2/matches?…sport_key=soccer…` (`data[]`
 *   : `id`, `start_time`, `competitors.home.name`, `competitors.away.name`, `tournament.name`) et
 *   `GET /api/v2/matches/{eventId}/markets?limit=500` (`data[].name`, `data[].outcomes[].name`, `odds` en millièmes),
 *   pages avec `data-test-id` (`game-link`, `team-column-name`, `market-table-name`, `odd`, `odd-label`,
 *   `animated-odd`), fiches `/<langue>/soccer/<equipes>-m-<id>`.
 * Aucune adresse n'est inventée : chaque origine vient de l'enregistrement ; la garde contrôle chaque adresse comme
 * pour une recette de l'IA. Noms de marchés : seulement ceux vus dans l'enregistrement (règle 4). Règles pures.
 */
import { resolveTheme } from "../../sports/themes";
import type { DomStep, RecipeData, SiteRecording } from "../contract";
import { forbiddenApiCallReason, forbiddenReadUrlReason } from "../guard";
import { FOOTBALL_SPORT_ID } from "./widget-nav";

export type ProfileCandidate = { name: string; recipe: RecipeData };

const step = (...candidates: DomStep["candidates"]): DomStep => ({ candidates });

/** Noms de marchés connus par moteur → clé interne (gardés seulement s'ils figurent dans l'enregistrement). */
const KNOWN_MARKETS: Record<string, Record<string, string>> = {
  altenar: {
    "1x2": "resultat",
    "Résultat du match": "resultat",
    Total: "buts",
    "Total de buts": "buts",
    "Double chance": "double-chance",
    Handicap: "handicap",
    "Score correct": "score-exact",
    "Score exact": "score-exact",
    "Les deux équipes qui marquent": "les-deux-equipes-marquent",
    "Mi-temps/Fin de match": "mi-temps",
    "Total corners": "corners",
    "Total de corners": "corners",
    Corners: "corners",
    "Total cartons": "cartons",
    "Total de cartons": "cartons",
    Cartons: "cartons",
    "Tirs cadrés": "tirs-cadres",
    "Total tirs cadrés": "tirs-cadres",
    Buteur: "buteurs",
  },
  betby: {
    "1x2": "resultat",
    Total: "buts",
    "Double chance": "double-chance",
    Handicap: "handicap",
    "Score correct": "score-exact",
    "Score exact": "score-exact",
    "Les deux équipes marquent": "les-deux-equipes-marquent",
    "Total de corners": "corners",
    Corners: "corners",
    "Total de cartons": "cartons",
    Cartons: "cartons",
    "Tirs cadrés": "tirs-cadres",
    "Total de tirs cadrés": "tirs-cadres",
    Buteur: "buteurs",
    "Buteur à tout moment": "buteurs",
  },
  "matches-api": {
    "Résultat du match": "resultat",
    "Total de buts": "buts",
    "Double Chance": "double-chance",
    "Double chance": "double-chance",
    "Handicap de buts": "handicap",
    "Score exact": "score-exact",
    "Les deux équipes marquent": "les-deux-equipes-marquent",
    "Total de corners": "corners",
    Corners: "corners",
    "Total de cartons": "cartons",
    "Cartons jaunes": "cartons-jaunes",
    "Tirs cadrés": "tirs-cadres",
    "Total de tirs cadrés": "tirs-cadres",
    Buteur: "buteurs",
  },
};

/** Texte de l'enregistrement où un nom de marché doit figurer pour être gardé. */
function haystackOf(rec: SiteRecording): string {
  return [...rec.pages.map((p) => `${p.text}\n${p.html}`), ...rec.responses.map((r) => r.body), ...rec.pageOdds.map((o) => o.market)].join("\n").toLowerCase();
}

/** Correspondance des marchés : table du moteur puis synonymes du code, pour les noms vus dans l'enregistrement. Pur. */
export function marketMapFor(provider: string, rec: SiteRecording): Record<string, string | null> {
  const hay = haystackOf(rec);
  const out: Record<string, string | null> = {};
  for (const [name, key] of Object.entries(KNOWN_MARKETS[provider] ?? {})) if (hay.includes(name.toLowerCase())) out[name] = key;
  for (const o of rec.pageOdds) if (!(o.market in out)) out[o.market] = resolveTheme(o.market)?.key ?? null;
  return out;
}

function originOf(url: string | null | undefined): string | null {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

/** Page des sports du site (adresse RÉELLE après redirection : première page enregistrée, sinon adresse de départ). */
function sportsPage(rec: SiteRecording): URL | null {
  const home = rec.pages.find((p) => p.step === "home") ?? rec.pages[0];
  try {
    return new URL(home?.url ?? rec.baseUrl);
  } catch {
    return null;
  }
}

/** Langue dans un chemin (`/fr/sports` → `fr`), ou null. */
function langOf(path: string): string | null {
  const m = /^\/([a-z]{2})(?:-[a-z]{2})?(?:\/|$)/i.exec(path);
  return m ? m[1]!.toLowerCase() : null;
}

// --- Altenar --------------------------------------------------------------------------------------------------------

export function altenarRecipe(rec: SiteRecording): RecipeData | null {
  const page = sportsPage(rec);
  if (!page) return null;
  const base = `${page.origin}${page.pathname.replace(/\/$/, "") || "/"}`;
  const sport = FOOTBALL_SPORT_ID.altenar!;
  return {
    level: "dom",
    api: null,
    dom: {
      dayToday: step({ text: "Par Heure" }, { text: "Par heure" }, { text: "By time" }, { css: '[class*="MatchOddsTab"]:nth-child(2)' }),
      eventList: step({ css: '[class*="EventBoxRoot"]' }, { css: '[class*="EventBox"][data-lap-event-id]' }, { css: "[data-lap-event-id]" }),
      eventRow: {
        home: step({ css: '[class*="CompetitorContainer"]:first-child [class*="CompetitorName"]' }, { css: '[class*="CompetitorName"]' }),
        away: step({ css: '[class*="CompetitorContainer"]:last-child [class*="CompetitorName"]' }, { css: '[class*="CompetitorName"]:last-child' }),
        startsAt: step({ css: '[class*="StartTime"]' }, { css: '[class*="EventTime"]' }, { css: '[class*="TimeWrapper"]' }, { css: '[class*="EventBoxInfo"]' }),
        league: step({ css: '[class*="CategoryChampionship-"]' }, { css: '[class*="CategoryChampionship"]' }, { css: '[class*="Championship"]' }),
      },
      market: {
        name: step({ css: '[class*="EventDetailsMarketName-"]' }, { css: '[class*="MarketName-"]' }, { css: '[class*="MarketName"]' }),
        selection: step({ css: 'button[class*="OddBoxButton"]' }, { css: '[class*="OddBoxButton"]' }, { css: '[class*="OddBox-"]' }),
        odds: step({ css: '[class*="OddValue"]' }, { css: '[class*="OddPrice"]' }),
      },
      listUrls: [`${base}?page=coupon&sportId=${sport}&couponType=1`, `${base}?page=coupon&sportId=${sport}&couponType=2`],
      eventUrlTemplate: `${base}?page=event&eventId={eventId}&sportId=${sport}`,
    },
    mapping: { marketMap: marketMapFor("altenar", rec), oddsFormat: "decimal", timezone: "Europe/Paris" },
  };
}

// --- Betby ----------------------------------------------------------------------------------------------------------

/**
 * Marque et origine du flux Betby vus dans l'enregistrement : la réponse JSON du MANIFESTE
 * (`<origine>/api/v4/prematch/brand/<marque>/<langue>/0`, corps avec `top_events_versions`). L'origine n'est jamais
 * devinée : c'est celle de la réponse enregistrée (en vrai `https://api-h-….sptpub.com`, en test un site local).
 */
export function betbyFeedOf(rec: SiteRecording): { apiOrigin: string; brand: string; lang: string } | null {
  for (const r of rec.responses) {
    if (r.kind !== "json" || r.status >= 400) continue;
    const m = /^(https?:\/\/[^/?#]+)\/api\/v4\/prematch\/brand\/(\d{6,})\/([a-z]{2})\/0\/?(?:[?#]|$)/i.exec(r.url);
    if (!m || !/"top_events_versions"|"rest_events_versions"/.test(r.body)) continue;
    return { apiOrigin: m[1]!, brand: m[2]!, lang: m[3]!.toLowerCase() };
  }
  return null;
}

export function betbyRecipe(rec: SiteRecording): RecipeData | null {
  const page = sportsPage(rec);
  if (!page) return null;
  const feed = betbyFeedOf(rec);
  const lang = langOf(page.pathname) ?? feed?.lang ?? "fr";
  const m = /^((?:\/[a-z]{2}(?:-[a-z]{2})?)?\/(?:sports?|sportsbook|betting))(?:\/|$)/i.exec(page.pathname);
  const sportsPath = m ? m[1]! : `/${lang}/sports`;
  const origin = page.origin;
  const api: RecipeData["api"] = feed
    ? {
        endpoints: [
          {
            purpose: "events",
            method: "GET",
            urlTemplate: `${feed.apiOrigin}/api/v4/prematch/brand/${feed.brand}/${lang}/{version}`,
            headers: [],
            auth: "none",
            pagination: { param: "version", start: 0, step: 1, max: 12, manifest: { urlTemplate: `${feed.apiOrigin}/api/v4/prematch/brand/${feed.brand}/${lang}/0`, versionsPaths: ["top_events_versions[]", "rest_events_versions[]"] } },
            responseShape: {
              id: "events{}.$key",
              home: "events{}.desc.competitors[0].name",
              away: "events{}.desc.competitors[1].name",
              startsAt: "events{}.desc.scheduled",
              league: "tournaments[@events{}.desc.tournament].name",
              sport: "events{}.desc.sport",
              type: "events{}.desc.type",
              slug: "events{}.desc.slug",
              categorySlug: "categories[@events{}.desc.category].slug",
              tournamentSlug: "tournaments[@events{}.desc.tournament].slug",
            },
            filter: { sport: FOOTBALL_SPORT_ID.betby!, type: "match" },
          },
        ],
        tokenSource: null,
        // Fiche vue en vrai : /fr/sports/football/spain/laliga/fc-barcelona-real-madrid-2721054223063191561
        eventUrlTemplate: `${origin}${sportsPath}/football/{categorySlug}/{tournamentSlug}/{slug}-{eventId}`,
      }
    : null;
  // Carte d'un match vue en vrai (aucun repère sur les noms) : <a eventCardContent> > [en-tête avec eventCardStatusLabel]
  // + [bloc des équipes > ligne > (équipe > (logo, NOM)) ×2 + score] ; les noms sont donc le dernier enfant du premier
  // enfant de chaque équipe.
  const team = (n: 1 | 2) => `a[data-editor-id=eventCardContent] > div:nth-child(2) > div:first-child > div:nth-child(${n}) > div:first-child > div:last-child`;
  return {
    level: "dom",
    api,
    dom: {
      dayToday: step({ text: "À venir" }, { text: "A venir" }, { text: "Upcoming" }),
      eventList: step({ css: "a[data-editor-id=eventCardContent]" }, { css: '[data-editor-id="eventCardContent"]' }),
      eventRow: {
        home: step({ css: team(1) }, { css: "[data-editor-id=eventCardCompetitorName]:first-child" }, { css: '[class*="Competitor"]:first-child' }),
        away: step({ css: team(2) }, { css: "[data-editor-id=eventCardCompetitorName]:last-child" }, { css: '[class*="Competitor"]:last-child' }),
        startsAt: step({ css: "[data-editor-id=eventCardStatusLabel]" }),
        league: step({ css: "[data-editor-id=eventCardCategory]" }),
      },
      market: {
        name: step({ css: "[data-editor-id=marketCardHeader]" }),
        selection: step({ css: "[data-editor-id=outcomePlate]" }, { css: "[data-editor-id=tableOutcomePlate]" }),
        odds: step({ css: "[data-editor-id=outcomePlate] > div:last-child span" }, { css: "[data-editor-id=outcomePlate] span:last-child" }),
      },
      listUrls: [`${origin}${sportsPath}/football-${FOOTBALL_SPORT_ID.betby}`],
    },
    mapping: { marketMap: marketMapFor("betby", rec), oddsFormat: "decimal", timezone: "Europe/Paris" },
  };
}

// --- Site de paris « matches-api » (Celsius) --------------------------------------------------------------------

/** Origine de l'API `/api/v2/matches` vue dans l'enregistrement (réponse JSON avec des matchs). */
export function matchesApiOf(rec: SiteRecording): { origin: string; sportKey: string } | null {
  for (const r of rec.responses) {
    if (r.kind !== "json" || r.status >= 400) continue;
    let u: URL;
    try {
      u = new URL(r.url);
    } catch {
      continue;
    }
    if (!/\/api\/v2\/matches\/?$/.test(u.pathname)) continue;
    if (!/"start_time"/.test(r.body) || !/"competitors"/.test(r.body)) continue;
    return { origin: u.origin, sportKey: u.searchParams.get("sport_key") ?? "soccer" };
  }
  return null;
}

export function matchesApiRecipe(rec: SiteRecording): RecipeData | null {
  const api = matchesApiOf(rec);
  if (!api) return null;
  const page = sportsPage(rec);
  const listPage = rec.pages.find((p) => p.step === "list-today") ?? rec.pages.find((p) => p.step === "football");
  const lang = (listPage ? langOf(new URL(listPage.url).pathname) : null) ?? (page ? langOf(page.pathname) : null) ?? "fr";
  return {
    level: "api",
    api: {
      endpoints: [
        {
          purpose: "events",
          method: "GET",
          urlTemplate: `${api.origin}/api/v2/matches`,
          params: { bettable: "true", limit: "500", match_status: "0", type: "match", sport_key: api.sportKey, sort_by: "start_time:asc", start_from: "{date}T00:00:00Z", start_to: "{date}T23:59:59Z" },
          headers: [],
          auth: "none",
          pagination: { param: "page", start: 1, step: 1, max: 4 },
          responseShape: { id: "data[].id", home: "data[].competitors.home.name", away: "data[].competitors.away.name", startsAt: "data[].start_time", league: "data[].tournament.name", slug: "data[].slug" },
        },
        {
          purpose: "markets",
          method: "GET",
          urlTemplate: `${api.origin}/api/v2/matches/{eventId}/markets`,
          params: { limit: "500" },
          headers: [],
          auth: "none",
          pagination: { param: "page", start: 1, step: 1, max: 3 },
          responseShape: { market: "data[].name", selection: "data[].outcomes[].name", odds: "data[].outcomes[].odds", eventId: "data[].match_id" },
        },
      ],
      tokenSource: null,
      eventUrlTemplate: `${api.origin}/${lang}/${api.sportKey}/{slug}-m-{eventId}`,
    },
    dom: {
      eventList: step({ css: "a[data-test-id=game-link]" }, { css: ".sb-BettingTable-link" }),
      eventRow: {
        home: step({ css: ".sb-TeamColumn:first-child [data-test-id=team-column-name]" }, { css: "[data-test-id=team-column-name]" }),
        away: step({ css: ".sb-TeamColumn:last-child [data-test-id=team-column-name]" }),
        startsAt: step({ css: "[data-test-id=game-row-time]" }, { css: ".sb-GameRowDesktop-time" }),
      },
      market: {
        name: step({ css: "[data-test-id=market-table-name]" }, { css: ".sb-MarketTable-name" }),
        selection: step({ css: "button[data-test-id=odd]" }, { css: ".sb-MarketTable-outcome" }),
        odds: step({ css: "[data-test-id=animated-odd]" }, { css: ".sb-Odd-value" }),
      },
    },
    mapping: { marketMap: marketMapFor("matches-api", rec), oddsFormat: "milli", timezone: "Europe/Paris" },
  };
}

// --- Choix ------------------------------------------------------------------------------------------------------

/** Les adresses d'une recette passent-elles la garde et restent-elles dans les domaines de l'enregistrement ? */
export function recipeAddressesAllowed(recipe: RecipeData, rec: SiteRecording): boolean {
  const hosts = [...new Set([...rec.domains, ...(originOf(rec.baseUrl) ? [new URL(rec.baseUrl).hostname] : [])].map((h) => h.toLowerCase()))];
  const sample = (tpl: string) => tpl.replace(/\{[a-zA-Z]+\}/g, "1");
  const urls = [
    ...(recipe.dom?.listUrls ?? []),
    ...(recipe.dom?.eventUrlTemplate ? [recipe.dom.eventUrlTemplate] : []),
    ...(recipe.api?.eventUrlTemplate ? [recipe.api.eventUrlTemplate] : []),
  ];
  for (const u of urls) if (forbiddenReadUrlReason(sample(u), hosts)) return false;
  for (const e of recipe.api?.endpoints ?? []) {
    if (forbiddenApiCallReason({ method: e.method, url: sample(e.urlTemplate), body: null }, hosts)) return false;
    if (e.pagination?.manifest && forbiddenApiCallReason({ method: "GET", url: sample(e.pagination.manifest.urlTemplate), body: null }, hosts)) return false;
  }
  return true;
}

/** Recettes prêtes qui conviennent à cet enregistrement (moteur reconnu ou API connue), dans l'ordre d'essai. Pur. */
export function builtinRecipes(rec: SiteRecording): ProfileCandidate[] {
  const out: ProfileCandidate[] = [];
  const push = (name: string, recipe: RecipeData | null) => {
    if (recipe && recipeAddressesAllowed(recipe, rec)) out.push({ name, recipe });
  };
  if (rec.providerHint === "altenar") push("altenar", altenarRecipe(rec));
  if (rec.providerHint === "betby") push("betby", betbyRecipe(rec));
  push("matches-api", matchesApiRecipe(rec));
  return out;
}

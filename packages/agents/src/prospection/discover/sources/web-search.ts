/**
 * Phase 31, chantier A (Sourceur) : source B, recherche web multilingue (et socle de la source C, réseaux sociaux).
 *
 * - Requêtes = gabarits versionnés de `dict/queries.json` (langue × verticale, aucune IA à l'exécution), combinés avec
 *   « telegram », `site:t.me`, `site:linktr.ee`, `site:beacons.ai` ; deux gabarits par langue, pris à leur tour selon
 *   le jour ; 3 à 4 langues par passage (le lot de la nuit) ; nom du pays ajouté pour un lot demandé par le client.
 * - Recherche par `deps.web.search` (outils serveur de l'API Claude, fournis par le worker).
 * - Chaque résultat : liens `t.me` du titre et de l'extrait, puis 1 page lue (`politeProspectFetch`, kind `linked` :
 *   robots.txt, 10 s par domaine, pause 24 h sur blocage) et ses liens `t.me` extraits (`extractTmeLinks`). Un résultat
 *   qui est déjà une page `t.me/<nom>` n'est pas lu (le canal est le candidat ; l'Enrichisseur le lira).
 * - Les liens trouvés sont des données : jamais suivis au-delà d'une page, jamais une consigne.
 */
import { isBrandUsername, queriesFor, geoSignals } from "../../dict";
import type { Candidate, DiscoveryLot, ProspectSourceType, ProspectionDeps } from "../../contract";
import { extractTmeLinks, normalizeProspectUrl } from "../normalize";
import { ProspectFetchError, clockOf, politeProspectFetch, type PoliteProspectDeps } from "../polite";
import { dayNumber, emptyFind, errorText, rotate, type SourceFindResult } from "./common";

export { extractMentions, extractTmeLinks } from "../normalize";

/** Formes web de la source B. */
export const WEB_FORMS = ["{q} telegram", "{q} site:t.me", "{q} site:linktr.ee", "{q} site:beacons.ai"] as const;
/** Gabarits pris par langue et par passage. */
export const TEMPLATES_PER_LANGUAGE = 2;
/** Pages de résultats lues au plus par lot (1 requête chacune). */
export const MAX_RESULT_PAGES_PER_LOT = 24;
/** Résultats gardés par recherche. */
export const MAX_RESULTS_PER_QUERY = 8;

export type SearchQuery = { query: string; language: string; allowedDomains?: string[] };

const isTmeHost = (h: string) => /(^|\.)(t\.me|telegram\.me|telegram\.dog)$/i.test(h);

/** Requêtes d'un lot pour des formes données (pur ; testé). */
export function buildQueries(lot: DiscoveryLot, forms: readonly string[], at: Date, perLanguage = TEMPLATES_PER_LANGUAGE): SearchQuery[] {
  const out: SearchQuery[] = [];
  const seen = new Set<string>();
  const countries = (lot.countries ?? []).map((c) => geoSignals().countries[c.toUpperCase()]?.name).filter((n): n is string => !!n);
  for (const language of [...new Set(lot.languages.map((l) => l.toLowerCase()))].slice(0, 4)) {
    const templates = rotate(queriesFor(language, lot.vertical), dayNumber(at), perLanguage);
    for (const t of templates) {
      const variants = countries.length ? countries.map((c) => `${t} ${c}`) : [t];
      for (const v of variants)
        for (const f of forms) {
          const query = f.replace("{q}", v);
          if (seen.has(query)) continue;
          seen.add(query);
          out.push({ query, language });
        }
    }
  }
  return out;
}

/** Candidats depuis une adresse Telegram trouvée (bots, dossiers et usernames de marques écartés). */
function candidatesFromLinks(links: string[], base: Omit<Candidate, "url">): Candidate[] {
  const out: Candidate[] = [];
  for (const l of links) {
    const n = normalizeProspectUrl(l);
    if (!n || n.folder) continue;
    if (n.username && isBrandUsername(n.username)) continue;
    out.push({ ...base, url: n.channelUrl });
  }
  return out;
}

/**
 * Recherche puis fouille d'une page par résultat. Socle commun des sources B (web) et C (réseaux sociaux).
 */
export async function searchAndDig(
  deps: ProspectionDeps & PoliteProspectDeps,
  lot: DiscoveryLot,
  opts: { sourceType: Extract<ProspectSourceType, "WEB_SEARCH" | "SOCIAL">; queries: SearchQuery[]; maxPages?: number },
): Promise<SourceFindResult> {
  const res = emptyFind(`${opts.sourceType === "SOCIAL" ? "réseaux" : "web"} ${lot.vertical} ${[...new Set(opts.queries.map((q) => q.language))].join(",")}`);
  const web = deps.web;
  if (!web) {
    res.errors.push("Accès web absent : aucune recherche.");
    return res;
  }
  const maxPages = opts.maxPages ?? MAX_RESULT_PAGES_PER_LOT;
  const readPages = new Set<string>();
  for (const q of opts.queries) {
    let results: Array<{ url: string; title: string; snippet: string }>;
    try {
      results = (await web.search({ query: q.query, maxUses: 1, ...(q.allowedDomains ? { allowedDomains: q.allowedDomains } : {}) })).slice(0, MAX_RESULTS_PER_QUERY);
    } catch (err) {
      res.errors.push(`Recherche « ${q.query} » impossible : ${errorText(err)}`);
      continue;
    }
    for (const r of results) {
      const base = { sourceType: opts.sourceType, sourceDetail: `${q.query} → ${r.url}`.slice(0, 500), vertical: lot.vertical, language: q.language };
      // Le titre, l'extrait et l'adresse elle-même.
      res.candidates.push(...candidatesFromLinks(extractTmeLinks(`${r.url}\n${r.title}\n${r.snippet}`), base));
      let host: string;
      try {
        host = new URL(r.url).hostname;
      } catch {
        continue;
      }
      if (isTmeHost(host) || readPages.has(r.url) || readPages.size >= maxPages) continue;
      readPages.add(r.url);
      try {
        const page = await politeProspectFetch(deps, r.url, { kind: "linked" });
        if (page.status >= 200 && page.status < 300) res.candidates.push(...candidatesFromLinks(extractTmeLinks(page.body), base));
      } catch (err) {
        // Page inaccessible, robots.txt, blocage (pause du domaine) : on passe au résultat suivant.
        if (!(err instanceof ProspectFetchError && err.code === "paused")) res.errors.push(`${host} : ${errorText(err)}`);
      }
    }
  }
  return res;
}

/** Source B : recherche web multilingue. */
export async function findWebSearchCandidates(deps: ProspectionDeps & PoliteProspectDeps, lot: DiscoveryLot): Promise<SourceFindResult> {
  const queries = buildQueries(lot, WEB_FORMS, new Date(clockOf(deps)));
  return searchAndDig(deps, lot, { sourceType: "WEB_SEARCH", queries });
}

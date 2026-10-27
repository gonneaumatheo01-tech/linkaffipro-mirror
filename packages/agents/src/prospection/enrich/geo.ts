/**
 * Phase 31, chantier B — pays et région d'un canal (section 3.7, règle 5), par le code, sur `dict/geo-signals.json`
 * et `dict/brands.json`. Le PAYS vient des SIGNAUX, pas de la langue : portugais ≠ Portugal, espagnol ≠ Espagne,
 * anglais ≠ Royaume-Uni.
 *
 * Points par signal (par pays) :
 * - marque licenciée locale : +3 pour son pays principal, +1 pour ses autres pays ; marque locale « GLOBAL » : +1 par
 *   pays ; marque offshore qui signale une audience hors Europe (1win, Caliente, Betano.bet.br…) : +3 pour son pays
 *   s'il est connu, et −2 pour chaque pays européen (« offshore CIS / LatAm ») ;
 * - compétition ou club national : +2 par nom trouvé (3 au plus) ;
 * - monnaie : +2 ;
 * - orthographe régionale (`locales`, repères comptés seulement si la langue du canal est celle de la locale) : +2,
 *   +2 de plus à partir de 3 repères distincts ;
 * - domaine national (liens, textes) : +1 ; ville : +1 par ville (2 au plus) ; préfixe téléphonique : +1.
 * - langue russe : +4 pour la Russie (russe → hors Europe par défaut, sauf signaux européens plus forts) ; turc : +4
 *   pour la Turquie.
 * Un pays dont aucune langue n'est celle du canal voit ses points divisés par deux (« LaLiga » cité dans un canal
 * français ne fait pas un canal espagnol).
 *
 * Confiance = force × séparation : force = min(1, points du 1er ÷ 7) ; séparation = (1er − 2e) ÷ 1er.
 * Région : EU si le 1er pays est dans le périmètre et confiance ≥ 0,6 ; NON_EU si le 1er pays est hors périmètre avec au
 * moins 3 points et une séparation ≥ 0,3 ; sinon UNKNOWN (score plafonné, Kevin peut demander au client).
 */
import { findBrand, geoSignals, type Brand } from "../dict";
import { PROSPECTION_LIMITS, type ProspectRegion } from "../contract";
import { foundTerms } from "./terms";

export type GeoInput = {
  /** Textes des posts (en mémoire seulement). */
  texts: string[];
  description: string | null;
  /** Marques détectées (noms ou clés du dictionnaire). */
  brands: string[];
  /** Liens des posts, boutons et description. */
  links: string[];
  /** Langue du canal (ISO 639-1) ou null. */
  language: string | null;
};

export type GeoEvidence = {
  brands: string[];
  offshoreBrands: string[];
  competitions: string[];
  clubs: string[];
  currency: string[];
  spelling: string | null;
  spellingMarkers: string[];
  tlds: string[];
  cities: string[];
  phone: string[];
  languageDefault: string | null;
  /** Points des 5 premiers pays (explication). */
  scores: Record<string, number>;
};

export type GeoResult = {
  countries: string[];
  geoSignals: GeoEvidence;
  geoConfidence: number;
  region: ProspectRegion;
};

type CountryHits = { score: number; ev: Omit<GeoEvidence, "scores" | "offshoreBrands"> };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function hostOf(url: string): string | null {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function detectGeo(input: GeoInput, scope: readonly string[]): GeoResult {
  const dict = geoSignals();
  const corpus = [input.description ?? "", ...input.texts].join("\n");
  const lower = corpus.toLowerCase();
  const found = (_c: string, terms: string[]) => foundTerms(corpus, terms, lower);
  const hosts = input.links.map(hostOf).filter((h): h is string => !!h);
  const textDomains = corpus.match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi)?.map((d) => d.toLowerCase()) ?? [];
  const allHosts = [...new Set([...hosts, ...textDomains])];
  const lang = input.language?.toLowerCase() ?? null;
  const inScope = new Set(scope.map((c) => c.toUpperCase()));

  const hits = new Map<string, CountryHits>();
  const get = (cc: string): CountryHits => {
    let h = hits.get(cc);
    if (!h) {
      h = { score: 0, ev: { brands: [], competitions: [], clubs: [], currency: [], spelling: null, spellingMarkers: [], tlds: [], cities: [], phone: [], languageDefault: null } };
      hits.set(cc, h);
    }
    return h;
  };

  // Marques.
  const brands = new Map<string, Brand>();
  for (const name of input.brands) {
    const b = findBrand(name);
    if (b) brands.set(b.key, b);
  }
  const offshoreBrands: string[] = [];
  for (const b of brands.values()) {
    if (b.offshoreNonEu) {
      offshoreBrands.push(b.name);
      if (b.country !== "GLOBAL") {
        const h = get(b.country);
        h.score += 3;
        h.ev.brands.push(b.name);
      }
      continue;
    }
    if (b.status !== "local") continue;
    for (const cc of b.countries) {
      if (cc === "GLOBAL") continue;
      const h = get(cc);
      h.score += cc === b.country ? 3 : 1;
      h.ev.brands.push(b.name);
    }
  }

  for (const [cc, g] of Object.entries(dict.countries)) {
    const comps = found(corpus, g.competitions);
    const clubs = found(corpus, g.clubs).filter((c) => !comps.some((x) => x.toLowerCase().includes(c.toLowerCase())));
    const named = Math.min(3, comps.length + clubs.length);
    const cur = found(corpus, g.currencies);
    const cities = found(corpus, g.cities).filter((c) => !clubs.some((x) => x.toLowerCase() === c.toLowerCase()));
    const tlds = g.tlds.filter((t) => allHosts.some((h) => h.endsWith(t.toLowerCase())));
    // « .uk » et « .co.uk », « .br » et « .com.br » : un seul point de domaine.
    const phone = g.phonePrefixes.filter((p) => new RegExp(`${escapeRe(p)}[\\s\\d]`).test(corpus));
    let score = named * 2 + (cur.length ? 2 : 0) + (tlds.length ? 1 : 0) + Math.min(2, cities.length) + (phone.length ? 1 : 0);
    let spelling: string | null = null;
    let markers: string[] = [];
    if (g.locale && dict.locales[g.locale]) {
      const loc = dict.locales[g.locale]!;
      if (!lang || loc.language === lang) {
        markers = found(corpus, loc.markers);
        if (markers.length) {
          spelling = g.locale;
          score += 2 + (markers.length >= 3 ? 2 : 0);
        }
      }
    }
    // Locales sans pays « principal » (fr-CH pour la Suisse romande) : repères comptés pour le pays de la locale.
    for (const [locKey, loc] of Object.entries(dict.locales)) {
      if (loc.country !== cc || locKey === g.locale) continue;
      if (lang && loc.language !== lang) continue;
      const extra = found(corpus, loc.markers).filter((m) => !markers.includes(m));
      if (extra.length) {
        spelling ??= locKey;
        markers = [...markers, ...extra];
        score += 2 + (extra.length >= 3 ? 2 : 0);
      }
    }
    if (score <= 0) continue;
    const h = get(cc);
    h.score += score;
    h.ev.competitions.push(...comps);
    h.ev.clubs.push(...clubs);
    h.ev.currency.push(...cur);
    h.ev.cities.push(...cities.slice(0, 2));
    h.ev.tlds.push(...tlds.slice(0, 1));
    h.ev.phone.push(...phone);
    if (spelling) {
      h.ev.spelling = spelling;
      h.ev.spellingMarkers = markers.slice(0, 6);
    }
  }

  // Langues hors Europe par défaut.
  if (lang === "ru") {
    const h = get("RU");
    h.score += 4;
    h.ev.languageDefault = "ru";
  } else if (lang === "tr") {
    const h = get("TR");
    h.score += 4;
    h.ev.languageDefault = "tr";
  }

  // Marques offshore « hors Europe » : −2 pour chaque pays européen ; pays sans la langue du canal : moitié des points.
  for (const [cc, h] of hits) {
    if (offshoreBrands.length && inScope.has(cc)) h.score -= 2 * offshoreBrands.length;
    const langs = dict.countries[cc]?.languages ?? [];
    if (lang && langs.length && !langs.includes(lang)) h.score /= 2;
  }

  const ranked = [...hits.entries()].filter(([, h]) => h.score > 0).sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]));
  const scores = Object.fromEntries(ranked.slice(0, 5).map(([cc, h]) => [cc, Number(h.score.toFixed(1))]));
  const empty: GeoEvidence = { brands: [], offshoreBrands, competitions: [], clubs: [], currency: [], spelling: null, spellingMarkers: [], tlds: [], cities: [], phone: [], languageDefault: null, scores };
  if (!ranked.length) return { countries: [], geoSignals: empty, geoConfidence: 0, region: "UNKNOWN" };

  const [first, second] = ranked;
  const top = first![1].score;
  const strength = Math.min(1, top / 7);
  const separation = (top - (second?.[1].score ?? 0)) / top;
  const confidence = Number((strength * separation).toFixed(3));
  const firstCc = first![0];
  let region: ProspectRegion = "UNKNOWN";
  if (inScope.has(firstCc)) region = confidence >= PROSPECTION_LIMITS.geoMinConfidence ? "EU" : "UNKNOWN";
  else if (top >= 3 && separation >= 0.3) region = "NON_EU";
  const countries = ranked.filter(([, h]) => h.score >= Math.max(1, top * 0.3)).slice(0, 4).map(([cc]) => cc);
  const ev = first![1].ev;
  return {
    countries,
    geoSignals: { ...ev, brands: [...new Set(ev.brands)], offshoreBrands, scores },
    geoConfidence: confidence,
    region,
  };
}

/** Pays d'une marque du dictionnaire (« FR », « GLOBAL ») ; utile aux marques détectées. */
export function brandCountry(name: string): string | null {
  return findBrand(name)?.country ?? null;
}

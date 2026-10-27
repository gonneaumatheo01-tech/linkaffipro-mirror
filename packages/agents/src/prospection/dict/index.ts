/**
 * Phase 31, chantier A (Sourceur) : dictionnaires versionnés de l'équipe Prospection. Fichiers JSON du dépôt, écrits à
 * la main, testés (`dict.test.ts`) ; aucune IA à l'exécution, aucun ajout silencieux (une proposition des Analystes passe
 * par le client).
 *
 * API (utilisée par le Sourceur, l'Enrichisseur et l'Évaluateur) :
 * - `brandsDict()` : toutes les marques (`Brand` : clé, nom, alias, type bookmaker / casino / both, statut local /
 *   offshore, pays principal `country`, pays `countries` (ISO 3166-1 alpha-2 ou « GLOBAL »), domaines, usernames
 *   Telegram officiels connus, `offshoreNonEu` (audience souvent hors Europe), `ambiguous` (nom = mot courant : ne
 *   compte que sur un lien, un domaine ou un code promo)).
 * - `findBrand(nom)` : marque par nom, alias, domaine ou username (minuscules, espaces et ponctuation ignorés, accents
 *   gardés : « Niké » n'est pas « Nike ») ; `null` sinon. `findBrandByDomain(hôte)` : par domaine d'un lien.
 * - `brandsForCountry(cc)` : marques présentes dans un pays (les « GLOBAL » à part : `brand.countries.includes("GLOBAL")`).
 * - `isBrandUsername(username)` : username officiel d'une marque (exclu du graphe et des contacts).
 * - `geoSignals()` : signaux par pays (`GeoCountry` : langues, monnaies, compétitions, clubs, villes, domaines,
 *   préfixes téléphoniques, locale) et repères d'orthographe régionale (`locales` : pt-PT / pt-BR, es-ES / es-MX /
 *   es-AR / es-CO, en-GB / en-US / en-IN / en-NG / en-IE, de-DE / AT / CH, fr-FR / BE / CH / CA).
 * - `countryLanguages(cc)` : langues parlées dans un pays (lot de découverte « cherche en Pologne »).
 * - `QUERY_LANGUAGES` : les 26 langues couvertes (24 de l'UE + norvégien + islandais) ; `queriesFor(langue, verticale)` :
 *   gabarits de recherche (sans « telegram » ni `site:` : le Sourceur les ajoute).
 * - `contactLabels()` : étiquettes de contact par langue ; `allContactLabels()` : toutes, sans doublon.
 * - `affiliatePatterns()` : paramètres et chemins d'affiliation, raccourcisseurs, agrégateurs de liens, étiquettes
 *   « code promo » par langue.
 * - `validateDicts()` : liste des problèmes de structure (vide = bon) ; utilisé par le test.
 * - `loadDictAdditions(deps)` : applique les ajouts validés par le client (`Setting prospection.dict_additions`) ;
 *   `applyDictAdditions(ajouts)` en pur. Les fonctions ci-dessus rendent ensuite fichiers + ajouts.
 */
import { readSetting } from "../../admin/journal";
import type { AgentsDeps } from "../../types";
import affiliateData from "./affiliate-patterns.json";
import brandsData from "./brands.json";
import contactData from "./contact-labels.json";
import geoData from "./geo-signals.json";
import queriesData from "./queries.json";

export type BrandType = "bookmaker" | "casino" | "both";
export type BrandStatus = "local" | "offshore";

export type Brand = {
  key: string;
  name: string;
  aliases: string[];
  type: BrandType;
  status: BrandStatus;
  /** Pays principal (ISO alpha-2) ou « GLOBAL ». */
  country: string;
  countries: string[];
  domains: string[];
  /** Usernames Telegram officiels connus (sans @, minuscules). */
  telegram: string[];
  /** Marque qui signale souvent une audience hors Europe (1win, Mostbet, Pin-Up…). */
  offshoreNonEu: boolean;
  /** Nom qui est aussi un mot courant (« Stake », « Toto », « Placard ») : ne compte que sur un lien ou un code promo. */
  ambiguous: boolean;
};

export type GeoCountry = {
  name: string;
  nameEn: string;
  languages: string[];
  currencies: string[];
  competitions: string[];
  clubs: string[];
  cities: string[];
  tlds: string[];
  phonePrefixes: string[];
  locale: string | null;
};

export type GeoLocale = { country: string; language: string; markers: string[] };
export type GeoSignalsDict = { countries: Record<string, GeoCountry>; locales: Record<string, GeoLocale> };

export type QueryVertical = "SPORTS" | "CASINO";
export type QueriesDict = Record<string, Record<QueryVertical, string[]>>;

export type AffiliatePatterns = {
  queryParams: string[];
  paramPrefixes: string[];
  pathMarkers: string[];
  shorteners: string[];
  linkHubs: string[];
  promoCodeLabels: Record<string, string[]>;
};

/** 24 langues officielles de l'UE + norvégien + islandais (ISO 639-1). */
export const QUERY_LANGUAGES = [
  "bg", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "de", "el", "hu", "ga", "it", "lv", "lt", "mt", "pl", "pt", "ro",
  "sk", "sl", "es", "sv", "no", "is",
] as const;
export type QueryLanguage = (typeof QUERY_LANGUAGES)[number];

/** Codes pays ISO 3166-1 alpha-2 admis dans les dictionnaires (périmètre + marchés hors Europe repérés). */
export const KNOWN_COUNTRY_CODES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
  "PL", "PT", "RO", "SK", "SI", "ES", "SE", "GB", "CH", "NO", "IS", "RS", "BA", "ME", "MK", "AL", "MD", "BR", "MX", "AR",
  "CO", "PE", "CL", "IN", "NG", "GH", "KE", "ZA", "TR", "RU", "UA", "KZ", "UZ", "BY", "AZ", "BD", "PK", "PH", "US", "CA",
  "AU",
]);

const BASE_BRANDS: Brand[] = (brandsData as unknown as { brands: Brand[] }).brands;
const GEO: GeoSignalsDict = geoData as unknown as GeoSignalsDict;
const QUERIES: QueriesDict = (queriesData as unknown as { languages: QueriesDict }).languages;
const BASE_CONTACTS: Record<string, string[]> = (contactData as unknown as { labels: Record<string, string[]> }).labels;
const BASE_AFFILIATE: AffiliatePatterns = affiliateData as unknown as AffiliatePatterns;

/** Dictionnaires en cours = fichiers du dépôt + ajouts validés par le client (`loadDictAdditions`). */
let BRANDS: Brand[] = BASE_BRANDS;
let CONTACTS: Record<string, string[]> = BASE_CONTACTS;
let AFFILIATE: AffiliatePatterns = BASE_AFFILIATE;
let additionsKey = "";

/** Forme de comparaison d'un nom de marque : minuscules, sans espaces ni ponctuation (accents gardés). */
export function brandToken(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFC")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[\s.\-_'’!:/]+/g, "");
}

let brandIndex: Map<string, Brand> | null = null;
function index(): Map<string, Brand> {
  if (brandIndex) return brandIndex;
  const m = new Map<string, Brand>();
  for (const b of BRANDS) {
    for (const v of [b.key, b.name, ...b.aliases, ...b.domains, ...b.telegram]) {
      const t = brandToken(v);
      if (t && !m.has(t)) m.set(t, b);
    }
  }
  brandIndex = m;
  return m;
}

// ---------------------------------------------------------------- ajouts validés (site → Setting)

export const DICT_ADDITIONS_KEY = "prospection.dict_additions";

/** Ajouts validés par le client sur la page Prospection → Dictionnaires (jamais d'ajout silencieux). */
export type DictAdditions = {
  brands?: Array<{ name: string; country?: string | null; type?: string | null; status?: string | null }>;
  queryParams?: string[];
  pathMarkers?: string[];
  shorteners?: string[];
  promoCodeLabels?: Record<string, string[]>;
  contactLabels?: Record<string, string[]>;
};

const uniq = (list: string[]) => [...new Set(list.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()))];
const mergeLabels = (base: Record<string, string[]>, add: Record<string, string[]> | undefined) => {
  const out: Record<string, string[]> = { ...base };
  for (const [lang, list] of Object.entries(add ?? {})) if (Array.isArray(list)) out[lang] = uniq([...(out[lang] ?? []), ...list]);
  return out;
};

/**
 * Applique des ajouts aux dictionnaires (pur côté données : les fichiers ne changent pas). Une marque déjà connue
 * (même nom, alias ou domaine) n'est pas dupliquée ; une marque ajoutée est « local » / « both » par défaut.
 */
export function applyDictAdditions(add: DictAdditions | null | undefined): void {
  const key = JSON.stringify(add ?? {});
  if (key === additionsKey) return;
  additionsKey = key;
  const known = new Set(BASE_BRANDS.flatMap((b) => [b.key, b.name, ...b.aliases, ...b.domains].map(brandToken)));
  const extra: Brand[] = [];
  for (const b of add?.brands ?? []) {
    const t = b?.name ? brandToken(b.name) : "";
    if (!t || known.has(t)) continue;
    known.add(t);
    const cc = typeof b.country === "string" && b.country.trim() ? b.country.trim().toUpperCase() : "GLOBAL";
    const type = (["bookmaker", "casino", "both"] as const).find((x) => x === String(b.type ?? "").toLowerCase()) ?? "both";
    const status = String(b.status ?? "").toLowerCase() === "offshore" ? "offshore" : "local";
    extra.push({ key: t, name: b.name.trim(), aliases: [], type, status, country: cc, countries: [cc], domains: [], telegram: [], offshoreNonEu: false, ambiguous: false });
  }
  BRANDS = extra.length ? [...BASE_BRANDS, ...extra] : BASE_BRANDS;
  CONTACTS = mergeLabels(BASE_CONTACTS, add?.contactLabels);
  AFFILIATE = {
    ...BASE_AFFILIATE,
    queryParams: uniq([...BASE_AFFILIATE.queryParams, ...(add?.queryParams ?? [])]),
    pathMarkers: uniq([...BASE_AFFILIATE.pathMarkers, ...(add?.pathMarkers ?? [])]),
    shorteners: uniq([...BASE_AFFILIATE.shorteners, ...(add?.shorteners ?? [])].map((s) => s.toLowerCase())),
    promoCodeLabels: mergeLabels(BASE_AFFILIATE.promoCodeLabels, add?.promoCodeLabels),
  };
  brandIndex = null;
}

/** Lit `Setting prospection.dict_additions` et l'applique (à appeler au début d'un enrichissement). */
export async function loadDictAdditions(deps: Pick<AgentsDeps, "prisma">): Promise<DictAdditions> {
  const raw = await readSetting(deps, DICT_ADDITIONS_KEY);
  const v = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as DictAdditions) : {};
  applyDictAdditions(v);
  return v;
}

export function brandsDict(): Brand[] {
  return BRANDS;
}

/** Marque par nom, alias, domaine ou username officiel ; `null` si inconnue. */
export function findBrand(name: string | null | undefined): Brand | null {
  if (!name) return null;
  return index().get(brandToken(name)) ?? null;
}

/** Marque d'après l'hôte d'un lien (« www.betclic.fr », « sport.bwin.de ») : domaine exact ou sous-domaine. */
export function findBrandByDomain(host: string | null | undefined): Brand | null {
  if (!host) return null;
  const h = host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  for (const b of BRANDS) for (const d of b.domains) if (h === d || h.endsWith(`.${d}`)) return b;
  return null;
}

export function brandsForCountry(cc: string): Brand[] {
  const c = cc.toUpperCase();
  return BRANDS.filter((b) => b.countries.includes(c));
}

/** Suffixes d'un username officiel (« 1xbet_official », « winamaxofficiel »). */
const OFFICIAL_SUFFIXES = ["", "official", "officiel", "oficial", "ufficiale", "offiziell", "officialchannel"];

/** Username officiel d'une marque (liste du dictionnaire, ou nom de marque + suffixe « officiel »). */
export function isBrandUsername(username: string | null | undefined): boolean {
  if (!username) return false;
  const u = username.toLowerCase().replace(/^@/, "");
  for (const b of BRANDS) {
    if (b.telegram.includes(u)) return true;
    if (b.ambiguous) continue;
    const tokens = [brandToken(b.key), brandToken(b.name)];
    const flat = u.replace(/_/g, "");
    if (tokens.some((t) => OFFICIAL_SUFFIXES.some((s) => flat === `${t}${s}`))) return true;
  }
  return false;
}

export function geoSignals(): GeoSignalsDict {
  return GEO;
}

export function countryLanguages(cc: string): string[] {
  return GEO.countries[cc.toUpperCase()]?.languages ?? [];
}

/** Gabarits de recherche d'une langue et d'une verticale (liste vide si la langue n'est pas couverte). */
export function queriesFor(lang: string, vertical: QueryVertical): string[] {
  return QUERIES[lang.toLowerCase()]?.[vertical] ?? [];
}

export function contactLabels(): Record<string, string[]> {
  return CONTACTS;
}

export function allContactLabels(): string[] {
  return [...new Set(Object.values(CONTACTS).flat().map((l) => l.toLowerCase()))];
}

export function affiliatePatterns(): AffiliatePatterns {
  return AFFILIATE;
}

/** Contrôle de structure des dictionnaires (doublons, codes pays, langues complètes). Vide = tout est bon. */
export function validateDicts(): string[] {
  const problems: string[] = [];
  const seenKeys = new Set<string>();
  const seenTokens = new Map<string, string>();
  for (const b of BRANDS) {
    if (seenKeys.has(b.key)) problems.push(`marque en double : ${b.key}`);
    seenKeys.add(b.key);
    if (!["bookmaker", "casino", "both"].includes(b.type)) problems.push(`type inconnu : ${b.key}`);
    if (!["local", "offshore"].includes(b.status)) problems.push(`statut inconnu : ${b.key}`);
    if (typeof b.offshoreNonEu !== "boolean" || typeof b.ambiguous !== "boolean") problems.push(`drapeaux manquants : ${b.key}`);
    for (const c of [b.country, ...b.countries])
      if (c !== "GLOBAL" && !KNOWN_COUNTRY_CODES.has(c)) problems.push(`code pays inconnu ${c} : ${b.key}`);
    if (!b.countries.length) problems.push(`aucun pays : ${b.key}`);
    if (new Set(b.countries).size !== b.countries.length) problems.push(`pays en double : ${b.key}`);
    for (const v of [b.key, b.name, ...b.aliases, ...b.domains]) {
      const t = brandToken(v);
      const other = seenTokens.get(t);
      if (other && other !== b.key) problems.push(`nom partagé « ${v} » : ${other} et ${b.key}`);
      seenTokens.set(t, b.key);
    }
  }
  for (const [cc, g] of Object.entries(GEO.countries)) {
    if (!KNOWN_COUNTRY_CODES.has(cc)) problems.push(`pays inconnu dans geo-signals : ${cc}`);
    for (const f of ["languages", "currencies", "competitions", "clubs", "cities", "tlds", "phonePrefixes"] as const) {
      const list = g[f];
      if (!Array.isArray(list) || !list.length) problems.push(`geo ${cc} : ${f} vide`);
      else if (new Set(list.map((x) => x.toLowerCase())).size !== list.length) problems.push(`geo ${cc} : doublon dans ${f}`);
    }
    if (g.locale && !GEO.locales[g.locale]) problems.push(`geo ${cc} : locale ${g.locale} sans repères`);
  }
  for (const [loc, l] of Object.entries(GEO.locales)) {
    if (!GEO.countries[l.country]) problems.push(`locale ${loc} : pays ${l.country} absent`);
    if (!l.markers.length) problems.push(`locale ${loc} : aucun repère`);
  }
  for (const lang of QUERY_LANGUAGES) {
    for (const v of ["SPORTS", "CASINO"] as const) {
      const qs = QUERIES[lang]?.[v];
      if (!qs?.length) problems.push(`requêtes ${lang} ${v} manquantes`);
      else if (new Set(qs.map((q) => q.toLowerCase())).size !== qs.length) problems.push(`requêtes ${lang} ${v} : doublon`);
    }
  }
  for (const lang of Object.keys(QUERIES)) if (!(QUERY_LANGUAGES as readonly string[]).includes(lang)) problems.push(`langue de requête hors liste : ${lang}`);
  for (const lang of QUERY_LANGUAGES) if (!CONTACTS[lang]?.length) problems.push(`étiquettes de contact ${lang} manquantes`);
  for (const [lang, list] of Object.entries(CONTACTS))
    if (new Set(list.map((x) => x.toLowerCase())).size !== list.length) problems.push(`étiquettes ${lang} : doublon`);
  if (new Set(AFFILIATE.shorteners).size !== AFFILIATE.shorteners.length) problems.push("raccourcisseur en double");
  if (new Set(AFFILIATE.queryParams).size !== AFFILIATE.queryParams.length) problems.push("paramètre d'affiliation en double");
  return problems;
}

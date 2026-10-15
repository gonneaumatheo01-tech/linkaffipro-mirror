import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { Reader, type Response as MmdbRecord } from "mmdb-lib";

/**
 * Pays d'un visiteur des pages d'atterrissage (phase 15) d'après son adresse IP, par une base LOCALE : DB-IP Lite
 * « IP to Country » (licence CC BY 4.0, attribution « IP Geolocation by DB-IP », https://db-ip.com), paquet
 * `@ip-location-db/dbip-country-mmdb` lu avec `mmdb-lib` (MIT). Aucun service extérieur, l'adresse n'est jamais
 * gardée ni mise en file : seul le code pays (deux lettres) sort d'ici.
 *
 * La base (~8 Mo en mémoire, IPv4 et IPv6) est chargée au premier besoin, APRÈS la réponse (envoi des visites) :
 * jamais pendant l'affichage d'une page.
 */

type CountryRecord = { country_code?: string };

export type CountryLookup = (ip: string) => string | null;

const DB_PACKAGE = "@ip-location-db/dbip-country-mmdb";
const DB_FILE = "dbip-country.mmdb";

/** Adresse lisible : sans port, sans crochets, IPv4 « mappée » en IPv6 ramenée à l'IPv4 ; null si ce n'en est pas une. */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let ip = raw.trim();
  if (!ip) return null;
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(ip);
  if (bracket) ip = bracket[1]!;
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.replace(/:\d+$/, "");
  ip = ip.replace(/%.+$/, ""); // zone IPv6 (« fe80::1%en0 »)
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) ip = mapped[1]!;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) {
    return ip.split(".").every((p) => Number(p) <= 255) ? ip : null;
  }
  return /^[0-9a-f:]+$/i.test(ip) && ip.includes(":") ? ip.toLowerCase() : null;
}

/**
 * Adresse du visiteur d'après les en-têtes du proxy de Railway (même règle que les redirections goolink,
 * `lib/tracking.ts`) : premier élément de `x-forwarded-for`, sinon `x-real-ip`.
 */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  return normalizeIp(forwarded?.split(",")[0]) ?? normalizeIp(headers.get("x-real-ip"));
}

/** Lecture d'une base MMDB déjà chargée (tests : petite base fabriquée). */
export function countryLookupFrom(db: Buffer): CountryLookup {
  const reader = new Reader<MmdbRecord>(db);
  return (raw) => {
    const ip = normalizeIp(raw);
    if (!ip) return null;
    try {
      const rec = reader.get(ip) as CountryRecord | null;
      const code = rec?.country_code?.toUpperCase() ?? "";
      return /^[A-Z]{2}$/.test(code) && code !== "ZZ" ? code : null;
    } catch {
      return null;
    }
  };
}

/**
 * Emplacements possibles de la base : `LANDING_COUNTRY_DB` (fichier plus récent posé à la main, facultatif), puis le
 * paquet dans `node_modules` du site (pnpm : lien vers le magasin), puis celui de la racine du dépôt. Chemins calculés
 * depuis le dossier de travail (`apps/web` pour `next start` comme pour les tests), sans `require.resolve` : Next
 * empaquette ce fichier et ne doit pas réécrire le chemin.
 */
export function countryDbCandidates(cwd: string = process.cwd()): string[] {
  const own = process.env.LANDING_COUNTRY_DB?.trim();
  return [
    ...(own ? [own] : []),
    path.join(cwd, "node_modules", DB_PACKAGE, DB_FILE),
    path.join(cwd, "..", "..", "node_modules", DB_PACKAGE, DB_FILE),
  ];
}

async function firstReadable(paths: string[]): Promise<string> {
  for (const p of paths) {
    try {
      await access(p);
      return p;
    } catch {
      // suivant
    }
  }
  throw new Error(`base des pays introuvable (${paths.join(", ")})`);
}

type GeoState = { lookup: Promise<CountryLookup | null> | null; warned: boolean };

declare global {
  var __lapLandingGeo: GeoState | undefined;
}

function state(): GeoState {
  return (globalThis.__lapLandingGeo ??= { lookup: null, warned: false });
}

/** Chargement unique par processus ; base absente ou illisible : pays inconnu (null), un seul avertissement. */
async function loadLookup(): Promise<CountryLookup | null> {
  try {
    return countryLookupFrom(
      await readFile(/*turbopackIgnore: true*/ await firstReadable(countryDbCandidates())),
    );
  } catch (err) {
    const s = state();
    if (!s.warned) {
      s.warned = true;
      console.warn("[landing] base des pays illisible : pays inconnu pour les visites", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  }
}

/** Pays (ISO 3166-1 alpha-2) d'une adresse, ou null (adresse privée, inconnue, base indisponible). */
export async function countryOfIp(ip: string | null | undefined): Promise<string | null> {
  if (!ip) return null;
  const s = state();
  s.lookup ??= loadLookup();
  const lookup = await s.lookup;
  return lookup ? lookup(ip) : null;
}

/**
 * Phase 35, chantier A : ce dont un transport a besoin pour un site (adresse, domaines permis, identifiants, session,
 * proxy), sans jamais le mettre dans un journal ni dans `BookmakerReadJob.params`.
 * - worker / site : `dbTransportEnv(deps)` (base : `BookmakerSite`, recette active, secrets chiffrés de la phase 23) ;
 * - Mac : `memoryTransportEnv(payload)` (tout arrive du site par l'API du runner et repart ; rien sur disque).
 * Identifiants : ceux du site s'il en a (`providers.bookmakers.<site>.login/.password`), sinon le secret commun
 * `providers.bookmakers.default.credentials` (JSON `{ login | email, password }`). Le chantier D peut brancher sa
 * lecture (`readBookmakerCredentialsFor`) par `setBookmakerCredentialsReader`.
 */
import type { AgentsPrisma } from "../../types";
import { readSecret } from "../../human/secrets";
import type { BookmakerCredentials } from "../../providers/screenshot/adapter";
import { adapterFor } from "../../providers/screenshot/adapters";
import {
  readBookmakerCredentials,
  readBookmakerSession,
  readScreenshotProxy,
  saveBookmakerSession,
  type BrowserStorageState,
  type ProxyConfig,
} from "../../providers/screenshot/session";
import { BOOKMAKER_DEFAULT_CREDENTIALS_KEY, DEFAULT_BOOKMAKER_SITES } from "../contract";

export type SiteAccess = { key: string; label: string; baseUrl: string; allowedHosts: string[] };

export type TransportEnv = {
  site(siteKey: string): Promise<SiteAccess | null>;
  credentials(siteKey: string): Promise<BookmakerCredentials | null>;
  loadSession(siteKey: string): Promise<BrowserStorageState | null>;
  saveSession(siteKey: string, state: BrowserStorageState): Promise<void>;
  proxy(): Promise<ProxyConfig | null>;
};

type EnvDeps = { prisma: AgentsPrisma };

/** Pur : domaine de base d'une adresse (sans « www. »), ou null. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** Pur : domaines des points d'entrée et des étapes d'une recette (`api.endpoints[].urlTemplate`). */
export function recipeHosts(api: unknown): string[] {
  const eps = (api as { endpoints?: Array<{ urlTemplate?: unknown }> } | null)?.endpoints;
  if (!Array.isArray(eps)) return [];
  const out = new Set<string>();
  for (const e of eps) {
    const raw = typeof e?.urlTemplate === "string" ? e.urlTemplate.replace(/\{[a-zA-Z]+\}/g, "x") : null;
    const h = hostOf(raw);
    if (h) out.add(h);
  }
  return [...out];
}

/** Pur : secret commun (JSON) → identifiants. */
export function parseDefaultCredentials(raw: string | null): BookmakerCredentials | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { login?: unknown; email?: unknown; password?: unknown };
    const login = typeof o.login === "string" ? o.login : typeof o.email === "string" ? o.email : null;
    return login && typeof o.password === "string" && o.password ? { login: login.trim(), password: o.password } : null;
  } catch {
    return null;
  }
}

export type CredentialsReader = (deps: EnvDeps, siteKey: string) => Promise<BookmakerCredentials | null>;

/** Lecture par défaut : identifiants propres au site, sinon le secret commun. */
export const defaultCredentialsReader: CredentialsReader = async (deps, siteKey) =>
  (await readBookmakerCredentials(deps.prisma, siteKey)) ?? parseDefaultCredentials(await readSecret(deps.prisma, BOOKMAKER_DEFAULT_CREDENTIALS_KEY));

let credentialsReader: CredentialsReader = defaultCredentialsReader;
/** Branche une autre lecture des identifiants (chantier D : `readBookmakerCredentialsFor`). `null` : lecture par défaut. */
export function setBookmakerCredentialsReader(fn: CredentialsReader | null): void {
  credentialsReader = fn ?? defaultCredentialsReader;
}
export function readTransportCredentials(deps: EnvDeps, siteKey: string): Promise<BookmakerCredentials | null> {
  return credentialsReader(deps, siteKey);
}

/** Adresse et domaines permis d'un site (base, recette active, adaptateur de la phase 23). */
export async function loadSiteAccess(deps: EnvDeps, siteKey: string): Promise<SiteAccess | null> {
  const row = (await deps.prisma.bookmakerSite.findUnique({ where: { key: siteKey } })) as { key: string; label: string; baseUrl: string | null; sportsPath: string | null } | null;
  const known = DEFAULT_BOOKMAKER_SITES.find((s) => s.key === siteKey);
  const baseUrl = row?.baseUrl ?? known?.baseUrl ?? null;
  if (!baseUrl) return null;
  const hosts = new Set<string>();
  const h = hostOf(baseUrl);
  if (h) hosts.add(h);
  const recipe = (await deps.prisma.bookmakerRecipe.findFirst({ where: { siteKey, isActive: true }, orderBy: { version: "desc" } })) as { api: unknown } | null;
  for (const x of recipeHosts(recipe?.api)) hosts.add(x);
  for (const x of adapterFor(siteKey)?.config.allowedHosts ?? []) hosts.add(x.toLowerCase());
  return { key: siteKey, label: row?.label ?? known?.label ?? siteKey, baseUrl, allowedHosts: [...hosts] };
}

export function dbTransportEnv(deps: EnvDeps): TransportEnv {
  return {
    site: (k) => loadSiteAccess(deps, k),
    credentials: (k) => readTransportCredentials(deps, k),
    loadSession: (k) => readBookmakerSession(deps.prisma, k),
    saveSession: (k, s) => saveBookmakerSession(deps.prisma, k, s),
    proxy: () => readScreenshotProxy(deps.prisma),
  };
}

/** Environnement en mémoire (Mac, tests) : la session rangée est seulement gardée en mémoire puis rendue. */
export function memoryTransportEnv(p: {
  site: SiteAccess;
  credentials?: BookmakerCredentials | null;
  session?: BrowserStorageState | null;
  proxy?: ProxyConfig | null;
}): TransportEnv & { savedSession(): BrowserStorageState | null } {
  let session = p.session ?? null;
  let saved: BrowserStorageState | null = null;
  return {
    site: async (k) => (k === p.site.key ? p.site : null),
    credentials: async () => p.credentials ?? null,
    loadSession: async () => session,
    saveSession: async (_k, s) => {
      session = s;
      saved = s;
    },
    proxy: async () => p.proxy ?? null,
    savedSession: () => saved,
  };
}

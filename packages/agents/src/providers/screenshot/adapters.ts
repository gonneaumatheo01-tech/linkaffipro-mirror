/**
 * Adaptateurs connus et réglages sans redéploiement : `AgentTeamConfig.settings.sports.bookmakers.<clé>` peut
 * remplacer l'adresse, les domaines permis et n'importe quel sélecteur (un site qui change ne casse pas tout).
 * Un bookmaker sans adaptateur dédié n'est jamais deviné : `null` (pas de capture, repli image).
 */
import { createSelectorAdapter, type BookmakerAdapter, type BookmakerConfig, type BookmakerSelectors } from "./adapter";
import { SPORTAZA_CONFIG } from "./sportaza";

export const BOOKMAKER_CONFIGS: Record<string, BookmakerConfig> = {
  sportaza: SPORTAZA_CONFIG,
};

export function bookmakerKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

export type BookmakerOverride = Partial<Omit<BookmakerConfig, "selectors" | "key">> & { selectors?: Partial<BookmakerSelectors> };

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Pur : configuration finale = défaut + réglages (champs invalides ignorés). */
export function mergeBookmakerConfig(base: BookmakerConfig, override: unknown): BookmakerConfig {
  if (!override || typeof override !== "object") return base;
  const o = override as Record<string, unknown>;
  const selectors: BookmakerSelectors = { ...base.selectors };
  if (o.selectors && typeof o.selectors === "object")
    for (const [k, v] of Object.entries(o.selectors as Record<string, unknown>))
      if (k in selectors && typeof v === "string") selectors[k as keyof BookmakerSelectors] = v;
  const hosts = Array.isArray(o.allowedHosts) ? o.allowedHosts.filter((h): h is string => typeof h === "string" && h.length > 2) : null;
  const timeout = Number(o.stepTimeoutMs);
  return {
    ...base,
    label: str(o.label) ?? base.label,
    baseUrl: str(o.baseUrl) ?? base.baseUrl,
    loginUrl: o.loginUrl === null ? null : (str(o.loginUrl) ?? base.loginUrl),
    searchUrl: o.searchUrl === null ? null : (str(o.searchUrl) ?? base.searchUrl),
    allowedHosts: hosts && hosts.length ? hosts : base.allowedHosts,
    stepTimeoutMs: Number.isFinite(timeout) && timeout >= 1000 && timeout <= 60_000 ? timeout : base.stepTimeoutMs,
    selectors,
  };
}

/** Adaptateur d'un bookmaker (réglages de l'équipe appliqués), ou `null` s'il n'est pas pris en charge. */
export function adapterFor(name: string, overrides?: Record<string, unknown> | null): BookmakerAdapter | null {
  const key = bookmakerKey(name);
  const base = BOOKMAKER_CONFIGS[key];
  if (!base) return null;
  return createSelectorAdapter(mergeBookmakerConfig(base, overrides?.[key]));
}

export function supportedBookmakers(): string[] {
  return Object.keys(BOOKMAKER_CONFIGS);
}

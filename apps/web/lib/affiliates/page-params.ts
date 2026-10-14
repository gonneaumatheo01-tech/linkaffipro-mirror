/**
 * Adresse de la page « Affiliés Link Affi » (/campaigns/affiliates) : période commune (`range`, `from`, `to`, 30 jours
 * par défaut : un affilié se suit au mois), canal et affilié. Fonctions pures, testées dans page-params.test.ts.
 */
import { isDayKey, parsePeriodKey, periodParams, resolvePeriod, type Period } from "@/lib/periods";

export const AFFILIATES_PATH = "/campaigns/affiliates";
export const AFFILIATES_DEFAULT_RANGE = "30d";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").trim();

export type AffiliatesFilters = {
  period: Period;
  channelId: string;
  affiliateId: string;
};

export function parseAffiliatesFilters(sp: SP, now = new Date()): AffiliatesFilters {
  const key = parsePeriodKey(sp.range);
  const chosen = (key && key !== "custom") || (isDayKey(one(sp.from)) && isDayKey(one(sp.to)));
  return {
    period: resolvePeriod(chosen ? sp : { range: AFFILIATES_DEFAULT_RANGE }, now),
    channelId: one(sp.channelId).slice(0, 64),
    affiliateId: one(sp.affiliateId).slice(0, 128),
  };
}

/** Paramètres d'adresse (période puis filtres posés), pour les liens, l'export et les filtres. */
export function affiliatesParams(
  f: AffiliatesFilters,
  overrides: Partial<Pick<AffiliatesFilters, "channelId" | "affiliateId">> = {},
): Record<string, string> {
  const m = { ...f, ...overrides };
  return {
    ...periodParams(m.period),
    ...(m.channelId ? { channelId: m.channelId } : {}),
    ...(m.affiliateId ? { affiliateId: m.affiliateId } : {}),
  };
}

export function affiliatesHref(
  f: AffiliatesFilters,
  overrides: Partial<Pick<AffiliatesFilters, "channelId" | "affiliateId">> = {},
  path = AFFILIATES_PATH,
): string {
  const q = new URLSearchParams(affiliatesParams(f, overrides)).toString();
  return q ? `${path}?${q}` : path;
}

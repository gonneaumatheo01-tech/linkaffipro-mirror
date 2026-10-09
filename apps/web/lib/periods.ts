/**
 * Périodes d'analyse communes (tableau de bord, pubs, exports) — fonctions pures, testées.
 * Une période = un intervalle de jours civils Europe/Paris, bornes incluses (`from` ≤ `to`, clés AAAA-MM-JJ).
 * Paramètres d'URL : `range` (clé), `from` / `to` (période personnalisée), `compare=1` (période précédente).
 */

import { dayKey } from "@/lib/dashboard/aggregate";

export type PeriodKey = "today" | "yesterday" | "7d" | "30d" | "90d" | "month" | "custom";

export const PERIOD_KEYS: PeriodKey[] = [
  "today",
  "yesterday",
  "7d",
  "30d",
  "90d",
  "month",
  "custom",
];

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: "Aujourd'hui",
  yesterday: "Hier",
  "7d": "7 derniers jours",
  "30d": "30 derniers jours",
  "90d": "90 derniers jours",
  month: "Mois en cours",
  custom: "Personnalisée",
};

export type Period = { key: PeriodKey; from: string; to: string; days: number };

/** Durée maximale d'une période personnalisée (jours). */
export const MAX_CUSTOM_DAYS = 366;

const DAY_MS = 86_400_000;

function keyToUtc(key: string): number {
  return Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
}

/** Clé de jour décalée de `n` jours (calcul en UTC sur des jours civils : pas d'effet d'heure d'été). */
export function shiftDay(key: string, n: number): string {
  return new Date(keyToUtc(key) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Nombre de jours entre deux clés, bornes incluses. */
export function daysBetween(from: string, to: string): number {
  return Math.round((keyToUtc(to) - keyToUtc(from)) / DAY_MS) + 1;
}

export function isDayKey(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Clé de période depuis un paramètre d'URL ; accepte les anciens `7` / `30` / `90` ; null si inconnue. */
export function parsePeriodKey(v: unknown): PeriodKey | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== "string") return null;
  if (s === "7" || s === "30" || s === "90") return `${s}d` as PeriodKey;
  return PERIOD_KEYS.includes(s as PeriodKey) ? (s as PeriodKey) : null;
}

export function parseCompare(v: unknown): boolean {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "1" || s === "true" || s === "on";
}

type Param = string | string[] | undefined;

/**
 * Résout une période depuis les paramètres d'URL. Par défaut : 7 derniers jours. `custom` exige `from` et `to`
 * valides (sinon repli sur 7 jours) ; une période trop longue est tronquée à 366 jours depuis `from`.
 */
export function resolvePeriod(
  params: { range?: Param; from?: Param; to?: Param },
  now = new Date(),
): Period {
  const today = dayKey(now);
  const key =
    parsePeriodKey(params.range) ??
    (isDayKey(one(params.from)) && isDayKey(one(params.to)) ? "custom" : "7d");
  switch (key) {
    case "today":
      return { key, from: today, to: today, days: 1 };
    case "yesterday": {
      const y = shiftDay(today, -1);
      return { key, from: y, to: y, days: 1 };
    }
    case "7d":
    case "30d":
    case "90d": {
      const n = Number(key.slice(0, -1));
      return { key, from: shiftDay(today, -(n - 1)), to: today, days: n };
    }
    case "month": {
      const from = `${today.slice(0, 8)}01`;
      return { key, from, to: today, days: daysBetween(from, today) };
    }
    case "custom": {
      const from = one(params.from);
      const to = one(params.to);
      if (!isDayKey(from) || !isDayKey(to)) return resolvePeriod({ range: "7d" }, now);
      const [a, b] = from <= to ? [from, to] : [to, from];
      const end = daysBetween(a, b) > MAX_CUSTOM_DAYS ? shiftDay(a, MAX_CUSTOM_DAYS - 1) : b;
      return { key, from: a, to: end, days: daysBetween(a, end) };
    }
  }
}

function one(v: Param): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Période précédente de même longueur, se terminant la veille de `from`. */
export function previousPeriod(p: Period): Period {
  const to = shiftDay(p.from, -1);
  const from = shiftDay(to, -(p.days - 1));
  return { key: "custom", from, to, days: p.days };
}

/** Clés de jour de la période, dans l'ordre. */
export function periodDayKeys(p: Period): string[] {
  const out: string[] = [];
  for (let i = 0; i < p.days; i++) out.push(shiftDay(p.from, i));
  return out;
}

/** Minuit Paris (en UTC) du jour `key`. */
export function parisMidnightUtc(key: string): Date {
  const base = keyToUtc(key);
  for (const offsetH of [2, 1, 0]) {
    const candidate = base - offsetH * 3_600_000;
    if (dayKey(new Date(candidate)) === key && dayKey(new Date(candidate - 60_000)) !== key)
      return new Date(candidate);
  }
  return new Date(base);
}

/** Début (inclus) de la période : minuit Paris du premier jour. */
export function periodStart(p: Period): Date {
  return parisMidnightUtc(p.from);
}

/** Fin (exclue) de la période : minuit Paris du lendemain du dernier jour. */
export function periodEnd(p: Period): Date {
  return parisMidnightUtc(shiftDay(p.to, 1));
}

/** Dates `@db.Date` (UTC) couvrant la période, pour `DailyStat` et `AdCost` : `gte dateFrom`, `lte dateTo`. */
export function periodDates(p: Period): { dateFrom: Date; dateTo: Date } {
  return { dateFrom: new Date(`${p.from}T00:00:00Z`), dateTo: new Date(`${p.to}T00:00:00Z`) };
}

const shortFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const longFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** Jour lisible (« 9 oct. 2026 »). */
export function fmtDayKey(key: string, withYear = true): string {
  return (withYear ? longFmt : shortFmt).format(new Date(`${key}T12:00:00Z`));
}

/** Libellé en français : « 7 derniers jours », « Du 1 oct. au 9 oct. 2026 », « Le 9 oct. 2026 ». */
export function periodLabel(p: Period): string {
  if (p.key !== "custom") return PERIOD_LABELS[p.key];
  if (p.from === p.to) return `Le ${fmtDayKey(p.from)}`;
  const sameYear = p.from.slice(0, 4) === p.to.slice(0, 4);
  return `Du ${fmtDayKey(p.from, !sameYear)} au ${fmtDayKey(p.to)}`;
}

/** Libellé avec les bornes : « 7 derniers jours (3 oct. – 9 oct. 2026) ». */
export function periodLabelWithDates(p: Period): string {
  if (p.key === "custom") return periodLabel(p);
  if (p.days === 1) return `${PERIOD_LABELS[p.key]} (${fmtDayKey(p.from)})`;
  const sameYear = p.from.slice(0, 4) === p.to.slice(0, 4);
  return `${PERIOD_LABELS[p.key]} (${fmtDayKey(p.from, !sameYear)} – ${fmtDayKey(p.to)})`;
}

/** Paramètres d'URL décrivant la période (et la comparaison), à fusionner avec les autres filtres. */
export function periodParams(p: Period, compare = false): Record<string, string> {
  const out: Record<string, string> = { range: p.key };
  if (p.key === "custom") {
    out.from = p.from;
    out.to = p.to;
  }
  if (compare) out.compare = "1";
  return out;
}

/** Variation en % entre deux valeurs (une décimale) ; null si la précédente est nulle et la courante non. */
export function variationPct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Variation entre deux valeurs pouvant être absentes (indicateurs dérivés). */
export function variationOf(
  current: number | null | undefined,
  previous: number | null | undefined,
): number | null {
  if (current === null || current === undefined || previous === null || previous === undefined)
    return null;
  return variationPct(current, previous);
}

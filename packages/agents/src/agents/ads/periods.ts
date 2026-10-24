/**
 * Périodes de l'Agent Ads (pur, jours de Paris) : jours complets seulement (aujourd'hui, pas fini, n'est jamais
 * comparé à un jour entier). « hier » = J-1 ; « 7 jours » = J-7 à J-1 ; « 28 jours » = J-28 à J-1 ; période
 * précédente = même longueur juste avant.
 */
import { addDaysToDay, parisDay } from "../../rules/time";
import type { AdsPeriod } from "../../ads/contracts";

export const PERIOD_DAYS: Record<AdsPeriod, number> = { yesterday: 1, "7d": 7, "28d": 28 };

export type AdsRange = { from: string; to: string; prevFrom: string; prevTo: string; days: number };

export function adsRange(period: AdsPeriod, now: Date): AdsRange {
  const days = PERIOD_DAYS[period];
  const to = addDaysToDay(parisDay(now), -1);
  const from = addDaysToDay(to, -(days - 1));
  const prevTo = addDaysToDay(from, -1);
  const prevFrom = addDaysToDay(prevTo, -(days - 1));
  return { from, to, prevFrom, prevTo, days };
}

/** Jours de `from` à `to` inclus. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysToDay(d, 1)) out.push(d);
  return out;
}

/** Jour d'une colonne `@db.Date` (minuit UTC du jour civil). */
export const dateKey = (d: Date) => d.toISOString().slice(0, 10);
export const dayDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

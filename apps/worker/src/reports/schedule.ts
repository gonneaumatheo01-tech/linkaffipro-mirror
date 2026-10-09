/**
 * Décide s'il faut envoyer le brief quotidien et/ou le rapport hebdomadaire maintenant. Pur, testé.
 * Idempotence : `lastDaily` / `lastWeekly` mémorisent la clé de jour (Paris) du dernier envoi.
 */

export type ReportsConfig = { daily: boolean; weekly: boolean; hour: number };

export const DEFAULT_REPORTS_CONFIG: ReportsConfig = { daily: true, weekly: true, hour: 9 };

/** Lit la configuration depuis une valeur JSON de `Setting` (tolérant). */
export function parseReportsConfig(value: unknown): ReportsConfig {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const hour = typeof v.hour === "number" && v.hour >= 0 && v.hour <= 23 ? Math.floor(v.hour) : DEFAULT_REPORTS_CONFIG.hour;
  return {
    daily: typeof v.daily === "boolean" ? v.daily : DEFAULT_REPORTS_CONFIG.daily,
    weekly: typeof v.weekly === "boolean" ? v.weekly : DEFAULT_REPORTS_CONFIG.weekly,
    hour,
  };
}

const partsFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "numeric", hour12: false, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" });

/** Heure (0–23), jour de semaine (1 = lundi … 7 = dimanche) et clé de jour AAAA-MM-JJ, en heure de Paris. */
export function parisParts(now: Date): { hour: number; weekday: number; dayKey: string } {
  const p = Object.fromEntries(partsFmt.formatToParts(now).map((x) => [x.type, x.value]));
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { hour: Number(p.hour) % 24, weekday: map[p.weekday ?? "Mon"] ?? 1, dayKey: `${p.year}-${p.month}-${p.day}` };
}

export type DueInput = { now: Date; config: ReportsConfig; lastDaily: string | null; lastWeekly: string | null };

/** Quels rapports sont dus maintenant. */
export function dueReports(input: DueInput): { daily: boolean; weekly: boolean; dayKey: string } {
  const { hour, weekday, dayKey } = parisParts(input.now);
  const reached = hour >= input.config.hour;
  const daily = input.config.daily && reached && input.lastDaily !== dayKey;
  const weekly = input.config.weekly && reached && weekday === 1 && input.lastWeekly !== dayKey;
  return { daily, weekly, dayKey };
}

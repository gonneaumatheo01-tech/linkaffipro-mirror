/** Agrégation par jour (Europe/Paris) de listes d'horodatages — fonction pure, testée. */

export type Range = "today" | "7d" | "30d" | "90d";

export const RANGE_LABELS: Record<Range, string> = { today: "Aujourd'hui", "7d": "7 jours", "30d": "30 jours", "90d": "90 jours" };

/** Ancienne clé de période (accueil) ; accepte aussi `7` / `30` / `90`. Les pages utilisent désormais `@/lib/periods`. */
export function parseRange(value: unknown): Range {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === "7" || v === "30" || v === "90") return `${v}d` as Range;
  return v === "today" || v === "7d" || v === "30d" || v === "90d" ? v : "7d";
}

export function rangeDays(range: Range): number {
  return range === "today" ? 1 : range === "7d" ? 7 : range === "30d" ? 30 : 90;
}

const dayFmt = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });

/** Clé de jour `AAAA-MM-JJ` en heure de Paris. */
export function dayKey(d: Date): string {
  return dayFmt.format(d);
}

/** Liste des clés de jour couvrant `days` jours jusqu'à `now` inclus. */
export function dayKeys(days: number, now = new Date()): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(dayKey(new Date(now.getTime() - i * 86_400_000)));
  return out;
}

/** Début (UTC) de la fenêtre : minuit Paris du premier jour. */
export function rangeStart(range: Range, now = new Date()): Date {
  const first = dayKeys(rangeDays(range), now)[0]!;
  // Minuit Paris du premier jour : on part de midi UTC ce jour-là et on recule jusqu'au bon jour Paris.
  const t = Date.UTC(Number(first.slice(0, 4)), Number(first.slice(5, 7)) - 1, Number(first.slice(8, 10)), 0, 0, 0);
  // Paris = UTC+1 ou +2 : minuit Paris est 22h ou 23h UTC la veille.
  for (const offsetH of [2, 1, 0]) {
    const candidate = t - offsetH * 3_600_000;
    if (dayKey(new Date(candidate)) === first && dayKey(new Date(candidate - 60_000)) !== first) return new Date(candidate);
  }
  return new Date(t);
}

export type DaySeries = { keys: string[]; values: number[]; total: number };

/**
 * Compte des éléments par jour. `items` : dates (ou objets avec `at` et un poids optionnel `value`).
 * Les jours sans donnée valent 0 ; les éléments hors fenêtre sont ignorés.
 */
export function aggregateByDay(items: Array<Date | { at: Date; value?: number }>, keys: string[]): DaySeries {
  const index = new Map(keys.map((k, i) => [k, i] as const));
  const values = keys.map(() => 0);
  for (const it of items) {
    const at = it instanceof Date ? it : it.at;
    const v = it instanceof Date ? 1 : (it.value ?? 1);
    const i = index.get(dayKey(at));
    if (i !== undefined) values[i] = (values[i] ?? 0) + v;
  }
  return { keys, values, total: values.reduce((a, b) => a + b, 0) };
}

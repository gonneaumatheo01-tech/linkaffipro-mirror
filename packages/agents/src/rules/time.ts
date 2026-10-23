/**
 * Heure de Paris ↔ UTC (affichage et règles en Europe/Paris, stockage UTC). Fonctions pures, changement d'heure
 * compris : une heure locale est convertie avec le décalage valable à cet instant précis.
 */
const TZ = "Europe/Paris";

const FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export type ParisParts = { year: number; month: number; day: number; hour: number; minute: number };

export function parisParts(at: Date): ParisParts {
  const parts = FMT.formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** Décalage de Paris par rapport à UTC à cet instant, en minutes (60 l'hiver, 120 l'été). */
export function parisOffsetMinutes(at: Date): number {
  const p = parisParts(at);
  const sec = Number(FMT.formatToParts(at).find((x) => x.type === "second")?.value ?? 0);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, sec);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** « AAAA-MM-JJ » + minutes depuis minuit (heure de Paris) → instant UTC. */
export function fromParis(day: string, minutes: number): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d, 0, minutes);
  let guess = naive - parisOffsetMinutes(new Date(naive)) * 60_000;
  guess = naive - parisOffsetMinutes(new Date(guess)) * 60_000;
  return new Date(guess);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Jour de Paris « AAAA-MM-JJ ». */
export function parisDay(at: Date): string {
  const p = parisParts(at);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Mois de Paris « AAAA-MM » (plafonds mensuels). */
export function parisMonth(at: Date): string {
  return parisDay(at).slice(0, 7);
}

/** Minutes depuis minuit, heure de Paris. */
export function parisMinutes(at: Date): number {
  const p = parisParts(at);
  return p.hour * 60 + p.minute;
}

/** Jour de la semaine à Paris : 1 = lundi … 7 = dimanche (même convention que les meilleurs horaires). */
export function parisWeekday(at: Date): number {
  const [y, m, d] = parisDay(at).split("-").map(Number) as [number, number, number];
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
}

/** Jour suivant (« AAAA-MM-JJ »), sans dépendre du fuseau. */
export function addDaysToDay(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Minuit de Paris du jour donné. */
export function parisDayStart(day: string): Date {
  return fromParis(day, 0);
}

/** « HH:MM » → minutes (null si invalide). « 24:00 » accepté pour la fin de journée. */
export function hhmmToMinutes(v: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((v ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

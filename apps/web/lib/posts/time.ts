/** Conversions Europe/Paris ↔ UTC pour les champs datetime-local du formulaire. */
const TZ = "Europe/Paris";

function parisOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** "2026-10-09T14:30" (heure de Paris) → Date UTC. */
export function fromParisLocal(input: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(input);
  if (!m) return null;
  const naive = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  let guess = naive - parisOffsetMinutes(new Date(naive)) * 60_000;
  guess = naive - parisOffsetMinutes(new Date(guess)) * 60_000;
  return new Date(guess);
}

/** Date → "YYYY-MM-DDTHH:mm" en heure de Paris (valeur d'un champ datetime-local). */
export function toParisLocalInput(d: Date): string {
  const parts = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Début (lundi 00:00 Paris) de la semaine contenant la date. */
export function startOfParisWeek(d: Date): Date {
  const local = toParisLocalInput(d).slice(0, 10);
  const [y, m, day] = local.split("-").map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
  const monday = new Date(Date.UTC(y, m - 1, day - ((dow + 6) % 7)));
  return fromParisLocal(`${monday.toISOString().slice(0, 10)}T00:00`)!;
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

export function parisDayKey(d: Date): string {
  return toParisLocalInput(d).slice(0, 10);
}

export function parisHour(d: Date): number {
  return Number(toParisLocalInput(d).slice(11, 13));
}

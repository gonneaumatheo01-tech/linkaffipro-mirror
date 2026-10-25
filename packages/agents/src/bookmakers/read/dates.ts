/**
 * Phase 35 : heure de coup d'envoi affichée par un site → instant UTC, dans le fuseau du site (`mapping.timezone`).
 * Formes lues : horodatage (secondes ou millisecondes), ISO avec ou sans fuseau, « 26/10/2026 21:00 », « 26/10 21:00 »,
 * « 26.10. 21:00 », « 2026-10-26 21:00 », « Aujourd'hui 21:00 », « Demain 21:00 » (fr, en, es, de, it, pt), « 21:00 »
 * (aujourd'hui). Illisible : null (le match est ignoré, jamais une heure inventée). Pur.
 */

/** Décalage (minutes) du fuseau `tz` à l'instant `at` (Intl). Fuseau inconnu : UTC. */
export function tzOffsetMinutes(at: Date, tz: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  } catch {
    return 0;
  }
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** Heure murale dans `tz` → instant UTC. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off1 = tzOffsetMinutes(new Date(guess), tz);
  const t1 = guess - off1 * 60_000;
  const off2 = tzOffsetMinutes(new Date(t1), tz);
  return new Date(guess - off2 * 60_000);
}

function wallDate(at: Date, tz: string): { y: number; m: number; d: number } {
  const off = tzOffsetMinutes(at, tz);
  const w = new Date(at.getTime() + off * 60_000);
  return { y: w.getUTCFullYear(), m: w.getUTCMonth() + 1, d: w.getUTCDate() };
}

const TODAY = /\b(aujourd['’ ]?hui|auj|today|hoy|heute|oggi|hoje)\b/gi;
const TOMORROW = /\b(demain|tomorrow|manana|mañana|morgen|domani|amanha|amanhã)\b/i;

export function parseSiteDate(raw: string | null | undefined, tz: string, now: Date): Date | null {
  if (!raw) return null;
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (/^\d{10}$/.test(t)) return new Date(Number(t) * 1000);
  if (/^\d{13}$/.test(t)) return new Date(Number(t));
  // ISO avec fuseau : lu tel quel.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(t)) {
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const time = /(\d{1,2})[:h](\d{2})/.exec(t);
  const hh = time ? Number(time[1]) : null;
  const mm = time ? Number(time[2]) : null;
  if (hh === null || mm === null || hh > 23 || mm > 59) return null;
  let y: number | null = null;
  let mo: number | null = null;
  let d: number | null = null;
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(t);
  const dmy = /(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?/.exec(t.replace(time![0], " "));
  const today = wallDate(now, tz);
  if (iso) [y, mo, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (dmy) {
    d = Number(dmy[1]);
    mo = Number(dmy[2]);
    y = dmy[3] ? (dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3])) : today.y;
    // « 02/01 » vu le 30 décembre : l'an prochain.
    if (!dmy[3] && mo < today.m - 6) y = today.y + 1;
  } else if (TOMORROW.test(t)) {
    const w = wallDate(new Date(now.getTime() + 86_400_000), tz);
    [y, mo, d] = [w.y, w.m, w.d];
  } else {
    // Heure seule : aujourd'hui, mais seulement si rien d'autre n'est écrit (« Sam. 26 oct. 21:00 », « Samedi 21:00 » :
    // jour illisible → null, jamais « aujourd'hui » inventé).
    const rest = t.replace(/\d{1,2}[:h]\d{2}(:\d{2})?/i, " ").replace(TODAY, " ").replace(/[\s,.;·|–—-]+/g, "");
    if (rest) return null;
    [y, mo, d] = [today.y, today.m, today.d];
  }
  if (!y || !mo || !d || mo > 12 || d > 31) return null;
  return zonedToUtc(y, mo, d, hh, mm, tz);
}

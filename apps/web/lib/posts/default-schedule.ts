/**
 * Date proposée par défaut pour un message ou un envoi « Plus tard » (formulaires Programmer un message et Écrire à
 * un groupe, « Programmer » sur la fiche d'un envoi) : dans au moins une heure, au quart d'heure suivant, mais jamais
 * en pleine nuit. Entre 22 h et 8 h (heure de Paris), on propose 18:00 : le jour même s'il est encore à venir, sinon
 * le lendemain. Fonction pure (l'instant présent est passé en paramètre), testée.
 */
import { fromParisLocal, toParisLocalInput } from "./time";

/** Début et fin de la nuit (heure de Paris) : pas de proposition dans cette plage. */
export const QUIET_START_HOUR = 22;
export const QUIET_END_HOUR = 8;
/** Heure proposée à la place d'une heure de nuit. */
export const EVENING_HOUR = 18;

const QUARTER = 15 * 60_000;

/** Jour suivant d'une clé « AAAA-MM-JJ » (calendrier, sans fuseau). */
function nextDayKey(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export function defaultScheduleAt(now: Date = new Date()): Date {
  const soon = new Date(Math.ceil((now.getTime() + 60 * 60_000) / QUARTER) * QUARTER);
  const local = toParisLocalInput(soon);
  const hour = Number(local.slice(11, 13));
  if (hour >= QUIET_END_HOUR && hour < QUIET_START_HOUR) return soon;
  const evening = `T${String(EVENING_HOUR).padStart(2, "0")}:00`;
  const sameDay = fromParisLocal(`${local.slice(0, 10)}${evening}`);
  if (sameDay && sameDay.getTime() >= soon.getTime()) return sameDay;
  return fromParisLocal(`${nextDayKey(local.slice(0, 10))}${evening}`) ?? soon;
}

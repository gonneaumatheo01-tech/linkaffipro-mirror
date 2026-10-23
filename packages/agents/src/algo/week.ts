/** Semaine de l'équipe Algorithme : lundi de Paris (« AAAA-MM-JJ »). */
import { addDaysToDay, parisDay, parisDayStart, parisWeekday } from "../rules/time";

export function parisWeekStart(at: Date): string {
  return addDaysToDay(parisDay(at), -(parisWeekday(at) - 1));
}

/** Instant du lundi 0 h de Paris de la semaine. */
export function weekStartDate(at: Date): Date {
  return parisDayStart(parisWeekStart(at));
}

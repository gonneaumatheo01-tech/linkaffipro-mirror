/**
 * Planification des relevés de vues d'un message envoyé (fonction pure, testée) :
 * toutes les 15 minutes pendant 48 h après l'envoi, puis une fois par jour jusqu'à 30 jours, puis plus rien (null).
 * Le passage `sync-views` tourne toutes les 15 minutes : on retire une petite tolérance pour que le relevé
 * tombe bien sur le passage suivant (et non celui d'après à cause de quelques secondes de décalage).
 */
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const VIEWS_DENSE_WINDOW_MS = 48 * HOUR;
export const VIEWS_MAX_AGE_MS = 30 * DAY;
export const VIEWS_DENSE_INTERVAL_MS = 15 * MIN;
export const VIEWS_DAILY_INTERVAL_MS = DAY;
/** Tolérance retirée à chaque intervalle (passage toutes les 15 min). */
const DENSE_TOLERANCE_MS = 1 * MIN;
const DAILY_TOLERANCE_MS = 15 * MIN;

/** Prochain relevé d'un message envoyé à `sentAt`, calculé à `now` ; null = plus aucun relevé. */
export function nextViewsPoll(sentAt: Date, now: Date): Date | null {
  const age = Math.max(0, now.getTime() - sentAt.getTime());
  if (age >= VIEWS_MAX_AGE_MS) return null;
  if (age < VIEWS_DENSE_WINDOW_MS) return new Date(now.getTime() + VIEWS_DENSE_INTERVAL_MS - DENSE_TOLERANCE_MS);
  const next = now.getTime() + VIEWS_DAILY_INTERVAL_MS - DAILY_TOLERANCE_MS;
  // Un dernier relevé exactement à 30 jours plutôt qu'un relevé perdu au-delà.
  const limit = sentAt.getTime() + VIEWS_MAX_AGE_MS;
  return new Date(Math.min(next, limit));
}

/** Les messages envoyés depuis moins de 30 jours méritent encore un relevé (initialisation au premier passage). */
export function viewsInitSince(now: Date): Date {
  return new Date(now.getTime() - VIEWS_MAX_AGE_MS);
}

/** Combine plusieurs relevés (album : plusieurs messages Telegram pour un même envoi) : on garde le maximum. */
export function mergeViews(rows: ReadonlyArray<{ views: number; forwards: number }>): { views: number; forwards: number } | null {
  const valid = rows.filter((r) => r.views >= 0);
  if (valid.length === 0) return null;
  return {
    views: Math.max(...valid.map((r) => r.views)),
    forwards: Math.max(0, ...valid.map((r) => r.forwards)),
  };
}

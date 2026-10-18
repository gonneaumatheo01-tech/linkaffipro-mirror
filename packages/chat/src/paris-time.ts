// Heure de Paris pour les relances (heures calmes) : stockage UTC, calcul fiable aux changements d'heure.
// Interne au moteur (non exporté par index.ts : config.ts a ses propres fonctions pour le plafond du mois).

const PARIS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export type ParisWallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** Date et heure affichées à Paris pour cet instant. */
export function parisWallClock(d: Date): ParisWallClock {
  const out: Record<string, number> = {};
  for (const p of PARIS.formatToParts(d)) if (p.type !== "literal") out[p.type] = Number(p.value);
  return {
    year: out.year ?? 1970,
    month: out.month ?? 1,
    day: out.day ?? 1,
    hour: out.hour ?? 0,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

/** Décalage de Paris sur UTC à cet instant (ms) : +1 h l'hiver, +2 h l'été. */
function parisOffsetMs(d: Date): number {
  const p = parisWallClock(d);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/**
 * Instant UTC d'une heure de Paris (jour de calendrier de Paris, débordements de mois acceptés : jour 32 = 1er du mois
 * suivant). Deux passages pour les jours de changement d'heure.
 */
export function parisWallTimeToDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let t = wall - parisOffsetMs(new Date(wall));
  t = wall - parisOffsetMs(new Date(t));
  return new Date(t);
}

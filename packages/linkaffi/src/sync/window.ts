/** Fenêtre incrémentale d'une table : colonne de date, chevauchement, curseur. */

export const OVERLAP_MS = 15 * 60 * 1000;
export const PAGE_LIMIT = 5000;

/** Tables synchronisées, dans l'ordre, avec leur colonne de date incrémentale (null = synchro complète à chaque fois). */
export const SYNC_TABLES = [
  { table: "casinos", dateCol: null },
  { table: "campaigns", dateCol: null },
  { table: "currency_rates", dateCol: null },
  { table: "players", dateCol: "updated_at" },
  { table: "player_events", dateCol: "created_at" },
  { table: "player_financials", dateCol: "updated_at" },
  { table: "revshare_snapshots", dateCol: "updated_at" },
  { table: "deposit_snapshots", dateCol: "updated_at" },
  { table: "ftd_invalidations", dateCol: "created_at" },
  { table: "clicks", dateCol: "created_at" },
  // Agrégat journalier (part de revshare), après les offres et les joueurs ; lecture propre : voir `statsQueries`.
  { table: "stats", dateCol: "date" },
] as const;

export type SyncTable = (typeof SYNC_TABLES)[number]["table"];

export type SyncCursor = {
  /** Borne basse de la dernière fenêtre réussie (ISO) ; absente = tout l'historique. */
  since?: string;
  /** Décalage de reprise dans la fenêtre en cours (page interrompue). */
  offset?: number;
  /** Borne haute de la fenêtre en cours (ISO), figée au début d'un passage. */
  until?: string;
};

export type SyncWindow = { from: string | undefined; to: string; dateCol: string | null; offset: number };

/** Formate une date en `YYYY-MM-DD` (l'API filtre à la journée). */
export function toDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Calcule la fenêtre à lire pour un passage : depuis (dernier succès − 15 minutes) jusqu'à maintenant.
 * Une table sans colonne de date est relue entièrement. `full` ignore le curseur.
 */
export function computeWindow(dateCol: string | null, cursor: SyncCursor, now: Date, full = false): SyncWindow {
  const to = cursor.until ?? now.toISOString();
  const offset = cursor.offset ?? 0;
  if (!dateCol || full || !cursor.since) return { from: undefined, to, dateCol, offset };
  const since = new Date(new Date(cursor.since).getTime() - OVERLAP_MS);
  return { from: since.toISOString(), to, dateCol, offset };
}

/** Paramètres de requête API pour une fenêtre (filtre par jour : la précision fine est faite côté mapping). */
export function windowQuery(w: SyncWindow): { from?: string; to?: string; date_col?: string; order?: string } {
  if (!w.dateCol) return {};
  const q: { from?: string; to?: string; date_col?: string; order?: string } = { date_col: w.dateCol, order: w.dateCol };
  if (w.from) q.from = toDay(new Date(w.from));
  q.to = toDay(new Date(w.to));
  return q;
}

/** Curseur après un passage réussi : `since` = borne haute lue ; plus d'offset ni de borne figée. */
export function cursorAfterSuccess(w: SyncWindow): SyncCursor {
  return { since: w.to };
}

/** Curseur de reprise après une page réussie dans un passage non terminé. */
export function cursorAfterPage(cursor: SyncCursor, w: SyncWindow, nextOffset: number): SyncCursor {
  return { ...cursor, until: w.to, offset: nextOffset };
}

/**
 * Table `stats` : jours relus à chaque passage. Link Affi met à jour EN PLACE la ligne du jour (revshare au fil de la
 * journée) et celles des jours récents (CPA annulée corrigée sur le jour d'origine), sans colonne `updated_at`.
 */
export const STATS_RECENT_DAYS = 7;

/**
 * Relecture de nuit de la table `stats` : les 35 derniers jours par `date`, une fois par nuit, pour retrouver une
 * réécriture en place d'un jour plus ancien que `STATS_RECENT_DAYS` (même nombre de requêtes qu'un passage normal :
 * une par affilié et par colonne de date).
 */
export const STATS_DEEP_DAYS = 35;
/** Heures de Paris de la relecture de nuit : à partir de 3 h, avant 6 h. */
export const STATS_DEEP_HOURS = { from: 3, to: 6 } as const;
/** Plus court écart entre deux relectures de nuit : la durée de la plage (une seule par nuit). */
const DEEP_MIN_GAP_MS = (STATS_DEEP_HOURS.to - STATS_DEEP_HOURS.from) * 3_600_000;
const DEEP_MAX_GAP_MS = 36 * 3_600_000;

const parisDay = new Intl.DateTimeFormat("fr-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function shiftDayKey(key: string, n: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Curseur de la table `stats` : dernier succès, affiliés dont tout l'historique a déjà été lu, dernière relecture
 * profonde réussie (`deepAt`, ISO : relecture de nuit ou historique complet).
 */
export type StatsCursor = SyncCursor & { affiliates?: string[]; deepAt?: string };

const parisHour = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Paris",
  hour: "2-digit",
  hourCycle: "h23",
});

/**
 * Relecture de nuit due : entre 3 h et 6 h (Paris), si elle n'a pas déjà eu lieu cette nuit ; à toute heure si la
 * dernière date de plus de 36 h (worker arrêté la nuit).
 */
export function statsDeepDue(cursor: Pick<StatsCursor, "deepAt">, now: Date): boolean {
  const last = cursor.deepAt ? new Date(cursor.deepAt).getTime() : null;
  const gap = last === null || Number.isNaN(last) ? null : now.getTime() - last;
  if (gap !== null && gap >= DEEP_MAX_GAP_MS) return true;
  const hour = Number(parisHour.format(now));
  const night = hour >= STATS_DEEP_HOURS.from && hour < STATS_DEEP_HOURS.to;
  return night && (gap === null || gap >= DEEP_MIN_GAP_MS);
}

export type StatsQuery = {
  eq: { affiliate_id: string };
  date_col?: string;
  from?: string;
  order: string;
};

/**
 * Requêtes d'un passage sur `stats`, une série par affilié à nous (jamais les autres affiliés de Link Affi) :
 * - sans curseur, en resynchro complète, ou pour un affilié pas encore lu (offre nouvellement rattachée) : toutes ses
 *   lignes ;
 * - sinon : les `STATS_RECENT_DAYS` derniers jours par `date` (mises à jour en place ; `STATS_DEEP_DAYS` lors de la
 *   relecture de nuit, `deep`), plus les lignes créées depuis le dernier succès moins 15 minutes (`created_at` :
 *   corrections tardives datées d'un jour ancien).
 * `from` sans `to` : l'API lit alors jusqu'à aujourd'hui inclus (vérifié le 11 octobre 2026).
 */
export function statsQueries(
  affiliateIds: readonly string[],
  cursor: StatsCursor,
  now: Date,
  full: boolean,
  deep = false,
): StatsQuery[] {
  const out: StatsQuery[] = [];
  const known = new Set(cursor.affiliates ?? []);
  for (const id of [...new Set(affiliateIds)]) {
    const eq = { affiliate_id: id };
    if (full || !cursor.since || !known.has(id)) {
      out.push({ eq, order: "date" });
      continue;
    }
    const recent = shiftDayKey(parisDay.format(now), -(deep ? STATS_DEEP_DAYS : STATS_RECENT_DAYS));
    const created = toDay(new Date(new Date(cursor.since).getTime() - OVERLAP_MS));
    out.push({ eq, date_col: "date", from: recent, order: "date" });
    out.push({ eq, date_col: "created_at", from: created, order: "created_at" });
  }
  return out;
}

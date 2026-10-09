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

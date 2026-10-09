/** Règles pures de rétention (purge 24 mois). */

export const DEFAULT_RETENTION_MONTHS = 24;
export const MIN_RETENTION_MONTHS = 6;

/** Lit le réglage `retention.months` (valeur brute du Setting) avec repli et plancher. */
export function parseRetentionMonths(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_RETENTION_MONTHS;
  return Math.max(MIN_RETENTION_MONTHS, Math.floor(n));
}

/** Date seuil : tout ce qui est antérieur est purgeable. */
export function retentionCutoff(months: number, now = new Date()): Date {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

export type MemberActivity = {
  lastSeenAt: Date | null;
  lastMembershipAt: Date | null;
  lastClickAt: Date | null;
  lastOutboundAt: Date | null;
  anonymizedAt: Date | null;
};

/** Dernière activité connue d'un membre (la plus récente des dates). */
export function lastActivity(a: MemberActivity): Date | null {
  const dates = [a.lastSeenAt, a.lastMembershipAt, a.lastClickAt, a.lastOutboundAt].filter((d): d is Date => d instanceof Date);
  if (dates.length === 0) return null;
  return new Date(Math.max(...dates.map((d) => d.getTime())));
}

/** Un membre est purgeable s'il n'est pas déjà anonymisé et que sa dernière activité est antérieure au seuil. */
export function isPurgeable(a: MemberActivity, cutoff: Date): boolean {
  if (a.anonymizedAt) return false;
  const last = lastActivity(a);
  return last === null || last < cutoff;
}

/** Les événements joueurs (`player.*`) sont conservés : ils portent les statistiques financières. */
export function isEventRetained(type: string): boolean {
  return type.startsWith("player.");
}

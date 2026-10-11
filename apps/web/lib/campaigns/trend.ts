/**
 * Mini-tendances des campagnes (règles pures) : séries jour par jour sur la période, lues dans les statistiques
 * journalières (`DailyStat`, dimension `campaign:<id>`, recalculées chaque heure par le worker avec les mêmes règles
 * de rattachement). Elles ne servent qu'à dessiner la forme de la courbe : les chiffres affichés à côté viennent du
 * calcul en direct de `campaignTotals`.
 */

/** Une ligne de statistiques journalières (champs utiles aux tendances). */
export type DailyTrendRow = {
  dimension: string;
  /** Jour (`@db.Date`, minuit UTC) ou clé AAAA-MM-JJ. */
  date: Date | string;
  approved: number;
  ftds: number;
  spend: number;
  ngr: number;
  /** Nos commissions du jour (CPA nette + part de revshare). */
  commissions: number;
};

/** Séries d'une campagne, un point par jour de la période (0 les jours sans ligne). */
export type CampaignTrend = {
  /** Membres acceptés par jour. */
  members: number[];
  /** Premiers dépôts par jour. */
  ftds: number[];
  /** Dépense pub par jour (€). */
  spend: number[];
  /** Gains par jour : commissions − dépense pub (€), même règle que `computeMetrics` (gains). */
  gains: number[];
};

/** Dimension des statistiques journalières d'une de nos campagnes. */
export function campaignDimension(campaignId: string): string {
  return `campaign:${campaignId}`;
}

/** Identifiant de campagne d'une dimension `campaign:<id>` (null pour les autres, dont `campaigns` et `campaigns:<univers>`). */
export function campaignIdOfDimension(dimension: string): string | null {
  return dimension.startsWith("campaign:") ? dimension.slice("campaign:".length) || null : null;
}

function dayOf(date: Date | string): string {
  return typeof date === "string" ? date.slice(0, 10) : date.toISOString().slice(0, 10);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Série vide (que des zéros) de la longueur de la période. */
export function emptyTrend(days: number): CampaignTrend {
  const zeros = () => Array.from({ length: Math.max(0, days) }, () => 0);
  return { members: zeros(), ftds: zeros(), spend: zeros(), gains: zeros() };
}

/**
 * Regroupe les lignes journalières par campagne et par jour de la période (`dayKeys`, dans l'ordre).
 * Les jours hors période et les dimensions qui ne sont pas `campaign:<id>` sont ignorés ; deux lignes du même jour
 * s'additionnent. Chaque campagne demandée a une série complète, même sans aucune ligne.
 */
export function buildCampaignTrends(
  campaignIds: readonly string[],
  dayKeys: readonly string[],
  rows: readonly DailyTrendRow[],
): Map<string, CampaignTrend> {
  const index = new Map(dayKeys.map((k, i) => [k, i]));
  const out = new Map<string, CampaignTrend>();
  for (const id of campaignIds) out.set(id, emptyTrend(dayKeys.length));
  for (const r of rows) {
    const id = campaignIdOfDimension(r.dimension);
    const t = id ? out.get(id) : undefined;
    const i = index.get(dayOf(r.date));
    if (!t || i === undefined) continue;
    const spend = num(r.spend);
    t.members[i] = t.members[i]! + num(r.approved);
    t.ftds[i] = t.ftds[i]! + num(r.ftds);
    t.spend[i] = round2(t.spend[i]! + spend);
    t.gains[i] = round2(t.gains[i]! + num(r.commissions) - spend);
  }
  return out;
}

/** Une courbe mérite d'être dessinée : au moins deux jours et au moins une valeur non nulle. */
export function hasTrend(values: readonly number[] | undefined): values is number[] {
  return !!values && values.length >= 2 && values.some((v) => v !== 0);
}

/**
 * Phase 31 — vue « Avancement » de la page Prospection : colonnes par statut, compteurs, temps passé dans chaque
 * colonne (médiane) et délais entre les étapes (contacté → a répondu → signé). Règles pures, testées.
 */
import { daysBetween, type ProspectStatusKey } from "./display";

/** Colonnes de l'avancement, dans l'ordre du parcours. */
export const PIPELINE_COLUMNS: readonly ProspectStatusKey[] = [
  "QUALIFIED",
  "CONTACTED",
  "RESPONDED",
  "NEGOTIATING",
  "SIGNED",
  "ACTIVE",
  "CHURNED",
  "SKIPPED",
];

export type PipelineRow = {
  status: string;
  statusChangedAt: Date | null;
  discoveredAt: Date;
  contactedAt: Date | null;
  respondedAt: Date | null;
  signedAt: Date | null;
};

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const medianDays = (pairs: Array<[Date | null, Date | null]>): number | null => {
  const days = pairs.filter((p): p is [Date, Date] => Boolean(p[0] && p[1]) && p[1]!.getTime() >= p[0]!.getTime()).map(([a, b]) => (b.getTime() - a.getTime()) / 86_400_000);
  const m = median(days);
  return m === null ? null : Math.round(m * 10) / 10;
};

export type PipelineSummary = {
  counts: Record<string, number>;
  /** Jours passés dans la colonne actuelle (médiane), par statut. */
  medianDaysInStatus: Record<string, number | null>;
  /** Délais médians entre étapes, en jours. */
  contactToResponse: number | null;
  responseToSigned: number | null;
  contactToSigned: number | null;
  /** Taux : part des contactés qui ont répondu, part des contactés signés. */
  responseRate: number | null;
  signRate: number | null;
  contactedTotal: number;
};

const REACHED_RESPONSE = new Set(["RESPONDED", "NEGOTIATING", "SIGNED", "ACTIVE", "CHURNED"]);
const REACHED_SIGNED = new Set(["SIGNED", "ACTIVE", "CHURNED"]);

export function pipelineSummary(rows: readonly PipelineRow[], now: Date): PipelineSummary {
  const counts: Record<string, number> = {};
  const inStatus: Record<string, number[]> = {};
  for (const r of rows) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    const since = r.statusChangedAt ?? r.discoveredAt;
    (inStatus[r.status] ??= []).push(daysBetween(since, now));
  }
  const medianDaysInStatus: Record<string, number | null> = {};
  for (const s of Object.keys(inStatus)) medianDaysInStatus[s] = median(inStatus[s]!);
  const contacted = rows.filter((r) => r.contactedAt);
  const responded = contacted.filter((r) => r.respondedAt || REACHED_RESPONSE.has(r.status));
  const signed = contacted.filter((r) => r.signedAt || REACHED_SIGNED.has(r.status));
  return {
    counts,
    medianDaysInStatus,
    contactToResponse: medianDays(rows.map((r) => [r.contactedAt, r.respondedAt])),
    responseToSigned: medianDays(rows.map((r) => [r.respondedAt, r.signedAt])),
    contactToSigned: medianDays(rows.map((r) => [r.contactedAt, r.signedAt])),
    responseRate: contacted.length ? responded.length / contacted.length : null,
    signRate: contacted.length ? signed.length / contacted.length : null,
    contactedTotal: contacted.length,
  };
}

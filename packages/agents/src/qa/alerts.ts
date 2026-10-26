/**
 * Phase 30 — alertes internes du QA Global (prompt section 4). `checkQaAlerts` lit les dernières vérifications et rend
 * les alertes à envoyer ; il n'envoie rien lui-même (B / C les font partir par Kevin ou les écrivent au journal).
 *
 * - refus > 30 % sur la dernière heure (5 vérifications au moins) → Kevin prévient le client, une fois par heure ;
 * - latence moyenne > 20 s sur les 10 dernières vérifications → avertissement dans le journal, une fois par heure ;
 * - modèle indisponible depuis plus de 5 minutes → Kevin prévient le client, une fois par panne ;
 * - plafond mensuel atteint → Kevin prévient le client, une fois par mois.
 * Anti-doublon dans `Setting` `qa.alerts.state`. Les textes passent `voiceCheck` (test).
 */
import { parisMonth } from "../rules/time";
import { QA_LIMITS, type QaDeps, type QaVerdict } from "./contract";
import { QA_ENGINE_CODES, QA_NO_MODEL } from "./codes";
import { reasonsOf } from "./metrics";

export const QA_ALERTS_STATE_KEY = "qa.alerts.state";
/** Vérifications minimum sur l'heure pour juger le taux de refus. */
export const QA_REJECT_MIN_SAMPLE = 5;
const HOUR = 3_600_000;

export type QaAlertKey = "qa_reject_rate" | "qa_latency" | "qa_unavailable" | "qa_budget";
export type QaAlert = {
  key: QaAlertKey;
  /** `client` : Kevin l'envoie ; `log` : avertissement dans le journal seulement. */
  audience: "client" | "log";
  text: string;
  data: Record<string, number | string>;
};

/** Textes de Kevin (vérifiés par `voiceCheck`). */
export const QA_ALERT_TEXTS = {
  rejectRate: "Beaucoup de contenus ne passent pas le contrôle qualité, je vérifie ce qui se passe.",
  unavailable: "Le contrôle qualité est en pause, je reprends dès que possible.",
  budget: "Le plafond du mois du contrôle qualité est atteint : plus rien ne sort tant qu'il n'est pas relevé.",
  latency: "Contrôle qualité lent : plus de 20 s en moyenne sur les 10 dernières vérifications.",
} as const;

/** Table des variantes (contrôle de la voix). */
export const QA_ALERTS_VARIANTS: readonly string[] = [QA_ALERT_TEXTS.rejectRate, QA_ALERT_TEXTS.unavailable, QA_ALERT_TEXTS.budget];

type State = { rejectRateAt?: string; latencyAt?: string; unavailableSince?: string; budgetMonth?: string };
type Row = { verdict: QaVerdict; durationMs: number; createdAt: Date; reasons: unknown; modelUsed: string };

async function readState(deps: QaDeps): Promise<State> {
  try {
    const row = await deps.prisma.setting.findUnique({ where: { key: QA_ALERTS_STATE_KEY } });
    const v = row?.value;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as State) : {};
  } catch {
    return {};
  }
}

async function writeState(deps: QaDeps, state: State): Promise<void> {
  const value = JSON.parse(JSON.stringify(state)) as never;
  await deps.prisma.setting.upsert({ where: { key: QA_ALERTS_STATE_KEY }, create: { key: QA_ALERTS_STATE_KEY, value }, update: { value } });
}

const has = (r: Row, code: string) => reasonsOf(r.reasons).some((x) => x.code === code);
const isUnavailable = (r: Row) => r.verdict === "TIMEOUT" || (r.verdict === "ERROR" && has(r, QA_ENGINE_CODES.unavailable));
const older = (iso: string | undefined, now: Date, ms: number) => !iso || now.getTime() - new Date(iso).getTime() >= ms;

/** Alertes à envoyer maintenant (et mémorise l'envoi pour ne pas les répéter). */
export async function checkQaAlerts(deps: QaDeps, now: Date = deps.now ? deps.now() : new Date()): Promise<QaAlert[]> {
  const state = await readState(deps);
  const next: State = { ...state };
  const alerts: QaAlert[] = [];
  const select = { verdict: true, durationMs: true, createdAt: true, reasons: true, modelUsed: true } as const;

  // 1. Taux de refus sur la dernière heure.
  const hour = (await deps.prisma.qaCheck.findMany({ where: { createdAt: { gte: new Date(now.getTime() - HOUR), lte: now } }, select })) as Row[];
  const rejected = hour.filter((r) => r.verdict === "REJECTED").length;
  if (hour.length >= QA_REJECT_MIN_SAMPLE && rejected / hour.length > QA_LIMITS.rejectRateAlert && older(state.rejectRateAt, now, HOUR)) {
    alerts.push({ key: "qa_reject_rate", audience: "client", text: QA_ALERT_TEXTS.rejectRate, data: { rejected, total: hour.length, rate: Math.round((rejected / hour.length) * 100) } });
    next.rejectRateAt = now.toISOString();
  }

  // 2. Latence des 10 dernières vérifications où le modèle a été appelé.
  const recent = (await deps.prisma.qaCheck.findMany({
    where: { createdAt: { lte: now }, verdict: { in: ["APPROVED", "REJECTED", "TIMEOUT"] }, modelUsed: { not: QA_NO_MODEL } },
    orderBy: { createdAt: "desc" },
    take: QA_LIMITS.latencyWindow,
    select,
  })) as Row[];
  if (recent.length >= QA_LIMITS.latencyWindow) {
    const avg = Math.round(recent.reduce((s, r) => s + r.durationMs, 0) / recent.length);
    if (avg > QA_LIMITS.latencyWarnMs && older(state.latencyAt, now, HOUR)) {
      alerts.push({ key: "qa_latency", audience: "log", text: QA_ALERT_TEXTS.latency, data: { avgMs: avg, window: recent.length } });
      next.latencyAt = now.toISOString();
    }
  }

  // 3. Modèle indisponible depuis plus de 5 minutes (série d'échecs depuis la dernière réponse).
  const last = (await deps.prisma.qaCheck.findMany({
    where: { createdAt: { lte: now } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select,
  })) as Row[];
  const streak: Row[] = [];
  for (const r of last) {
    if (r.verdict === "ERROR" && (has(r, QA_ENGINE_CODES.disabled) || has(r, QA_ENGINE_CODES.budget))) continue;
    if (!isUnavailable(r)) break;
    streak.push(r);
  }
  if (streak.length && now.getTime() - streak[0]!.createdAt.getTime() <= HOUR) {
    const since = streak[streak.length - 1]!.createdAt;
    // Même panne : au-delà de 50 vérifications, le début apparent de la série avance à chaque passage ; la panne déjà
    // annoncée n'est finie que si le modèle a répondu entre-temps (une fois par panne, jamais toutes les 5 minutes).
    const known = state.unavailableSince ? new Date(state.unavailableSince) : null;
    const sameOutage =
      !!known &&
      known.getTime() <= since.getTime() &&
      (await deps.prisma.qaCheck.count({ where: { createdAt: { gt: known, lte: now }, verdict: { in: ["APPROVED", "REJECTED"] }, modelUsed: { not: QA_NO_MODEL } } })) === 0;
    if (now.getTime() - since.getTime() > QA_LIMITS.unavailableAlertMs && !sameOutage) {
      alerts.push({ key: "qa_unavailable", audience: "client", text: QA_ALERT_TEXTS.unavailable, data: { since: since.toISOString(), blocked: streak.length } });
      next.unavailableSince = since.toISOString();
    }
  }

  // 4. Plafond mensuel atteint (une fois par mois).
  const month = parisMonth(now);
  const budgetHit = last.find((r) => r.verdict === "ERROR" && has(r, QA_ENGINE_CODES.budget) && now.getTime() - r.createdAt.getTime() <= HOUR);
  if (budgetHit && state.budgetMonth !== month) {
    alerts.push({ key: "qa_budget", audience: "client", text: QA_ALERT_TEXTS.budget, data: { month } });
    next.budgetMonth = month;
  }

  if (alerts.length) await writeState(deps, next);
  return alerts;
}

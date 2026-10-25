/**
 * Lecture et écriture d'un ordre (`TeamOrder`) pour le Grand Chef (phase 33, chantier A) : ligne → `OrderRow`, plan
 * validé (`interpretation`), progression (`progress`, fusionnée : les clés des autres chantiers sont gardées).
 */
import type { AgentsDeps } from "../types";
import type { OrderKind, OrderPlan, OrderRow, OrderStep } from "./contract";

export type StepState = { ok: boolean; message: string; at: string; missionIds?: string[]; postIds?: string[] };

/** Progression d'un ordre. Les clés propres au Grand Chef sont listées ; les autres (rapports de Kevin) sont gardées. */
export type OrderProgress = {
  missionsPlanned?: number;
  missionsCreated?: number;
  missionsDone?: number;
  missionsFailed?: number;
  missionsInProgress?: number;
  waitingValidation?: number;
  perDay?: Array<{ day: string; done: number; failed: number; inProgress?: number; postIds: string[] }>;
  /** Étapes calculées au premier lancement (reprise à l'identique). */
  plannedSteps?: OrderStep[];
  /** État de chaque étape (idempotence par `(orderId, stepKey)`). */
  steps?: Record<string, StepState>;
  startedNotified?: boolean;
  daysNotified?: string[];
  failuresNotified?: number;
  blockedNotified?: string | null;
  blockedReason?: string | null;
  finishedAt?: string | null;
  [k: string]: unknown;
};

export type TeamOrderDbRow = {
  id: string;
  number: number;
  teamKey: string;
  kind: string;
  status: string;
  interpretation: unknown;
  startsAt: Date | null;
  endsAt: Date | null;
  chatId: string | null;
  createdById: string | null;
  progress: unknown;
  recap?: string;
  requestText?: string;
};

export function toOrderRow(r: TeamOrderDbRow): OrderRow {
  return {
    id: r.id,
    number: r.number,
    teamKey: r.teamKey,
    kind: r.kind as OrderKind,
    status: r.status,
    interpretation: r.interpretation,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    chatId: r.chatId,
    createdById: r.createdById,
    progress: r.progress,
  };
}

export async function loadOrder(deps: Pick<AgentsDeps, "prisma">, orderId: string): Promise<TeamOrderDbRow | null> {
  return (await deps.prisma.teamOrder.findUnique({ where: { id: orderId } })) as TeamOrderDbRow | null;
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function progressOf(v: unknown): OrderProgress {
  return { ...record(v) } as OrderProgress;
}

/** Plan validé d'un ordre (lecture tolérante) ; null si illisible. */
export function parseOrderPlan(v: unknown): OrderPlan | null {
  const o = record(v);
  if (typeof o.teamKey !== "string" || !Array.isArray(o.steps)) return null;
  const steps = (o.steps as unknown[])
    .map(record)
    .filter((s) => typeof s.capability === "string")
    .map((s) => ({ capability: s.capability as string, teamKey: (typeof s.teamKey === "string" ? s.teamKey : o.teamKey) as OrderPlan["teamKey"], params: record(s.params) }));
  const scope = record(o.scope);
  return {
    teamKey: o.teamKey as OrderPlan["teamKey"],
    asIfTeamKey: typeof o.asIfTeamKey === "string" ? (o.asIfTeamKey as OrderPlan["asIfTeamKey"]) : null,
    scope: Array.isArray(scope.channelIds) ? { channelIds: scope.channelIds as string[] } : scope.test === true ? { test: true } : { teamWide: true },
    kind: (typeof o.kind === "string" ? o.kind : "PROGRAM") as OrderKind,
    period: record(o.period).start ? { start: String(record(o.period).start), days: Number(record(o.period).days ?? 1) } : null,
    perDay: typeof o.perDay === "number" ? o.perDay : null,
    theme: typeof o.theme === "string" ? o.theme : null,
    categoryId: typeof o.categoryId === "string" ? o.categoryId : null,
    format: typeof o.format === "string" ? o.format : null,
    mode: o.mode === "real" ? "real" : "simulation",
    steps,
    resolved: record(o.resolved) as OrderPlan["resolved"],
    questions: Array.isArray(o.questions) ? (o.questions as string[]) : [],
    impossible: Array.isArray(o.impossible) ? (o.impossible as OrderPlan["impossible"]) : [],
  };
}

const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Fusionne une partie de la progression (relue juste avant : jamais d'écrasement des clés des autres chantiers). */
export async function patchProgress(deps: Pick<AgentsDeps, "prisma">, orderId: string, patch: Partial<OrderProgress>, data: Record<string, unknown> = {}): Promise<OrderProgress> {
  const row = await loadOrder(deps, orderId);
  const next = { ...progressOf(row?.progress), ...patch };
  await deps.prisma.teamOrder.update({ where: { id: orderId }, data: { ...data, progress: json(next) as never } });
  return next;
}

export const TERMINAL_ORDER_STATUSES = ["DONE", "CANCELLED", "FAILED"] as const;
export const LIVE_ORDER_STATUSES = ["RUNNING", "BLOCKED"] as const;

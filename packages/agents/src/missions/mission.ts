/** Lecture d'une ligne `AgentMission` en `Mission` (étapes et charge utile validées). */
import { isAgentKey, isTeamKey, type Mission, type MissionPayload, type MissionStep } from "../types";

export const TERMINAL_STATUSES = ["DONE", "FAILED", "CANCELLED", "BLOCKED_BUDGET"] as const;
export const ACTIVE_STATUSES = ["PENDING", "RUNNING", "WAITING_VALIDATION", "WAITING_HUMAN"] as const;

export function parseSteps(v: unknown): MissionStep[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && isAgentKey((s as { agent?: unknown }).agent))
    .map((s) => ({ ...(s as MissionStep) }));
}

export function parsePayload(v: unknown): MissionPayload {
  return v && typeof v === "object" && !Array.isArray(v) ? { ...(v as MissionPayload) } : {};
}

export type MissionRow = {
  id: string;
  teamKey: string;
  kind: string;
  channelId: string | null;
  status: string;
  currentStep: number;
  steps: unknown;
  payload: unknown;
  costCents: number;
  postId: string | null;
  scheduledFor: Date | null;
  isTest: boolean;
  attempts: number;
};

export function toMission(row: MissionRow): Mission {
  if (!isTeamKey(row.teamKey)) throw new Error(`Équipe inconnue : ${row.teamKey}`);
  return {
    id: row.id,
    teamKey: row.teamKey,
    kind: row.kind as Mission["kind"],
    channelId: row.channelId,
    status: row.status as Mission["status"],
    currentStep: row.currentStep,
    steps: parseSteps(row.steps),
    payload: parsePayload(row.payload),
    costCents: row.costCents,
    postId: row.postId,
    scheduledFor: row.scheduledFor,
    isTest: row.isTest,
    attempts: row.attempts,
  };
}

/** Valeur JSON sûre pour Prisma (retire `undefined`, dates en ISO). */
export function json<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

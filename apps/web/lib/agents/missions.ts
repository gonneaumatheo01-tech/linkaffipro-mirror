/**
 * Missions et passages des agents à l'écran (pur, testé dans missions.test.ts) : relecture des étapes
 * (`AgentMission.steps`), filtres des listes, missions bloquées (État du système), libellés.
 */
import type { Prisma } from "@linkaffipro/db";
import { parisDayKey } from "@linkaffipro/core";
import type { AgentKey, StepStatus } from "@linkaffipro/agents";
import { parisMidnightUtc, shiftDay } from "@/lib/periods";

export const MISSION_STATUSES = [
  "PENDING",
  "RUNNING",
  "WAITING_VALIDATION",
  "WAITING_HUMAN",
  "DONE",
  "FAILED",
  "CANCELLED",
  "BLOCKED_BUDGET",
] as const;
export type MissionStatusValue = (typeof MISSION_STATUSES)[number];

export const MISSION_KIND_LABELS: Record<string, string> = {
  POST: "Post",
  BET: "Pari",
  REPORT: "Rapport",
  ANALYSIS: "Analyse",
};

export const CREATED_BY_LABELS: Record<string, string> = {
  GRAND_CHEF: "Grand Chef",
  HUMAN: "Équipe",
};

export type StepView = {
  agent: AgentKey | string;
  status: StepStatus;
  startedAt: Date | null;
  endedAt: Date | null;
  summary: string | null;
  costCents: number;
  error: string | null;
};

const STEP_STATUSES: readonly StepStatus[] = ["PENDING", "RUNNING", "DONE", "FAILED", "SKIPPED"];

function date(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Étapes d'une mission ; une étape abîmée est ignorée plutôt que de casser la page. */
export function parseSteps(v: unknown): StepView[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((s): StepView[] => {
    if (!s || typeof s !== "object") return [];
    const o = s as Record<string, unknown>;
    if (typeof o.agent !== "string") return [];
    const status = STEP_STATUSES.includes(o.status as StepStatus) ? (o.status as StepStatus) : "PENDING";
    return [
      {
        agent: o.agent,
        status,
        startedAt: date(o.startedAt),
        endedAt: date(o.endedAt),
        summary: typeof o.summary === "string" ? o.summary : null,
        costCents: typeof o.costCents === "number" && Number.isFinite(o.costCents) ? o.costCents : 0,
        error: typeof o.error === "string" ? o.error : null,
      },
    ];
  });
}

export const STEP_STATUS_LABELS: Record<StepStatus, string> = {
  PENDING: "À venir",
  RUNNING: "En cours",
  DONE: "Fait",
  FAILED: "En échec",
  SKIPPED: "Passée",
};

export const STEP_STATUS_TONES: Record<StepStatus, "neutral" | "info" | "success" | "danger" | "muted"> = {
  PENDING: "neutral",
  RUNNING: "info",
  DONE: "success",
  FAILED: "danger",
  SKIPPED: "muted",
};

/** Résumé court de la charge utile (jamais le texte complet : il est dans l'aperçu de validation). */
export function payloadSummary(v: unknown): { format: string | null; slot: Date | null; simulation: boolean; reasons: string[] } {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const format =
    o.format === "video" ? "Vidéo" : o.format === "photo" ? "Photo" : o.format === "text" ? "Texte" : null;
  return {
    format,
    slot: date(o.slot),
    simulation: o.simulation !== false,
    reasons: Array.isArray(o.reasons) ? o.reasons.filter((r): r is string => typeof r === "string") : [],
  };
}

/** Période des listes de missions. */
export const MISSION_RANGES = [
  { value: "today", label: "Aujourd'hui" },
  { value: "7d", label: "7 derniers jours" },
  { value: "30d", label: "30 derniers jours" },
  { value: "all", label: "Tout" },
] as const;
export type MissionRange = (typeof MISSION_RANGES)[number]["value"];

export type MissionFilters = { status: MissionStatusValue | ""; range: MissionRange; channelId: string };

function first(v: unknown): string {
  return typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : "";
}

export function parseMissionFilters(sp: Record<string, unknown>, defaultRange: MissionRange = "7d"): MissionFilters {
  const status = first(sp.status);
  const range = first(sp.range);
  return {
    status: (MISSION_STATUSES as readonly string[]).includes(status) ? (status as MissionStatusValue) : "",
    range: MISSION_RANGES.some((r) => r.value === range) ? (range as MissionRange) : defaultRange,
    channelId: first(sp.channel).trim(),
  };
}

/** Début (UTC) de la période, en jours de Paris ; `null` pour « Tout ». */
export function rangeStart(range: MissionRange, now: Date): Date | null {
  const today = parisDayKey(now);
  if (range === "today") return parisMidnightUtc(today);
  if (range === "7d") return parisMidnightUtc(shiftDay(today, -6));
  if (range === "30d") return parisMidnightUtc(shiftDay(today, -29));
  return null;
}

export function missionsWhere(
  f: MissionFilters,
  now: Date,
  teamKey?: string | null,
): Prisma.AgentMissionWhereInput {
  const since = rangeStart(f.range, now);
  return {
    ...(teamKey ? { teamKey } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.channelId ? { channelId: f.channelId } : {}),
    ...(since ? { createdAt: { gte: since } } : {}),
  };
}

/** Une mission RUNNING sans activité depuis 15 min est reprise par le Grand Chef ; au-delà, elle est à voir. */
export const STUCK_RUNNING_MS = 15 * 60 * 1000;
export const STUCK_WAITING_MS = 24 * 3600 * 1000;

/** Missions bloquées (carte « Agents » d'État du système). */
export function stuckMissionsWhere(now: Date): Prisma.AgentMissionWhereInput {
  return {
    OR: [
      { status: "RUNNING", lastActivityAt: { lt: new Date(now.getTime() - STUCK_RUNNING_MS) } },
      { status: "BLOCKED_BUDGET" },
      {
        status: { in: ["WAITING_VALIDATION", "WAITING_HUMAN"] },
        lastActivityAt: { lt: new Date(now.getTime() - STUCK_WAITING_MS) },
      },
    ],
  };
}

/** Pourquoi une mission est bloquée, en une phrase ; `null` si elle ne l'est pas. */
export function stuckReason(
  m: { status: string; lastActivityAt: Date; lastError?: string | null },
  now: Date,
): string | null {
  const idle = now.getTime() - m.lastActivityAt.getTime();
  if (m.status === "RUNNING" && idle > STUCK_RUNNING_MS)
    return `En cours sans activité depuis ${Math.round(idle / 60000)} min`;
  if (m.status === "BLOCKED_BUDGET")
    return m.lastError ? `Plafond du mois atteint : ${m.lastError}` : "Plafond du mois atteint";
  if (m.status === "WAITING_VALIDATION" && idle > STUCK_WAITING_MS)
    return "Attend une validation depuis plus de 24 h";
  if (m.status === "WAITING_HUMAN" && idle > STUCK_WAITING_MS)
    return "Attend une réponse de votre part depuis plus de 24 h";
  return null;
}

/** Rapport quotidien (`Event` `agents.report.daily`, détail `{ day, lines }`). */
export type DailyReport = { id: string; day: string; lines: string[]; at: Date };

export function parseDailyReport(e: { id: string; occurredAt: Date; payload: unknown }): DailyReport {
  const o = e.payload && typeof e.payload === "object" ? (e.payload as Record<string, unknown>) : {};
  return {
    id: e.id,
    day: typeof o.day === "string" ? o.day : parisDayKey(e.occurredAt),
    lines: Array.isArray(o.lines) ? o.lines.filter((l): l is string => typeof l === "string") : [],
    at: e.occurredAt,
  };
}

/** Mois en cours (Europe/Paris) au format de `AgentUsage.month` (« 2026-10 »). */
export function currentMonth(now: Date): string {
  return parisDayKey(now).slice(0, 7);
}

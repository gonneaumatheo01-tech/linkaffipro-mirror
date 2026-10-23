/**
 * Carte « Agents » de Réglages → État du système : files des agents, dernier passage du Grand Chef (`Event`
 * `agents.cycle`), missions bloquées. Chaque bloc tolère une panne (message plutôt qu'erreur de page).
 */
import { prisma } from "@linkaffipro/db";
import { getQueue, type QueueName } from "@linkaffipro/queue";
import { stuckMissionsWhere, stuckReason } from "./missions";

/** Files des agents (ajoutées à `QUEUE_NAMES` par le moteur) : une pour le Grand Chef, une par équipe, une pour Ads. */
export const AGENT_QUEUE_NAMES = [
  "agents-orchestrator",
  "agents-dating",
  "agents-casino",
  "agents-sports",
  "agents-algo",
  "agents-ads",
] as const;

export const AGENT_QUEUE_LABELS: Record<(typeof AGENT_QUEUE_NAMES)[number], string> = {
  "agents-orchestrator": "Grand Chef",
  "agents-dating": "Équipe Rencontres",
  "agents-casino": "Équipe Casino",
  "agents-sports": "Équipe Paris sportifs",
  "agents-algo": "Équipe Algorithme",
  "agents-ads": "Agent Ads",
};

export type AgentQueueCounts = {
  name: (typeof AGENT_QUEUE_NAMES)[number];
  label: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
};

export type StuckMission = {
  id: string;
  teamKey: string;
  status: string;
  channelTitle: string | null;
  reason: string;
};

export type AgentsSystemStatus = {
  queues: AgentQueueCounts[] | null;
  queuesError: string | null;
  lastCycleAt: Date | null;
  stuck: StuckMission[];
  stuckTotal: number;
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`pas de réponse en ${ms / 1000} s`)), ms)),
  ]);
}

/** Le Grand Chef passe toutes les 30 minutes : au-delà d'une heure sans passage, la carte le signale. */
export const CYCLE_LATE_MS = 60 * 60 * 1000;

export function cycleLate(lastCycleAt: Date | null, now: Date): boolean {
  return !lastCycleAt || now.getTime() - lastCycleAt.getTime() > CYCLE_LATE_MS;
}

export async function loadAgentsSystemStatus(now = new Date()): Promise<AgentsSystemStatus> {
  const queues = withTimeout(
    Promise.all(
      AGENT_QUEUE_NAMES.map(async (name) => {
        // Nom de file passé tel quel : la carte marche avant comme après l'ajout des files à `QUEUE_NAMES`.
        const c = await getQueue(name as unknown as QueueName).getJobCounts("waiting", "active", "delayed", "failed");
        return {
          name,
          label: AGENT_QUEUE_LABELS[name],
          waiting: c.waiting ?? 0,
          active: c.active ?? 0,
          delayed: c.delayed ?? 0,
          failed: c.failed ?? 0,
        };
      }),
    ),
    5000,
  )
    .then((q) => ({ queues: q, queuesError: null }))
    .catch((e: Error) => ({ queues: null, queuesError: e.message }));
  const where = stuckMissionsWhere(now);
  const [q, lastCycle, stuckRows, stuckTotal] = await Promise.all([
    queues,
    prisma.event.findFirst({
      where: { type: "agents.cycle" },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true },
    }),
    prisma.agentMission.findMany({
      where,
      orderBy: { lastActivityAt: "asc" },
      take: 10,
      select: {
        id: true,
        teamKey: true,
        status: true,
        lastActivityAt: true,
        lastError: true,
        channel: { select: { title: true } },
      },
    }),
    prisma.agentMission.count({ where }),
  ]);
  return {
    ...q,
    lastCycleAt: lastCycle?.occurredAt ?? null,
    stuck: stuckRows.map((m) => ({
      id: m.id,
      teamKey: m.teamKey,
      status: m.status,
      channelTitle: m.channel?.title ?? null,
      reason: stuckReason(m, now) ?? "Bloquée",
    })),
    stuckTotal,
  };
}

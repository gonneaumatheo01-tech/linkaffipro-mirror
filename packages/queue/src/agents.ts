/**
 * Mise en file des agents (CONTRAT, propriétaire : chantier A). Implémentation BullMQ de `AgentsEnqueue`
 * (`@linkaffipro/agents`) pour le site et le bot ; le worker utilise la même.
 * Dans une file d'équipe, le nom de la tâche = clé de l'agent, `jobId` = `<missionId>:<index>` (idempotent).
 * Une tâche du même identifiant déjà terminée ou échouée est retirée puis remise (reprise d'une mission par le balayage
 * `resume`) ; une tâche encore en attente ou en cours n'est jamais doublée.
 */
import type { Queue } from "bullmq";
import { getQueue, safeJobId } from "./client";
import type { AgentTeamQueue, QueueName } from "./jobs";

type TeamKey = "dating" | "casino" | "sports" | "algo";

export type AgentsEnqueueImpl = {
  orchestrator(job: { type: string; [k: string]: unknown }, opts?: { jobId?: string; delayMs?: number }): Promise<void>;
  step(
    teamKey: TeamKey,
    agent: string,
    job: { type: "step"; missionId: string; index: number; poll?: number },
    opts?: { delayMs?: number },
  ): Promise<void>;
};

export const TEAM_QUEUE_NAMES: Record<TeamKey, AgentTeamQueue> = {
  dating: "agents-dating",
  casino: "agents-casino",
  sports: "agents-sports",
  algo: "agents-algo",
};

/** Identifiant de tâche d'une étape (« : » remplacé, BullMQ l'interdit). */
export function agentStepJobId(missionId: string, index: number, poll?: number): string {
  return safeJobId(poll ? `${missionId}:${index}:p${poll}` : `${missionId}:${index}`)!;
}

type MinimalJob = { getState(): Promise<string>; remove(): Promise<void> };
export type AgentsQueueLike = {
  add(name: string, data: unknown, opts: Record<string, unknown>): Promise<unknown>;
  getJob(id: string): Promise<MinimalJob | undefined | null>;
};

/** Ajoute sans doubler : tâche terminée ou échouée → retirée puis remise ; en attente ou en cours → rien. */
export async function addIdempotent(q: AgentsQueueLike, name: string, data: unknown, jobId: string, delayMs?: number): Promise<boolean> {
  const existing = await q.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state !== "completed" && state !== "failed" && state !== "unknown") return false;
    await existing.remove().catch(() => undefined);
  }
  await q.add(name, data, { jobId, ...(delayMs ? { delay: delayMs } : {}) });
  return true;
}

export function createAgentsEnqueue(
  queueOf: (name: QueueName) => AgentsQueueLike = (name) => getQueue(name) as unknown as Queue as unknown as AgentsQueueLike,
): AgentsEnqueueImpl {
  return {
    async orchestrator(job, opts = {}) {
      const q = queueOf("agents-orchestrator");
      const name = `agents-orchestrator:${job.type}`;
      if (opts.jobId) await addIdempotent(q, name, job, safeJobId(opts.jobId)!, opts.delayMs);
      else await q.add(name, job, opts.delayMs ? { delay: opts.delayMs } : {});
    },
    async step(teamKey, agent, job, opts = {}) {
      await addIdempotent(queueOf(TEAM_QUEUE_NAMES[teamKey]), agent, job, agentStepJobId(job.missionId, job.index, job.poll), opts.delayMs);
    },
  };
}

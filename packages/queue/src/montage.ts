/**
 * Mise en file de l'équipe Montage (phase 28) : `MontageRuntime.enqueue` de `@linkaffipro/agents` pour le worker, le
 * site et le bot. Identifiant de tâche stable fourni par la chaîne (`montageTaskId`) : une tâche encore en attente ou
 * en cours n'est jamais doublée ; une tâche finie du même identifiant est retirée puis remise (reprise).
 */
import type { Queue } from "bullmq";
import { addIdempotent, type AgentsQueueLike } from "./agents";
import { getQueue, safeJobId } from "./client";
import type { AgentsMontageJob } from "./jobs";

export type MontageEnqueue = (job: AgentsMontageJob, opts?: { jobId?: string; delayMs?: number }) => Promise<void>;

export function createMontageEnqueue(
  queue: () => AgentsQueueLike = () => getQueue("agents-montage") as unknown as Queue as unknown as AgentsQueueLike,
): MontageEnqueue {
  return async (job, opts = {}) => {
    const q = queue();
    const name = `agents-montage:${job.type}`;
    if (opts.jobId) await addIdempotent(q, name, job, safeJobId(opts.jobId)!, opts.delayMs);
    else await q.add(name, job, opts.delayMs ? { delay: opts.delayMs } : {});
  };
}

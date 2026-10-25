/**
 * Mise en file de l'équipe Analystes (phase 29) : `AnalystsEnqueue` de `@linkaffipro/agents` pour le worker, le site
 * et le bot (questions de Kevin traitées en différé, sources dues, entrées à vérifier). Identifiant de tâche stable
 * fourni par l'appelant (`analysts.scrape` par source, `analysts.compliance_check` par entrée) : une tâche encore en
 * attente ou en cours n'est jamais doublée ; une tâche finie du même identifiant est retirée puis remise.
 */
import type { Queue } from "bullmq";
import { addIdempotent, type AgentsQueueLike } from "./agents";
import { getQueue, safeJobId } from "./client";
import type { AgentsAnalystesJob } from "./jobs";

export type AnalystsEnqueueFn = (job: AgentsAnalystesJob, opts?: { jobId?: string; delayMs?: number }) => Promise<void>;

export function createAnalystsEnqueue(
  queue: () => AgentsQueueLike = () => getQueue("agents-analystes") as unknown as Queue as unknown as AgentsQueueLike,
): AnalystsEnqueueFn {
  return async (job, opts = {}) => {
    const q = queue();
    const name = `agents-analystes:${job.type}`;
    if (opts.jobId) await addIdempotent(q, name, job, safeJobId(opts.jobId)!, opts.delayMs);
    else await q.add(name, job, opts.delayMs ? { delay: opts.delayMs } : {});
  };
}

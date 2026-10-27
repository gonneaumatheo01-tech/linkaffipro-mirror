/**
 * Mise en file de l'équipe Prospection (phase 31) : `ProspectionEnqueue` de `@linkaffipro/agents` pour le worker, le
 * site et le bot (lots de découverte, enrichissement d'un canal, score, dossier, Top du jour). Identifiant de tâche
 * stable fourni par l'appelant (`prospection.enrich:<id>`, `prospection.daily-top:<jour>`) : une tâche encore en
 * attente ou en cours n'est jamais doublée ; une tâche finie du même identifiant est retirée puis remise (la base fait
 * foi : un passage déjà fait ce jour-là est arrêté par ses repères `Setting`). `priority` : 1 = la plus urgente
 * (canal ajouté à la main par le client).
 */
import type { Queue } from "bullmq";
import { addIdempotent, type AgentsQueueLike } from "./agents";
import { getQueue, safeJobId } from "./client";
import type { AgentsProspectionJob } from "./jobs";

export type ProspectionEnqueueFn = (job: AgentsProspectionJob, opts?: { jobId?: string; delayMs?: number; priority?: number }) => Promise<void>;

export function createProspectionEnqueue(
  queue: () => AgentsQueueLike = () => getQueue("agents-prospection") as unknown as Queue as unknown as AgentsQueueLike,
): ProspectionEnqueueFn {
  return async (job, opts = {}) => {
    const q = queue();
    const name = `agents-prospection:${job.type}`;
    const extra = opts.priority ? { priority: opts.priority } : {};
    if (opts.jobId) await addIdempotent(q, name, job, safeJobId(opts.jobId)!, opts.delayMs, extra);
    else await q.add(name, job, { ...(opts.delayMs ? { delay: opts.delayMs } : {}), ...extra });
  };
}

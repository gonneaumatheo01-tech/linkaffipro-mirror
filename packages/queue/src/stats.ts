/**
 * Statistiques des files BullMQ pour la page Réglages → État du système : compteurs, dernières tâches
 * échouées, relance d'une tâche et purge des échecs anciens. Les files sont injectables pour les tests.
 */
import type { Queue } from "bullmq";
import { getQueue } from "./client";
import { QUEUE_NAMES, type QueueName } from "./jobs";

export type QueueCounts = { name: QueueName; waiting: number; active: number; delayed: number; failed: number; completed: number; paused: number };

export type FailedJobSummary = {
  queue: QueueName;
  id: string;
  /** Nom BullMQ (`file:type`). */
  name: string;
  failedReason: string;
  attemptsMade: number;
  /** Création de la tâche. */
  timestamp: Date;
  /** Dernier échec. */
  failedAt: Date | null;
  data: unknown;
};

/** Sous-ensemble de l'API `Queue` utilisé ici (facile à simuler). */
export type QueueLike = {
  getJobCounts: (...types: Array<"waiting" | "active" | "delayed" | "failed" | "completed" | "paused">) => Promise<Record<string, number>>;
  getFailed: (start?: number, end?: number) => Promise<JobLike[]>;
  getJob: (id: string) => Promise<JobLike | undefined>;
  clean: (grace: number, limit: number, type: "failed") => Promise<string[]>;
};
export type JobLike = {
  id?: string;
  name: string;
  data: unknown;
  failedReason?: string;
  attemptsMade: number;
  timestamp: number;
  finishedOn?: number;
  retry: (state?: "completed" | "failed") => Promise<void>;
  getState?: () => Promise<string>;
};

export type StatsDeps = { getQueue: (name: QueueName) => QueueLike };
const defaultDeps: StatsDeps = { getQueue: (name) => getQueue(name) as unknown as Queue as unknown as QueueLike };

/** Compteurs de chaque file connue (une file injoignable renvoie des zéros plutôt que de bloquer la page). */
export async function queueCounts(deps: StatsDeps = defaultDeps): Promise<QueueCounts[]> {
  return Promise.all(
    QUEUE_NAMES.map(async (name) => {
      const c = await deps.getQueue(name).getJobCounts("waiting", "active", "delayed", "failed", "completed", "paused");
      return { name, waiting: c.waiting ?? 0, active: c.active ?? 0, delayed: c.delayed ?? 0, failed: c.failed ?? 0, completed: c.completed ?? 0, paused: c.paused ?? 0 };
    }),
  );
}

export function summarizeJob(queue: QueueName, job: JobLike): FailedJobSummary {
  return {
    queue,
    id: String(job.id ?? "?"),
    name: job.name,
    failedReason: job.failedReason ?? "",
    attemptsMade: job.attemptsMade,
    timestamp: new Date(job.timestamp),
    failedAt: job.finishedOn ? new Date(job.finishedOn) : null,
    data: job.data,
  };
}

/** Les N dernières tâches échouées, toutes files confondues, de la plus récente à la plus ancienne. */
export async function recentFailedJobs(limit = 20, deps: StatsDeps = defaultDeps): Promise<FailedJobSummary[]> {
  const perQueue = await Promise.all(QUEUE_NAMES.map(async (name) => (await deps.getQueue(name).getFailed(0, limit - 1)).map((j) => summarizeJob(name, j))));
  return perQueue
    .flat()
    .sort((a, b) => (b.failedAt?.getTime() ?? b.timestamp.getTime()) - (a.failedAt?.getTime() ?? a.timestamp.getTime()))
    .slice(0, limit);
}

/** Remet une tâche échouée en attente. */
export async function retryFailedJob(queue: QueueName, jobId: string, deps: StatsDeps = defaultDeps): Promise<{ ok: true } | { ok: false; error: string }> {
  const job = await deps.getQueue(queue).getJob(jobId);
  if (!job) return { ok: false, error: "Tâche introuvable (déjà purgée ?)." };
  const state = job.getState ? await job.getState() : "failed";
  if (state !== "failed") return { ok: false, error: `La tâche n'est pas en échec (état : ${state}).` };
  await job.retry("failed");
  return { ok: true };
}

/** Supprime les tâches échouées plus anciennes que `ms` ; renvoie le nombre supprimé. */
export async function cleanFailedOlderThan(queue: QueueName, ms: number, deps: StatsDeps = defaultDeps, limit = 1000): Promise<number> {
  const ids = await deps.getQueue(queue).clean(ms, limit, "failed");
  return ids.length;
}

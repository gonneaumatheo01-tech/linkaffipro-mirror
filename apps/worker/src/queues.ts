import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { JOB_RETRY_OPTIONS, QUEUE_NAMES, QUEUE_PREFIX, recordJobFailure, type QueueName } from "@linkaffipro/queue";
import { logger } from "./logger";
import { PROCESSORS } from "./processors/index";

export { QUEUE_NAMES };
export type { QueueName };

export function createRedisConnection(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL manquante");
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: false, family: 0, lazyConnect: false });
}

export type Runtime = {
  connection: Redis;
  queues: Map<QueueName, Queue>;
  workers: Map<QueueName, Worker>;
};

/**
 * Tâches bloquées (`stalled`) : une tâche dont le verrou n'est plus renouvelé (worker planté ou gelé) est
 * remise en attente au bout de 30 s ; après 2 blocages elle est marquée échouée (visible sur la page État).
 */
const STALLED_INTERVAL_MS = 30_000;
const MAX_STALLED_COUNT = 2;

export function startQueues(): Runtime {
  const connection = createRedisConnection();
  const queues = new Map<QueueName, Queue>();
  const workers = new Map<QueueName, Worker>();
  for (const name of QUEUE_NAMES) {
    const def = PROCESSORS[name];
    const queue = new Queue(name, { connection, prefix: QUEUE_PREFIX, defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000, ...JOB_RETRY_OPTIONS[name] } });
    queues.set(name, queue);
    const worker = new Worker(name, def.process, {
      connection,
      prefix: QUEUE_PREFIX,
      concurrency: def.concurrency,
      stalledInterval: STALLED_INTERVAL_MS,
      maxStalledCount: MAX_STALLED_COUNT,
      // Limite globale de sécurité pour la file Telegram ; le débit fin par bot/chat est géré dans le processeur.
      limiter: name === "telegram-send" ? { max: 25, duration: 1000 } : undefined,
    });
    worker.on("failed", (job, err) => {
      logger.error({ queue: name, id: job?.id, attempt: job?.attemptsMade, err: err.message }, "tâche échouée");
      // Compteur glissant par file : la règle d'alerte « erreurs répétées » (≥ 10 en 15 min) le lit.
      void recordJobFailure(connection, name, job?.id).catch(() => undefined);
    });
    worker.on("stalled", (jobId) => logger.warn({ queue: name, id: jobId }, "tâche bloquée remise en attente"));
    worker.on("error", (err) => logger.error({ queue: name, err: err.message }, "erreur worker"));
    workers.set(name, worker);
    for (const r of def.repeatable) {
      void queue
        .upsertJobScheduler(
          r.jobId,
          { every: r.everyMs },
          { name: `${name}:${String(r.data.type ?? "tick")}`, data: r.data, opts: { removeOnComplete: 100, removeOnFail: 100, ...JOB_RETRY_OPTIONS[name] } },
        )
        .catch((err: Error) => logger.error({ queue: name, jobId: r.jobId, err: err.message }, "planification impossible"));
    }
  }
  logger.info({ queues: QUEUE_NAMES }, "files démarrées");
  return { connection, queues, workers };
}

/** Arrêt propre : `worker.close()` attend la fin des tâches en cours avant de rendre la main. */
export async function stopQueues(rt: Runtime): Promise<void> {
  await Promise.allSettled([...rt.workers.values()].map((w) => w.close()));
  await Promise.allSettled([...rt.queues.values()].map((q) => q.close()));
  await rt.connection.quit().catch(() => undefined);
}

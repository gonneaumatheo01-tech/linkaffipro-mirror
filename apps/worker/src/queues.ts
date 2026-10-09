import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { QUEUE_NAMES, QUEUE_PREFIX, type QueueName } from "@linkaffipro/queue";
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

export function startQueues(): Runtime {
  const connection = createRedisConnection();
  const queues = new Map<QueueName, Queue>();
  const workers = new Map<QueueName, Worker>();
  for (const name of QUEUE_NAMES) {
    const def = PROCESSORS[name];
    const queue = new Queue(name, { connection, prefix: QUEUE_PREFIX });
    queues.set(name, queue);
    const worker = new Worker(name, def.process, {
      connection,
      prefix: QUEUE_PREFIX,
      concurrency: def.concurrency,
      // Limite globale de sécurité pour la file Telegram ; le débit fin par bot/chat est géré dans le processeur.
      limiter: name === "telegram-send" ? { max: 25, duration: 1000 } : undefined,
    });
    worker.on("failed", (job, err) => logger.error({ queue: name, id: job?.id, err: err.message }, "tâche échouée"));
    worker.on("error", (err) => logger.error({ queue: name, err: err.message }, "erreur worker"));
    workers.set(name, worker);
    for (const r of def.repeatable) {
      void queue
        .upsertJobScheduler(r.jobId, { every: r.everyMs }, { name: `${name}:${String(r.data.type ?? "tick")}`, data: r.data, opts: { removeOnComplete: 100, removeOnFail: 100 } })
        .catch((err: Error) => logger.error({ queue: name, jobId: r.jobId, err: err.message }, "planification impossible"));
    }
  }
  logger.info({ queues: QUEUE_NAMES }, "files démarrées");
  return { connection, queues, workers };
}

export async function stopQueues(rt: Runtime): Promise<void> {
  await Promise.allSettled([...rt.workers.values()].map((w) => w.close()));
  await Promise.allSettled([...rt.queues.values()].map((q) => q.close()));
  await rt.connection.quit().catch(() => undefined);
}

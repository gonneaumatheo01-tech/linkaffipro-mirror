import { Queue, Worker, type Job, type Processor } from "bullmq";
import { Redis } from "ioredis";
import { logger } from "./logger.js";

/** Noms des files de travail. Les traitements réels arrivent en phase 1. */
export const QUEUE_NAMES = ["scheduler", "telegram-send", "approvals", "sync-linkaffi", "stats"] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

export function createRedisConnection(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL manquante");
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    family: 0,
    lazyConnect: false,
  });
}

const noopProcessor: Processor = async (job: Job) => {
  logger.info({ queue: job.queueName, name: job.name, id: job.id }, "tâche reçue (traitement à venir)");
  return { ok: true };
};

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
    queues.set(name, new Queue(name, { connection, prefix: "lap" }));
    const worker = new Worker(name, noopProcessor, {
      connection,
      prefix: "lap",
      concurrency: name === "telegram-send" ? 5 : 1,
      limiter: name === "telegram-send" ? { max: 20, duration: 1000 } : undefined,
    });
    worker.on("failed", (job, err) => logger.error({ queue: name, id: job?.id, err: err.message }, "tâche échouée"));
    worker.on("error", (err) => logger.error({ queue: name, err: err.message }, "erreur worker"));
    workers.set(name, worker);
  }
  logger.info({ queues: QUEUE_NAMES }, "files démarrées");
  return { connection, queues, workers };
}

export async function stopQueues(rt: Runtime): Promise<void> {
  await Promise.allSettled([...rt.workers.values()].map((w) => w.close()));
  await Promise.allSettled([...rt.queues.values()].map((q) => q.close()));
  await rt.connection.quit().catch(() => undefined);
}

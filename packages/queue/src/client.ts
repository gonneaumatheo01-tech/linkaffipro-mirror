import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import { QUEUE_PREFIX, type JobOf, type QueueName } from "./jobs";

let connection: Redis | null = null;
const queues = new Map<QueueName, Queue>();

/** Connexion Redis partagée (côté producteur). */
export function getRedis(): Redis {
  if (connection) return connection;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL manquante");
  connection = new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: false, family: 0 });
  return connection;
}

export function getQueue<Q extends QueueName>(name: Q): Queue<JobOf<Q>> {
  const hit = queues.get(name);
  if (hit) return hit as Queue<JobOf<Q>>;
  const q = new Queue<JobOf<Q>>(name, { connection: getRedis(), prefix: QUEUE_PREFIX, defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000, attempts: 1 } });
  queues.set(name, q as Queue);
  return q;
}

/** Ajoute une tâche. `jobId` rend l'ajout idempotent (une même tâche n'est pas enfilée deux fois). */
export async function enqueue<Q extends QueueName>(name: Q, data: JobOf<Q>, opts: JobsOptions & { jobId?: string } = {}) {
  const q = getQueue(name) as unknown as Queue;
  return q.add(`${name}:${(data as { type: string }).type}`, data, { ...opts });
}

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([...queues.values()].map((q) => q.close()));
  queues.clear();
  if (connection) {
    await connection.quit().catch(() => undefined);
    connection = null;
  }
}

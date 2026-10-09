import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import { JOB_RETRY_OPTIONS, QUEUE_PREFIX, type JobOf, type QueueName } from "./jobs";

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
  // Tentatives et attente par file : voir `JOB_RETRY_OPTIONS` (une tâche peut toujours les surcharger à l'ajout).
  const q = new Queue<JobOf<Q>>(name, { connection: getRedis(), prefix: QUEUE_PREFIX, defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000, ...JOB_RETRY_OPTIONS[name] } });
  queues.set(name, q as Queue);
  return q;
}

/** BullMQ interdit « : » dans un identifiant de tâche personnalisé : on le remplace par « - ». */
export function safeJobId(id: string | undefined): string | undefined {
  return id === undefined ? undefined : id.replace(/:/g, "-");
}

/** Ajoute une tâche. `jobId` rend l'ajout idempotent (une même tâche n'est pas enfilée deux fois). */
export async function enqueue<Q extends QueueName>(name: Q, data: JobOf<Q>, opts: JobsOptions & { jobId?: string } = {}) {
  const q = getQueue(name) as unknown as Queue;
  const { jobId, ...rest } = opts;
  return q.add(`${name}:${(data as { type: string }).type}`, data, { ...rest, ...(jobId ? { jobId: safeJobId(jobId) } : {}) });
}

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([...queues.values()].map((q) => q.close()));
  queues.clear();
  if (connection) {
    await connection.quit().catch(() => undefined);
    connection = null;
  }
}

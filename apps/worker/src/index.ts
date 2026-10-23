import { prisma } from "@linkaffipro/db";
import { logger } from "./logger";
import { startHealthServer, startHeartbeat } from "./health";
import { reportWorkerRestart } from "./maintenance/alerts";
import { startQueues, stopQueues, type Runtime } from "./queues";
import { startCapture } from "./capture";

let runtime: Runtime | null = null;
let heartbeat: { stop: () => void } | null = null;
let capture: { stop: () => void } | null = null;
const server = startHealthServer(() => runtime);

try {
  runtime = startQueues();
  // Avant le premier battement : si l'ancien battement date de plus de 3 min, on signale l'absence (alerte worker_down).
  void reportWorkerRestart(runtime.connection).catch((err: Error) => logger.warn({ err: err.message }, "vérification de l'absence du worker impossible"));
  heartbeat = startHeartbeat(runtime.connection);
  // Captures chez les bookmakers (phase 23) : navigateur du worker et demandes en base.
  capture = startCapture(runtime.connection);
} catch (err) {
  logger.error({ err: (err as Error).message }, "impossible de démarrer les files");
}

let stopping = false;
/** Arrêt propre : plus de nouvelles tâches, fin des tâches en cours, puis sortie (15 s maximum). */
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "arrêt en cours");
  const timer = setTimeout(() => process.exit(1), 15_000);
  try {
    heartbeat?.stop();
    capture?.stop();
    server.close();
    if (runtime) await stopQueues(runtime);
    await prisma.$disconnect();
  } finally {
    clearTimeout(timer);
    process.exit(0);
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => logger.error({ reason }, "promesse non gérée"));

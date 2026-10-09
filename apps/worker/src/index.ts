import { prisma } from "@linkaffipro/db";
import { logger } from "./logger";
import { startHealthServer } from "./health";
import { startQueues, stopQueues, type Runtime } from "./queues";

let runtime: Runtime | null = null;
const server = startHealthServer(() => runtime);

try {
  runtime = startQueues();
} catch (err) {
  logger.error({ err: (err as Error).message }, "impossible de démarrer les files");
}

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "arrêt en cours");
  const timer = setTimeout(() => process.exit(1), 15_000);
  try {
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

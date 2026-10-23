/**
 * Dépendances des agents dans le worker (phase 19) : base partagée, mise en file BullMQ (`createAgentsEnqueue`),
 * messager du dialogue admin (`createAdminMessenger`, seul identifiant admin), journal pino. Créées une fois.
 */
import type { AgentsDeps, EngineDeps } from "@linkaffipro/agents";
import { prisma } from "@linkaffipro/db";
import { createAgentsEnqueue } from "@linkaffipro/queue";
import { createAdminMessenger } from "@linkaffipro/telegram";
import { logger } from "../logger";
import { createFrameExtractor } from "./frames";

let cached: EngineDeps | null = null;

export function workerAgentsDeps(): EngineDeps {
  if (cached) return cached;
  const deps: EngineDeps = {
    prisma,
    enqueue: createAgentsEnqueue() as unknown as AgentsDeps["enqueue"],
    admin: createAdminMessenger(),
    logger: {
      info: (o, m) => logger.info(o, m),
      warn: (o, m) => logger.warn(o, m),
      error: (o, m) => logger.error(o, m),
    },
    // Contrôle qualité des vidéos produites (phase 20) : ffmpeg est dans l'image du worker.
    frames: createFrameExtractor(),
  };
  cached = deps;
  return deps;
}

/** Tests : dépendances imposées (`null` revient aux vraies). */
export function setWorkerAgentsDeps(next: EngineDeps | null): void {
  cached = next;
}

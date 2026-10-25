/**
 * Dépendances des agents dans le worker (phase 19) : base partagée, mise en file BullMQ (`createAgentsEnqueue`),
 * messager du dialogue admin (`createAdminMessenger`, seul identifiant admin), journal pino. Créées une fois.
 */
import { bookmakerKevinHook, bookmakerTransportHooks, type AgentsDeps, type BookmakerReadDeps, type EngineDeps } from "@linkaffipro/agents";
import { prisma } from "@linkaffipro/db";
import { createAgentsEnqueue } from "@linkaffipro/queue";
import { createAdminMessenger, createBossMediaIngest } from "@linkaffipro/telegram";
import { logger } from "../logger";
import { createFrameExtractor } from "./frames";
import { createRedisOddsCache } from "./odds-cache";
import { siteOpsClientFromEnv } from "./site-ops-client";

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
    // Cotes (phase 23) : cache partagé dans Redis.
    oddsCache: createRedisOddsCache(),
  };
  // Phase 34 : opérations du site pour Kevin (entrée interne signée du site ; absente sans APP_BASE_URL ou sans clé).
  const siteOps = siteOpsClientFromEnv(process.env, { warn: (o, m) => logger.warn(o, m) });
  if (siteOps) deps.siteOps = siteOps;
  // Phase 34 : médias d'un message transféré à Kevin rangés dans la médiathèque avant l'essai à blanc.
  const ingest = createBossMediaIngest();
  deps.ingestForwardedMedia = (content) => ingest(deps, content);
  // Bookmakers lus directement (phase 35) : transport choisi par site, verrou, rythme et messages de Kevin, pour
  // l'équipe Paris (double lecture au Contrôle) comme pour Kevin (« la cote de … chez Sportaza ? »).
  (deps as BookmakerReadDeps).bookmakers = { ...bookmakerTransportHooks(deps), onBookmakerEvent: bookmakerKevinHook(deps) };
  cached = deps;
  return deps;
}

/** Tests : dépendances imposées (`null` revient aux vraies). */
export function setWorkerAgentsDeps(next: EngineDeps | null): void {
  cached = next;
}

import { createServer, type Server } from "node:http";
import { prisma } from "@linkaffipro/db";
import { HEARTBEAT_INTERVAL_MS, writeHeartbeat, type Heartbeat } from "@linkaffipro/queue";
import type { Redis } from "ioredis";
import type { Runtime } from "./queues";
import { logger } from "./logger";

export const VERSION = process.env.npm_package_version ?? "0.0.1";
/** Commit déployé (fourni par Railway), raccourci ; absent en local. */
export const COMMIT = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7);
export const STARTED_AT = new Date();

export async function healthSnapshot(rt: Runtime | null) {
  const [db, redis] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => "ok").catch((e: Error) => `erreur : ${e.message}`),
    rt ? rt.connection.ping().then(() => "ok").catch((e: Error) => `erreur : ${e.message}`) : Promise.resolve("non démarré"),
  ]);
  const ok = db === "ok" && redis === "ok";
  return { status: ok ? "ok" : "degraded", service: "worker", version: VERSION, commit: COMMIT ?? null, startedAt: STARTED_AT.toISOString(), db, redis, queues: rt ? [...rt.queues.keys()] : [], time: new Date().toISOString() };
}

export function startHealthServer(getRuntime: () => Runtime | null): Server {
  const port = Number(process.env.PORT ?? 8080);
  const server = createServer(async (req, res) => {
    if (req.url === "/health" || req.url === "/") {
      const snap = await healthSnapshot(getRuntime());
      res.writeHead(snap.status === "ok" ? 200 : 503, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(snap));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  server.listen(port, () => logger.info({ port }, "serveur /health démarré"));
  return server;
}

export function currentHeartbeat(now = new Date()): Heartbeat {
  return { at: now.toISOString(), version: VERSION, startedAt: STARTED_AT.toISOString(), pid: process.pid, ...(COMMIT ? { commit: COMMIT } : {}) };
}

/**
 * Battement de cœur : toutes les 30 s, écrit `worker:heartbeat` dans Redis (durée de vie 180 s).
 * Le site lit cette clé pour afficher l'état du worker et dégrader `/api/health` s'il est absent.
 */
export function startHeartbeat(redis: Redis): { stop: () => void } {
  const beat = () => writeHeartbeat(redis, currentHeartbeat()).catch((err: Error) => logger.warn({ err: err.message }, "battement de cœur non écrit"));
  void beat();
  const timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}

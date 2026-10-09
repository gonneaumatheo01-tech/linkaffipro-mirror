import { createServer, type Server } from "node:http";
import { prisma } from "@linkaffipro/db";
import type { Runtime } from "./queues.js";
import { logger } from "./logger.js";

export const VERSION = process.env.npm_package_version ?? "0.0.1";

export async function healthSnapshot(rt: Runtime | null) {
  const [db, redis] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => "ok").catch((e: Error) => `erreur : ${e.message}`),
    rt ? rt.connection.ping().then(() => "ok").catch((e: Error) => `erreur : ${e.message}`) : Promise.resolve("non démarré"),
  ]);
  const ok = db === "ok" && redis === "ok";
  return { status: ok ? "ok" : "degraded", service: "worker", version: VERSION, db, redis, queues: rt ? [...rt.queues.keys()] : [], time: new Date().toISOString() };
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

import { prisma } from "@linkaffipro/db";
import { heartbeatAgeSec, isWorkerDown, readHeartbeat, type Heartbeat } from "@linkaffipro/queue";
import { withRedis } from "@/lib/redis";
import { ensureWorkerDownAlert } from "@/lib/status/worker-down";
import pkg from "../../../package.json";

export const dynamic = "force-dynamic";

/**
 * Santé du site : base (latence chronométrée), Redis, et battement du worker.
 * `degraded` (503) si la base ou Redis ne répondent pas, ou si le worker n'a plus donné signe de vie depuis 3 min.
 * Un worker jamais démarré (aucun battement connu) ne dégrade pas le site : `workerHeartbeatAgeSec` vaut null.
 */
export async function GET() {
  const now = new Date();
  const t0 = performance.now();
  const [db, redisRead] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => "ok").catch((e: Error) => `erreur : ${e.message}`),
    withRedis((c) => readHeartbeat(c)).then((r) => ({ status: "ok" as const, ...r })).catch((e: Error) => ({ status: `erreur : ${e.message}`, heartbeat: null as Heartbeat | null, alive: false })),
  ]);
  const dbLatencyMs = Math.round((performance.now() - t0) * 10) / 10;
  const hb = redisRead.heartbeat;
  const workerHeartbeatAgeSec = heartbeatAgeSec(hb, now);
  const workerDown = hb !== null && isWorkerDown(hb, now);
  if (workerDown && hb) void ensureWorkerDownAlert(hb, now);
  const ok = db === "ok" && redisRead.status === "ok" && !workerDown;
  return Response.json(
    {
      status: ok ? "ok" : "degraded",
      service: "web",
      version: pkg.version,
      db,
      dbLatencyMs,
      redis: redisRead.status,
      worker: hb ? { status: workerDown ? "down" : "ok", version: hb.version, startedAt: hb.startedAt, lastHeartbeatAt: hb.at } : null,
      workerHeartbeatAgeSec,
      time: now.toISOString(),
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}

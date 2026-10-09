import { prisma } from "@linkaffipro/db";
import { pingRedis } from "@/lib/redis";
import pkg from "../../../package.json";

export const dynamic = "force-dynamic";

export async function GET() {
  const [db, redis] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => "ok").catch((e: Error) => `erreur : ${e.message}`),
    pingRedis(),
  ]);
  const ok = db === "ok" && redis === "ok";
  return Response.json(
    { status: ok ? "ok" : "degraded", service: "web", version: pkg.version, db, redis, time: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}

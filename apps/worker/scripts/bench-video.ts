/**
 * `pnpm agents:bench-video --persona <id> [--count 3]` : lance le banc d'essai vidéo de l'équipe Dating (tâche
 * `agents-orchestrator` `bench`, exécutée par le worker ; résultats envoyés à l'admin par Telegram).
 * En production : `railway ssh --service web -- pnpm agents:bench-video --persona <id>`.
 */
import { prisma } from "@linkaffipro/db";
import { startBench, type AgentsDeps } from "@linkaffipro/agents";
import { closeQueues, createAgentsEnqueue } from "@linkaffipro/queue";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const personaId = arg("persona");
const count = Number(arg("count") ?? 3);
if (!personaId) {
  console.error("Usage : pnpm agents:bench-video --persona <id> [--count 3]");
  process.exit(1);
}

const deps: AgentsDeps = { prisma, enqueue: createAgentsEnqueue() as unknown as AgentsDeps["enqueue"] };
try {
  const r = await startBench(deps, { personaId, count: Number.isFinite(count) && count > 0 ? count : 3 });
  console.log(r.message);
  process.exitCode = r.ok ? 0 : 1;
} finally {
  await closeQueues().catch(() => undefined);
  await prisma.$disconnect();
}

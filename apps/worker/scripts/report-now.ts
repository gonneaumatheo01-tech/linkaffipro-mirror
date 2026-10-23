/**
 * `pnpm agents:report-now [--team algo] [--no-send] [--queue]` (phase 21) : recalcule les fiches des posts, les
 * horaires, les chiffres des conversations, clôt les tests arrivés à terme, produit les recommandations de la semaine
 * et envoie le rapport « Ce qui marche » à l'admin par Telegram. `--queue` : confié au worker (file `agents-algo`).
 * En production : `railway ssh --service web -- pnpm agents:report-now`.
 */
import { prisma } from "@linkaffipro/db";
import { runAlgoReportNow, type AgentsDeps } from "@linkaffipro/agents";
import { closeQueues, createAgentsEnqueue, enqueue } from "@linkaffipro/queue";
import { createAdminMessenger } from "@linkaffipro/telegram";

const has = (flag: string) => process.argv.includes(`--${flag}`);
const team = (() => {
  const i = process.argv.indexOf("--team");
  return i >= 0 ? process.argv[i + 1] : "algo";
})();
if (team !== "algo") {
  console.error("Seule l'équipe Algorithme a un rapport « Ce qui marche » : --team algo.");
  process.exit(1);
}

try {
  if (has("queue")) {
    await enqueue("agents-algo", { type: "algo", task: "report-now", send: !has("no-send") });
    console.log("Rapport confié au worker (file agents-algo) : il arrive sur Telegram dans quelques minutes.");
  } else {
    const deps: AgentsDeps = {
      prisma,
      enqueue: createAgentsEnqueue() as unknown as AgentsDeps["enqueue"],
      admin: createAdminMessenger(),
      logger: console as unknown as AgentsDeps["logger"],
    };
    const r = await runAlgoReportNow(deps, { send: !has("no-send") });
    console.log(r.message);
    process.exitCode = r.ok ? 0 : 1;
  }
} finally {
  await closeQueues().catch(() => undefined);
  await prisma.$disconnect();
}

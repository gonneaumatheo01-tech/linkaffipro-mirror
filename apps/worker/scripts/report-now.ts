/**
 * `pnpm agents:report-now [--team algo|ads] [--weekly] [--no-send] [--queue]`.
 * - `--team algo` (défaut, phase 21) : fiches des posts, horaires, conversations, tests, recommandations de la semaine
 *   et rapport « Ce qui marche » ;
 * - `--team ads` (phase 24) : recommandations du jour et rapport des pubs (`--weekly` : celui de la semaine).
 * Envoyé à l'admin par Telegram. `--queue` : confié au worker (file `agents-algo` ou `agents-ads`).
 * En production : `railway ssh --service web -- pnpm agents:report-now --team ads`.
 */
import { prisma } from "@linkaffipro/db";
import { runAdsReportNow, runAlgoReportNow, type AgentsDeps } from "@linkaffipro/agents";
import { closeQueues, createAgentsEnqueue, enqueue } from "@linkaffipro/queue";
import { createAdminMessenger } from "@linkaffipro/telegram";

const has = (flag: string) => process.argv.includes(`--${flag}`);
const team = (() => {
  const i = process.argv.indexOf("--team");
  return i >= 0 ? process.argv[i + 1] : "algo";
})();
if (team !== "algo" && team !== "ads") {
  console.error("Équipes avec un rapport : --team algo (« Ce qui marche ») ou --team ads (pubs).");
  process.exit(1);
}
const send = !has("no-send");
const kind = has("weekly") ? "weekly" : "daily";

try {
  if (has("queue")) {
    if (team === "ads") await enqueue("agents-ads", { type: "report-now", kind, send });
    else await enqueue("agents-algo", { type: "algo", task: "report-now", send });
    console.log(`Rapport confié au worker (file agents-${team}) : il arrive sur Telegram dans quelques minutes.`);
  } else {
    const deps: AgentsDeps = {
      prisma,
      enqueue: createAgentsEnqueue() as unknown as AgentsDeps["enqueue"],
      admin: createAdminMessenger(),
      logger: console as unknown as AgentsDeps["logger"],
    };
    const r = team === "ads" ? await runAdsReportNow(deps, { kind, send }) : await runAlgoReportNow(deps, { send });
    console.log(r.message);
    process.exitCode = r.ok ? 0 : 1;
  }
} finally {
  await closeQueues().catch(() => undefined);
  await prisma.$disconnect();
}

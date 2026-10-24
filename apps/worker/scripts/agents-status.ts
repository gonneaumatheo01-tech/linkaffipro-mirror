/**
 * `pnpm agents:status [--json]` : résumé de supervision des agents (le même que la commande « agents » du bot et la
 * page /agents). Lecture seule. En production : `railway ssh --service web -- pnpm agents:status`.
 */
import { prisma } from "@linkaffipro/db";
import { agentsOverview, overviewLines } from "@linkaffipro/agents";

try {
  const o = await agentsOverview(prisma);
  if (process.argv.includes("--json")) console.log(JSON.stringify(o, null, 2));
  else console.log(overviewLines(o).join("\n"));
} catch (err) {
  console.error(`Résumé impossible : ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

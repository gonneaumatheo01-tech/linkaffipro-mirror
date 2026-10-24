/**
 * `pnpm boss:unmet [--limit 100] [--json]` : carnet des besoins que Kevin (le Boss) ne sait pas encore faire, du plus
 * fréquent au moins fréquent (c'est le carnet de la phase suivante). Lecture seule ; jamais de secret (ils ne sont
 * pas enregistrés). En production : `railway ssh --service web -- pnpm boss:unmet`.
 */
import { prisma } from "@linkaffipro/db";
import { bossUnmetLines, listBossUnmet } from "@linkaffipro/agents";

const at = process.argv.indexOf("--limit");
const limit = at > 0 ? Number(process.argv[at + 1]) || 100 : 100;

try {
  const rows = await listBossUnmet({ prisma }, limit);
  if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 2));
  else {
    console.log(`Besoins non couverts (${rows.length}, du plus fréquent au moins fréquent) :`);
    console.log(bossUnmetLines(rows).join("\n"));
  }
} catch (err) {
  console.error(`Lecture impossible : ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

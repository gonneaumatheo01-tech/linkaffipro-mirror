import { prisma } from "@linkaffipro/db";
async function main() {
  const s = await prisma.syncState.findUnique({ where: { source: "stats" } });
  console.log("syncState stats | err:", s?.lastError, "| imported:", s?.rowsImported, "| cursor:", JSON.stringify(s?.cursor));
  console.log("affiliateDailyStat:", await prisma.affiliateDailyStat.count());
  const d = await prisma.affiliateDailyStat.findMany({ take: 3, orderBy: { date: "desc" }, select: { externalId: true, date: true, affiliateExternalId: true, affiliateCampaignId: true, revenue: true } });
  for (const x of d) console.log(JSON.stringify(x));
}
main().then(() => process.exit(0));

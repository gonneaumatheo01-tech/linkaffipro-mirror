import { prisma } from "@linkaffipro/db";
async function main() {
  console.log("=== syncStates ===");
  for (const r of await prisma.syncState.findMany()) {
    console.log(`${r.source} | err: ${r.lastError} | imported: ${r.rowsImported} | streak: ${(r.cursor as { errorStreak?: number } | null)?.errorStreak}`);
  }
  console.log("=== affiliateCampaign (raw) ===");
  const first = await prisma.affiliateCampaign.findFirst();
  console.log("champs:", first ? Object.keys(first).join(", ") : "(vide)");
  for (const a of await prisma.affiliateCampaign.findMany({ take: 20 })) {
    const raw = a.raw as Record<string, unknown> | null;
    console.log(`${a.id} | raw.affiliate_id: ${String(raw?.affiliate_id)} | raw.campaign_id: ${String(raw?.campaign_id)}`);
  }
  console.log("=== campagne liee (affiliateCampaignIds) ===");
  for (const c of await prisma.campaign.findMany({ take: 20 })) {
    console.log(`${c.id} | ids: ${JSON.stringify(c.affiliateCampaignIds)}`);
  }
}
main().then(() => process.exit(0));

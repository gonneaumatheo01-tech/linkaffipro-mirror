import { prisma } from "@linkaffipro/db";
const J = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
async function main() {
  const ids = ["c2j05ag4mo3dclqt3ndfn7iry","c17bbdz0bbxm9356e5ztbhuf7","cleluvh4mgulnh7iojlmcerrw","c4x053a5sk4nk1nntx2x7yl39","cz5rbrwjd9mm7i8gmvh1g7a12"];
  for (const a of await prisma.affiliateCampaign.findMany({ where: { id: { in: ids } } })) {
    console.log("AFFCAMPAIGN", a.id, "| externalId:", a.externalId, "| name:", a.name, "| raw:", J(a.raw).slice(0, 200));
  }
  for (const c of await prisma.campaign.findMany()) {
    console.log("CAMPAIGN", c.id, "| externalId:", c.externalId, "| name:", c.name, "| affCampaignIds:", J(c.affiliateCampaignIds));
  }
}
main().then(() => process.exit(0));

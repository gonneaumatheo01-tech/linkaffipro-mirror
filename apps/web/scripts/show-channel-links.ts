import { prisma } from "@linkaffipro/db";

async function main() {
  const [filtre] = process.argv.slice(2);
  const canaux = await prisma.channel.findMany({
    where: filtre ? { title: { contains: filtre } } : {},
    select: { id: true, title: true, username: true },
  });
  for (const c of canaux) {
    console.log(`\n=== ${c.title} (${c.id}) @${c.username ?? "-"}`);
    const liens = await prisma.inviteLink.findMany({
      where: { channelId: c.id },
      select: { name: true, telegramInviteLink: true, createsJoinRequest: true, isActive: true },
    });
    for (const l of liens)
      console.log(`  ${l.isActive ? "actif  " : "inactif"} ${l.createsJoinRequest ? "DEMANDE" : "direct "}  ${l.telegramInviteLink}  (${l.name})`);
    if (liens.length === 0) console.log("  aucun lien");
  }
}

main().then(() => process.exit(0));

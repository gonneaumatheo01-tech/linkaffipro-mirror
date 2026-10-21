import { prisma } from "@linkaffipro/db";

async function main() {
  const [compte, dest, ...texte] = process.argv.slice(2);
  const dm = await prisma.accountDm.create({
    data: {
      accountId: String(compte),
      telegramUserId: BigInt(String(dest)),
      text: texte.join(" ") || "coucou, test de DM depuis le compte reel",
      dueAt: new Date(),
    },
    select: { id: true },
  });
  console.log("dm enfile :", dm.id);
}

main().then(() => process.exit(0));

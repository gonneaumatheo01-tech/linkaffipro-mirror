import { prisma } from "@linkaffipro/db";

async function main() {
  const accounts = await prisma.telegramUserAccount.findMany();
  const account = accounts.find((a) => a.botId) ?? accounts[0];
  const botId = account?.botId;
  if (!botId) {
    console.log("PAS DE BOT LIE");
    process.exit(1);
  }

  const convs = await prisma.conversation.findMany({ where: { botId } });
  const ids = convs.map((c) => c.id);
  console.log("conversations avant : " + ids.length);

  if (ids.length) {
    const jobs: Array<[string, () => Promise<{ count: number }>]> = [
      ["liens", () => prisma.assistantOfferLink.deleteMany({ where: { conversationId: { in: ids } } })],
      ["messages", () => prisma.conversationMessage.deleteMany({ where: { conversationId: { in: ids } } })],
      ["usage", () => prisma.aiConversationUsage.deleteMany({ where: { conversationId: { in: ids } } })],
      ["conversations", () => prisma.conversation.deleteMany({ where: { id: { in: ids } } })],
    ];
    for (const [nom, fn] of jobs) {
      try {
        const r = await fn();
        console.log(nom + " supprimes = " + r.count);
      } catch (e) {
        console.log(nom + " ECHEC : " + String((e as Error).message).slice(0, 140));
      }
    }
  }

  const rest = await prisma.conversation.findMany({ where: { botId } });
  console.log("conversations apres : " + rest.length);
  await prisma.$disconnect();
  process.exit(0);
}

main();

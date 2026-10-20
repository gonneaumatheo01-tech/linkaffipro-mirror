import { prisma } from '@linkaffipro/db';

async function main() {
  const accounts = await prisma.telegramUserAccount.findMany();
  const account = accounts.find((a: any) => a.botId) ?? accounts[0];
  const botId = (account as any)?.botId;
  if (!botId) { console.log('PAS DE BOT LIE'); process.exit(1); }

  const convs = await prisma.conversation.findMany({ where: { botId } as any });
  const ids = convs.map((c: any) => c.id);
  console.log('conversations avant : ' + ids.length);

  if (ids.length) {
    const jobs: Array<[string, () => Promise<any>]> = [
      ['liens', () => prisma.assistantOfferLink.deleteMany({ where: { conversationId: { in: ids } } })],
      ['messages', () => prisma.conversationMessage.deleteMany({ where: { conversationId: { in: ids } } })],
      ['usage', () => (prisma as any).aiConversationUsage.deleteMany({ where: { conversationId: { in: ids } } })],
      ['conversations', () => prisma.conversation.deleteMany({ where: { id: { in: ids } } })],
    ];
    for (const [nom, fn] of jobs) {
      try { const r = await fn(); console.log(nom + ' supprimes = ' + r.count); }
      catch (e: any) { console.log(nom + ' ECHEC : ' + String(e.message).slice(0, 140)); }
    }
  }

  const rest = await prisma.conversation.findMany({ where: { botId } as any });
  console.log('conversations apres : ' + rest.length);
  await prisma.$disconnect();
  process.exit(0);
}

main();

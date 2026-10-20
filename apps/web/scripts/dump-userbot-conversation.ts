import { prisma } from '@linkaffipro/db';

async function main() {
  const accounts = await prisma.telegramUserAccount.findMany();
  const account = accounts.find((a: any) => a.botId) ?? accounts[0];
  if (!account) { console.log('AUCUN COMPTE'); process.exit(1); }
  const botId = (account as any).botId;

  const convs = await prisma.conversation.findMany({ where: { botId } as any, orderBy: { createdAt: 'asc' } });
  let conv: any = null;
  let msgs: any[] = [];
  for (const c of convs as any[]) {
    const ms = await prisma.conversationMessage.findMany({ where: { conversationId: c.id }, orderBy: { createdAt: 'asc' } });
    if (ms.length > msgs.length) { conv = c; msgs = ms; }
  }
  if (!conv) { console.log('AUCUNE CONVERSATION AVEC MESSAGES'); process.exit(0); }

  console.log('--- conversation : ' + conv.id + ' | messages=' + msgs.length + ' ---');
  for (const m of msgs as any[]) {
    const who = m.direction === 'IN' ? 'IN ' : 'OUT';
    const turn = String(m.turnId ?? 'aucun');
    console.log('[' + who + ' | tour=' + turn.slice(0, 12) + '] ' + (m.text ?? ''));
  }
  await prisma.$disconnect();
  process.exit(0);
}

main();

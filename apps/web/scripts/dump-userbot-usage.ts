import { prisma } from '@linkaffipro/db';

async function main() {
  const rows = await prisma.aiConversationUsage.findMany({ orderBy: { createdAt: 'desc' }, take: 30 });
  for (const r of rows as any[]) {
    console.log(
      r.createdAt.toISOString() +
      ' | ok=' + r.ok +
      ' | purpose=' + r.purpose +
      ' | attempt=' + r.attempt +
      ' | model=' + r.model +
      ' | err=' + String(r.error ?? '').slice(0, 220),
    );
  }
  await prisma.$disconnect();
  process.exit(0);
}

main();

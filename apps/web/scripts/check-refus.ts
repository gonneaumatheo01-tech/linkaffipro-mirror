import { prisma } from "@linkaffipro/db";
async function main() {
  const c = await prisma.conversation.findFirst({
    orderBy: { updatedAt: "desc" },
    select: { id: true, appRefusedAt: true, stage: true, lastInboundAt: true, lastAssistantAt: true },
  });
  console.log(c);
  process.exit(0);
}
main();

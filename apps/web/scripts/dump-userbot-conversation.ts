import { prisma, type Conversation, type ConversationMessage } from "@linkaffipro/db";

async function main() {
  const accounts = await prisma.telegramUserAccount.findMany();
  const account = accounts.find((a) => a.botId) ?? accounts[0];
  if (!account?.botId) {
    console.log(account ? "PAS DE BOT LIE" : "AUCUN COMPTE");
    process.exit(1);
  }

  const convs = await prisma.conversation.findMany({ where: { botId: account.botId }, orderBy: { createdAt: "asc" } });
  let conv: Conversation | null = null;
  let msgs: ConversationMessage[] = [];
  for (const c of convs) {
    const ms = await prisma.conversationMessage.findMany({ where: { conversationId: c.id }, orderBy: { createdAt: "asc" } });
    if (ms.length > msgs.length) {
      conv = c;
      msgs = ms;
    }
  }
  if (!conv) {
    console.log("AUCUNE CONVERSATION AVEC MESSAGES");
    process.exit(0);
  }

  console.log("--- conversation : " + conv.id + " | messages=" + msgs.length + " ---");
  for (const m of msgs) {
    const who = m.direction === "IN" ? "IN " : "OUT";
    const turn = String(m.turnId ?? "aucun");
    console.log("[" + who + " | tour=" + turn.slice(0, 12) + "] " + (m.text ?? ""));
  }
  await prisma.$disconnect();
  process.exit(0);
}

main();

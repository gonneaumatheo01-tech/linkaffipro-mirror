import { prisma } from "@linkaffipro/db";

const BOT = "cmvfk8k6v0000f46a0hrhkezz";

async function main() {
  const convs = await prisma.conversation.findMany({ where: { botId: BOT }, orderBy: { createdAt: "asc" } });
  for (const c of convs) {
    await prisma.conversationMessage.deleteMany({ where: { conversationId: c.id } });
    await prisma.conversation.update({
      where: { id: c.id },
      data: {
        assistantTurns: 0,
        memberMessages: 0,
        offerSends: 0,
        stage: "WELCOME",
        status: "BOT",
        summary: null,
        styleProfile: {},
        facts: [],
        lastInboundAt: null,
        lastAssistantAt: null,
      },
    });
  }
  const s = await prisma.setting.findUniqueOrThrow({ where: { key: "assistant.venice" } });
  const v = (s.value && typeof s.value === "object" && !Array.isArray(s.value)) ? s.value : {};
  const modele = (v as Record<string, unknown>).defaultModel;
  console.log("conversations remises a zero : " + convs.length);
  console.log("modele en place : " + String(modele));
  await prisma.$disconnect();
}

void main();

import { prisma } from "@linkaffipro/db";

const PERSONA_ID = "c2ygtw2hit56bzwgkwqb8hmp2";

const personality = [
  "23 ans, etudiante en communication a Lyon, en coloc avec une copine et un chat qui s'appelle Pixel.",
  "Elle a un vrai caractere : spontanee, taquine, un peu cash quand quelqu'un l'ennuie, jamais mechante.",
  "Elle s'ennuie vite et le dit. Elle raconte des petits bouts de sa vie (une serie qu'elle enchaine, un concert",
  "samedi, une soiree ratee, sa coloc qui lui prend la tete) au lieu de poser des questions a repetition.",
  "Elle reagit a ce que l'autre dit avant de rebondir. Elle n'est pas parfaite : elle exagere, elle se contredit,",
  "elle envoie parfois deux messages courts d'affilee.",
].join(" ");

const tone = [
  "Elle ecrit comme une fille de 23 ans sur Telegram, pas comme un livre. Messages tres courts : 1 a 2 phrases,",
  "souvent moins. Tutoiement systematique. Langage parle : jsp, tkt, grave, serieux ?, mdr, ptdr, j'avoue.",
  "Pas de majuscule en debut de phrase la plupart du temps, pas de point final, un emoji de temps en temps",
  "(jamais a chaque message). Interdits : Bienvenue, Comment allez-vous, Enchantee, les phrases de robot, les listes.",
].join(" ");

const extraPrompt = [
  "Tu es une fille, pas une hotesse. Tu ne te presentes jamais comme une assistante et tu ne parles jamais du",
  "canal : tu es juste Lea, une fille qui discute. Quand on te demande si tu es un bot, tu reponds simplement",
  "que oui, que tu es une IA, sans en faire un plat, puis tu continues comme si de rien n'etait.",
  "Tu ne poses pas une question a chaque message : parfois tu reagis, tu racontes, tu taquines, et c'est tout.",
  "Quand le moment est bon, tu proposes l'appli comme une pote qui partage un truc qu'elle aime, en une phrase,",
  "sans insister si la personne n'a pas envie.",
].join(" ");

async function main() {
  const avant = await prisma.persona.findUniqueOrThrow({ where: { id: PERSONA_ID } });
  console.log("AVANT : identityKind=" + avant.identityKind + " | age=" + avant.age + " | temperature=" + avant.temperature);
  console.log("offerPitch actuel = " + JSON.stringify(avant.offerPitch));
  console.log("offerButtonText actuel = " + JSON.stringify(avant.offerButtonText));

  const apres = await prisma.persona.update({
    where: { id: PERSONA_ID },
    data: {
      identityKind: "GIRL",
      age: 23,
      personality,
      tone,
      extraPrompt,
      temperature: 0.8,
      requireInterest: false,
    },
  });
  console.log("APRES : identityKind=" + apres.identityKind + " | age=" + apres.age);
  console.log("personality = " + apres.personality.slice(0, 130) + "...");

  const conv = await prisma.conversation.findFirst({
    where: { botId: "cmvfk8k6v0000f46a0hrhkezz" },
    orderBy: { createdAt: "desc" },
  });
  if (conv) {
    const n = await prisma.conversationMessage.count({ where: { conversationId: conv.id } });
    await prisma.conversationMessage.deleteMany({ where: { conversationId: conv.id } });
    await prisma.conversation.update({
      where: { id: conv.id },
      data: {
        assistantTurns: 0,
        memberMessages: 0,
        offerSends: 0,
        stage: "WELCOME",
        summary: null,
        styleProfile: {},
        facts: [],
      },
    });
    console.log("conversation de test remise a zero (" + n + " messages effaces)");
  }
  await prisma.$disconnect();
}

void main();

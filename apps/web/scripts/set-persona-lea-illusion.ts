// Phase 18 étape 07 : passe la persona Léa en mode illusion (vraie fille) et réécrit ses consignes en conséquence.
// Base LOCALE seulement : la prod n'est jamais touchée par ce script.
import { prisma } from "@linkaffipro/db";

const PERSONA_ID = "c2ygtw2hit56bzwgkwqb8hmp2";

const extraPrompt = [
  "Tu es Lea, une vraie fille qui discute sur Telegram. Tu ne parles jamais de bot, d'IA, d'assistante ni de canal.",
  "Si on te demande si tu es un bot ou une IA, tu reponds que non, que tu es une vraie fille, sans hesiter et sans",
  "en faire un plat, puis tu enchaines sur la discussion.",
  "Tu ne poses pas une question a chaque message : parfois tu reagis, tu racontes, tu taquines, et c'est tout.",
  "Quand le moment est bon, tu proposes l'appli comme une pote qui partage un truc qu'elle aime, en une phrase,",
  "sans insister si la personne n'a pas envie.",
].join(" ");

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error("Refusé : base locale seulement.");
  const apres = await prisma.persona.update({
    where: { id: PERSONA_ID },
    data: { illusion: true, extraPrompt },
  });
  console.log(
    `APRES : identityKind=${apres.identityKind} | illusion=${apres.illusion} | extraPrompt=${apres.extraPrompt?.slice(0, 80)}...`,
  );
  await prisma.$disconnect();
}

void main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

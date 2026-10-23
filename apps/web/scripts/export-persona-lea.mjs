// Exporte la fiche Léa de la base LOCALE vers scripts/persona-fille.mjs, ensuite appliqué en PROD par
// `bash scripts/railway-phase18-prod.sh fille`. Verbatim : aucune retouche à la main.
import { writeFileSync } from "node:fs";
import { prisma } from "@linkaffipro/db";

const CHAMPS = [
  "name", "gender", "identityKind", "age", "illusion", "personality", "tone", "styleExamples",
  "interests", "languages", "minExchangesBeforeOffer", "requireInterest", "maxOfferSends",
  "followUpAfterHours", "followUpsMax", "temperature", "extraPrompt", "botDescription",
  "botShortDescription", "offerPitch", "offerButtonText", "isActive",
];

const p = await prisma.persona.findFirst({ where: { name: { equals: "Léa", mode: "insensitive" } } });
if (!p) throw new Error("persona Léa introuvable dans la base locale");

const fiche = {};
for (const k of CHAMPS) fiche[k] = p[k];

const s = await prisma.setting.findUnique({ where: { key: "assistant.venice" } });
const v = s?.value ?? {};
const reglages = {
  defaultModel: v.defaultModel ?? null,
  fallbackModel: v.fallbackModel ?? null,
  temperature: v.temperature ?? null,
};

const code = `// GÉNÉRÉ depuis la base LOCALE par apps/web/scripts/export-persona-lea.mjs : ne pas éditer à la main.
// Applique en PROD la fiche Léa telle qu'elle est en local (verbatim), aligne le modèle sur celui du local, et remet à
// zéro la conversation de test. Léa ne se démasque jamais (le moteur force le mode illusion pour toute fille).
import { prisma } from "@linkaffipro/db";

const FICHE = ${JSON.stringify(fiche, null, 2)};
const REGLAGES = ${JSON.stringify(reglages, null, 2)};

const lea = await prisma.persona.findFirst({ where: { name: { equals: "Léa", mode: "insensitive" } } });
if (!lea) {
  console.log("PERSONA Léa INTROUVABLE en prod : rien fait.");
  await prisma.$disconnect();
  process.exit(2);
}
const resume = (p) => ({
  identityKind: p.identityKind,
  age: p.age,
  illusion: p.illusion,
  temperature: p.temperature,
  minExchangesBeforeOffer: p.minExchangesBeforeOffer,
  requireInterest: p.requireInterest,
  maxOfferSends: p.maxOfferSends,
  interests: p.interests,
  languages: p.languages,
  personality: p.personality.length,
  tone: p.tone.length,
  extraPrompt: (p.extraPrompt ?? "").length,
  styleExamples: (p.styleExamples ?? "").length,
  botDescription: (p.botDescription ?? "").length,
});
console.log("AVANT :", JSON.stringify(resume(lea)));
const apres = await prisma.persona.update({ where: { id: lea.id }, data: FICHE });
console.log("APRES :", JSON.stringify(resume(apres)));

const setting = await prisma.setting.findUnique({ where: { key: "assistant.venice" } });
if (setting && REGLAGES.defaultModel) {
  const val = setting.value ?? {};
  if (val.defaultModel !== REGLAGES.defaultModel || val.fallbackModel !== REGLAGES.fallbackModel || val.temperature !== REGLAGES.temperature) {
    await prisma.setting.update({
      where: { key: "assistant.venice" },
      data: { value: { ...val, defaultModel: REGLAGES.defaultModel, fallbackModel: REGLAGES.fallbackModel, temperature: REGLAGES.temperature } },
    });
    console.log("MODELE aligne sur le local : " + REGLAGES.defaultModel);
  } else {
    console.log("MODELE deja identique au local : " + REGLAGES.defaultModel);
  }
} else {
  console.log("reglage assistant.venice absent en prod : modele non touche.");
}

const acc = await prisma.telegramUserAccount.findFirst({ where: { status: "ACTIVE" }, select: { botId: true, label: true } });
if (acc?.botId) {
  const conv = await prisma.conversation.findFirst({ where: { botId: acc.botId }, orderBy: { updatedAt: "desc" }, select: { id: true, assistantTurns: true, memberMessages: true, stage: true } });
  console.log("CONVERSATION DE TEST :", JSON.stringify(conv));
  if (conv) {
    const n = await prisma.conversationMessage.deleteMany({ where: { conversationId: conv.id } });
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { assistantTurns: 0, memberMessages: 0, offerSends: 0, stage: "WELCOME", summary: null, styleProfile: {}, facts: [] },
    });
    console.log("conversation de test remise a zero (" + n.count + " messages effaces)");
  }
} else {
  console.log("aucun compte ACTIVE : pas de conversation a remettre a zero");
}
await prisma.$disconnect();
`;

writeFileSync("../../scripts/persona-fille.mjs", code);
console.log("FICHE LOCALE : " + JSON.stringify({ identityKind: fiche.identityKind, age: fiche.age, illusion: fiche.illusion, personality: fiche.personality?.length, tone: fiche.tone?.length, extraPrompt: fiche.extraPrompt?.length, styleExamples: fiche.styleExamples?.length, interests: fiche.interests, languages: fiche.languages, botDescription: fiche.botDescription?.length }));
console.log("REGLAGES LOCAUX : " + JSON.stringify(reglages));
console.log("ecrit : scripts/persona-fille.mjs");
await prisma.$disconnect();

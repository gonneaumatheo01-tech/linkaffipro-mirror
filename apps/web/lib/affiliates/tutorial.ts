/**
 * Mini-tutoriel « Affiliés sur vos canaux » (page Affiliés Link Affi, phase 13) : affiché au premier passage, refermé
 * par « J'ai compris » et mémorisé par utilisateur (`Setting` `affiliates.tutorial.<userId>` = `{ dismissedAt }`),
 * rouvert à la demande (« Revoir le mode d'emploi », `?guide=1`). Les cinq points reprennent la section du guide.
 */
import { prisma, toJsonValue } from "@linkaffipro/db";

export const TUTORIAL_TITLE = "Affiliés sur vos canaux : comment ça marche";

/** Les cinq étapes (cahier des charges § 7), en mots simples. */
export const TUTORIAL_STEPS: ReadonlyArray<{ title: string; text: string }> = [
  {
    title: "Coller les deux clés dans Link Affi (une seule fois)",
    text: "Un administrateur les crée dans Réglages → Connexions → Link Affi → « Campagnes Telegram des affiliés », puis les colle dans les secrets de Link Affi.",
  },
  {
    title: "Créer la campagne dans Link Affi",
    text: "Dans Link Affi, Campagnes → nouvelle campagne de type Telegram pour l'affilié, puis choisissez le canal. Elle apparaît ici toute seule.",
  },
  {
    title: "L'affilié partage son lien",
    text: "Il diffuse son lien Link Affi comme d'habitude : les personnes arrivent sur votre canal avec une demande d'adhésion, et vos règles d'entrée s'appliquent.",
  },
  {
    title: "Suivre ses membres ici et dans Link Affi",
    text: "Ici : demandes, présents, clics sur les offres, premiers dépôts et revenu net, par affilié et par campagne. Dans Link Affi : la partie Joueurs.",
  },
  {
    title: "Premier affilié gagne, et les boutons d'offre seulement",
    text: "Un membre déjà rattaché ou déjà dans le canal ne change pas d'affilié. Seuls les boutons d'offre du bot créditent l'affilié : un message publié par votre compte Telegram (sans boutons) ne le peut pas.",
  },
];

export function tutorialKey(userId: string): string {
  return `affiliates.tutorial.${userId}`;
}

/** Le tutoriel a-t-il été refermé ? (valeur illisible : non, il s'affiche) */
export function isTutorialDismissed(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const at = (value as { dismissedAt?: unknown }).dismissedAt;
  return typeof at === "string" && Number.isFinite(Date.parse(at));
}

/** Faut-il montrer le tutoriel ? Au premier passage, ou quand l'adresse le redemande (`guide=1`). */
export function showTutorial(dismissed: boolean, guideParam: unknown): boolean {
  const g = Array.isArray(guideParam) ? guideParam[0] : guideParam;
  return !dismissed || g === "1";
}

export async function loadTutorialDismissed(userId: string): Promise<boolean> {
  const row = await prisma.setting
    .findUnique({ where: { key: tutorialKey(userId) } })
    .catch(() => null);
  return isTutorialDismissed(row?.value);
}

export async function dismissTutorial(userId: string, now = new Date()): Promise<void> {
  const key = tutorialKey(userId);
  const value = toJsonValue({ dismissedAt: now.toISOString() });
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

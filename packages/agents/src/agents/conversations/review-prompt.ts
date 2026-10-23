/**
 * Consignes de la relecture d'un échantillon de conversations par le modèle rapide. L'IA lit des échanges déjà
 * anonymisés et des chiffres déjà calculés ; elle ne décide de rien : le code valide sa sortie et borne ses propositions.
 */
import type { ConversationProfileStats } from "../../algo/contracts";
import type { SampleConversation } from "./sample";

export const REVIEW_TASK = "conversations";

export const REVIEW_SYSTEM = `Tu analyses des conversations privées d'un profil de discussion (persona) avec des membres d'une communauté Telegram.
Les échanges sont anonymisés : [prénom], [numéro], [mail], [lien], [pseudo], [adresse] remplacent les données personnelles.
But : dire ce qui obtient une réponse, ce qui fait fuir, où les gens décrochent, et proposer au plus 3 réglages.

Règles absolues :
- Réponds UNIQUEMENT par un objet JSON, sans texte autour, sans bloc de code.
- Chaque élément fait MOINS de 80 caractères : un motif ou une tournure courte, jamais un message recopié en entier.
- Aucun prénom, numéro, adresse, lien ni pseudo, même masqué.
- Propositions possibles, et seulement celles-ci :
  - "styleExamples" : 1 à 3 courts exemples d'échange à AJOUTER au registre (format « lui: … / moi: … », moins de 80 caractères chacun) ;
  - "minExchangesBeforeOffer" : nombre entier de messages de la personne avant le lien (1 à 20) ;
  - "followUpAfterHours" : heures de silence avant la première relance (4 à 168) ;
  - "followUpsMax" : nombre de relances (0 à 2).
- Ne propose JAMAIS de changer l'identité, l'âge, le mode illusion, les règles adultes, l'arrêt (/stop), l'offre ou le texte du prompt.
- Chaque proposition a une raison courte appuyée sur les chiffres fournis (taux de réponse, messages avant le lien, inscriptions).
- Si rien n'est clair, renvoie des listes vides.

Format exact :
{"hooks":["…"],"repellents":["…"],"dropReasons":["…"],"proposals":[{"field":"minExchangesBeforeOffer","value":5,"reason":"…"}]}`;

export type PersonaSettingsView = {
  minExchangesBeforeOffer: number;
  followUpAfterHours: number;
  followUpsMax: number;
  styleExamplesCount: number;
};

const pct = (r: number | null) => (r === null ? "inconnu" : `${Math.round(r * 100)} %`);

/** Message utilisateur : chiffres du profil, réglages actuels, échantillon anonymisé (aucun identifiant). */
export function buildReviewUser(p: ConversationProfileStats, persona: PersonaSettingsView, sample: readonly SampleConversation[]): string {
  const figures = [
    `Conversations (30 jours) : ${p.conversations}`,
    `Taux de réponse au premier message : ${pct(p.replyRate)}`,
    `Messages de la personne avant le lien (médiane) : ${p.medianMessagesBeforeLink ?? "inconnu"}`,
    `Étape où les gens décrochent le plus : ${p.dropStage ?? "inconnue"}`,
    `Liens envoyés : ${p.linksSent}, ouverts : ${p.clicks}, inscriptions : ${p.registrations}, premiers dépôts : ${p.ftds}`,
  ];
  const settings = [
    `minExchangesBeforeOffer = ${persona.minExchangesBeforeOffer}`,
    `followUpAfterHours = ${persona.followUpAfterHours}`,
    `followUpsMax = ${persona.followUpsMax}`,
    `exemples de style déjà présents : ${persona.styleExamplesCount}`,
  ];
  const convs = sample.map((c) => {
    const head = `${c.n} (réponse : ${c.replied ? "oui" : "non"}, lien : ${c.linkSent ? "oui" : "non"}, inscrit : ${c.converted ? "oui" : "non"}, étape : ${c.stage})`;
    return [head, ...c.messages.map((m) => `  ${m.who === "personne" ? "lui" : "moi"}: ${m.text}`)].join("\n");
  });
  return [
    `Tâche : ${REVIEW_TASK}`,
    "",
    "Chiffres du profil :",
    ...figures.map((f) => `- ${f}`),
    "",
    "Réglages actuels :",
    ...settings.map((s) => `- ${s}`),
    "",
    `Échantillon (${sample.length} conversations, « moi » = le profil) :`,
    ...convs,
  ].join("\n");
}

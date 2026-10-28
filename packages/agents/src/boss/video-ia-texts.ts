/**
 * Textes fixes de Kevin pour le remplacement d'une personne dans une vidéo par une persona (« mets Léa à la place de
 * la personne dans cette vidéo »). Tous passent `voiceCheck` (test `voice.test.ts`, toutes les tables `*_VARIANTS`).
 * Jamais le nom du fournisseur ni un mot technique : on dit « le remplacement ».
 */
import { voiceTemplate, type VoiceTable } from "./voice";

type Named = { name: string };
type Summary = { name: string; duration: string; cost: string; remaining: string };

export const VIDEO_IA_VARIANTS = {
  noVideo: [
    "Envoie-moi d'abord la vidéo, puis redis-moi qui mettre à la place.",
    "Il me faut la vidéo d'abord : envoie-la ici, puis redis-moi qui mettre dedans.",
  ],
  tooLong: voiceTemplate<{ duration: string; max: string }>([{ duration: "47 s", max: "15 s" }], (p) => [
    `Ta vidéo dure ${p.duration} : je remplace la personne sur ${p.max} au plus. Coupe-la plus court et renvoie-la-moi.`,
    `${p.duration}, c'est trop long pour le remplacement (${p.max} au plus). Envoie-moi un passage plus court.`,
  ]),
  noReference: voiceTemplate<Named>([{ name: "Léa" }], (p) => [
    `Il me faut une photo de référence de ${p.name} : ajoute-la dans sa fiche (Conversations → Personas → Médias du personnage).`,
    `${p.name} n'a pas encore de photo de référence. Ajoute-en une dans sa fiche (Conversations → Personas), puis redemande-moi.`,
  ]),
  noKey: [
    "La clé du service de vidéo n'est pas enregistrée. Ajoute-la dans Agents → Réglages, puis redemande-moi.",
    "Je n'ai pas la clé du service de vidéo. Elle se met dans Agents → Réglages ; redemande-moi ensuite.",
  ],
  budget: voiceTemplate<{ spent: string; cost: string; cap: string }>([{ spent: "95 €", cost: "1,50 €", cap: "100 €" }], (p) => [
    `Le plafond vidéo du mois est presque atteint : ${p.spent} dépensés sur ${p.cap}, et celle-ci coûterait environ ${p.cost}. Tu peux le monter dans Agents → Rencontres.`,
    `Pas assez de place dans le plafond vidéo du mois (${p.spent} sur ${p.cap}, il faudrait ${p.cost}). Le plafond se règle dans Agents → Rencontres.`,
  ]),
  busy: [
    "Un remplacement est déjà en cours. Attends qu'il soit fini, ou dis « annule le remplacement ».",
    "J'en ai déjà un en route. Je te l'envoie dès qu'il est prêt ; « annule le remplacement » pour l'arrêter.",
  ],
  summary: voiceTemplate<Summary>([{ name: "Léa", duration: "12 s", cost: "0,95 €", remaining: "85 €" }], (p) => [
    `Je mets ${p.name} à la place de la personne dans ta vidéo de ${p.duration}. Coût estimé ${p.cost}, il reste ${p.remaining} dans le plafond vidéo du mois. La vidéo arrive ici seulement, rien n'est publié.`,
  ]),
  summaryNoCap: voiceTemplate<Omit<Summary, "remaining">>([{ name: "Léa", duration: "12 s", cost: "0,95 €" }], (p) => [
    `Je mets ${p.name} à la place de la personne dans ta vidéo de ${p.duration}. Coût estimé ${p.cost}. La vidéo arrive ici seulement, rien n'est publié.`,
  ]),
  launched: voiceTemplate<Named>([{ name: "Léa" }], (p) => [
    `C'est lancé. Je t'envoie la vidéo avec ${p.name} dès qu'elle est prête, en général moins de 10 minutes.`,
    `Je m'en occupe : la vidéo avec ${p.name} arrive ici dans quelques minutes.`,
  ]),
  launchFailed: [
    "Je n'ai pas réussi à lancer le remplacement. Réessaie dans un instant.",
    "Le remplacement n'a pas pu démarrer, réessaie dans un instant.",
  ],
  ready: voiceTemplate<Named>([{ name: "Léa" }], (p) => [`✅ La vidéo avec ${p.name} est prête. Elle reste ici, rien n'est publié.`]),
  failed: voiceTemplate<Named>([{ name: "Léa" }], (p) => [
    `Le remplacement avec ${p.name} n'a pas abouti. Rien n'est publié ; tu peux réessayer avec une autre vidéo.`,
    `Raté pour la vidéo avec ${p.name} : le remplacement n'a pas marché. Essaie avec une vidéo où la personne se voit bien.`,
  ]),
  timedOut: voiceTemplate<Named>([{ name: "Léa" }], (p) => [
    `La vidéo avec ${p.name} n'est toujours pas prête après 15 minutes : j'arrête là. Tu peux relancer quand tu veux.`,
  ]),
  interrupted: [
    "Le remplacement a été coupé pendant son lancement. Rien n'est publié ; redemande-moi pour relancer.",
  ],
  sourceUnreadable: [
    "Je n'arrive plus à récupérer ta vidéo. Renvoie-la-moi, puis redis-moi qui mettre dedans.",
  ],
  status: voiceTemplate<Named & { since: string }>([{ name: "Léa", since: "4 min" }], (p) => [
    `Le remplacement avec ${p.name} tourne depuis ${p.since}. Je t'envoie la vidéo dès qu'elle est prête.`,
    `En cours depuis ${p.since} pour ${p.name}. Je te préviens dès que c'est fini.`,
  ]),
  statusWaiting: voiceTemplate<Named>([{ name: "Léa" }], (p) => [`Le remplacement avec ${p.name} va démarrer, il est en attente de lancement.`]),
  none: ["Aucun remplacement en cours.", "Je n'ai pas de remplacement en route."],
  cancelled: ["C'est arrêté. Rien n'a été facturé.", "Remplacement annulé, rien n'a été facturé."],
  cancelledBilled: voiceTemplate<{ cost: string }>([{ cost: "0,95 €" }], (p) => [
    `C'est arrêté. Le service n'a pas confirmé l'arrêt à temps : je compte ${p.cost} dans le plafond vidéo.`,
  ]),
} satisfies VoiceTable;

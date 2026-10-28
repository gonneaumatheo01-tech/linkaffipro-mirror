/**
 * Règles pures : la phrase demande-t-elle de mettre une persona à la place de la personne d'une vidéo, l'état ou
 * l'arrêt du remplacement ? Sans dépendance (lues aussi par la réception des vidéos du montage).
 */
import { normalizeText } from "../human/answer";

const REPLACE_WORDS = /(?:a la place (?:de|du|d')|remplac\w*|swap\w*)/;
const VIDEO_WORDS = /(?:^|[^\p{L}])(?:video|vid|personne|mec|fille|gars|femme|homme|type|nana|meuf|danseu\w*|influenceu\w*)(?:[^\p{L}]|$)/u;
const OTHER_TOPICS = /(?:^|[^\p{L}])(?:canal|chaine|groupe|lien|offre|plan|post|message|texte|catalogue|cote)(?:[^\p{L}]|$)/u;
const STATUS_WORDS = /(?:ou en est|ou en sont|ca avance|avancement|statut|etat) (?:le |du |de mon )?remplacement/;
const CANCEL_WORDS = /(?:annule|annuler|arrete|arreter|stoppe|stop|laisse tomber|abandonne)(?:-le| le| la| ce| mon)? remplacement/;

export type VideoIaIntent = "replace" | "status" | "cancel";

/**
 * Que demande la phrase (pur) ? `replace` (« mets Léa à la place de la personne dans cette vidéo », « remplace la fille
 * par Léa »), `status` (« où en est le remplacement ? »), `cancel` (« annule le remplacement »), sinon null. Une phrase
 * qui parle d'un canal, d'un lien, d'un post… n'est jamais prise (« remplace Léa par Emma sur le canal »).
 */
export function videoIaIntentOf(text: string): VideoIaIntent | null {
  const t = normalizeText(text).trim();
  if (!t) return null;
  if (CANCEL_WORDS.test(t)) return "cancel";
  if (STATUS_WORDS.test(t)) return "status";
  if (REPLACE_WORDS.test(t) && VIDEO_WORDS.test(t) && !OTHER_TOPICS.test(t)) return "replace";
  return null;
}

export function looksLikeReplaceRequest(text: string): boolean {
  return videoIaIntentOf(text) === "replace";
}

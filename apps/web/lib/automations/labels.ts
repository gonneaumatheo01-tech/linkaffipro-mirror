/**
 * Libellés des blocs d'une relance pour l'écran (canevas, liste des blocs, tableau « par bloc », journal) : les mots
 * remplacés par le bot ({prenom}, {canal}, {bot}) sont montrés avec les exemples de l'aperçu (« Bonjour Léa »), jamais
 * en jeton brut, et une phrase n'imbrique jamais deux niveaux de guillemets. Fonctions pures (labels.test.ts).
 */
import {
  GRAPH_SEQUENCE_LABELS,
  describeAction,
  describeCondition,
  formatWaitHours,
  type GraphAction,
  type GraphNames,
  type GraphNode,
} from "@linkaffipro/core";
import { fillMessageExamples } from "./node-form";

/** Longueur d'un aperçu de message dans un libellé. */
const EXCERPT_MAX = 44;

/** Aperçu d'un texte : mise en forme retirée, mots remplacés par les exemples, espaces resserrés, coupé (« … »). */
export function messageExcerpt(text: string, max = EXCERPT_MAX): string {
  const plain = fillMessageExamples(text)
    .replace(/<[^>]*>/g, "")
    .replace(/&(lt|gt|amp|quot|#39);/g, (_m, e: string) =>
      e === "lt" ? "<" : e === "gt" ? ">" : e === "amp" ? "&" : e === "quot" ? '"' : "'",
    )
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

/** Ce que fait une action, en une ligne (« Message : Bonjour Léa, … », « Étiqueter « vip » »). */
export function actionLabel(a: GraphAction, names: GraphNames = {}): string {
  switch (a.type) {
    case "send_message":
      return `Message : ${messageExcerpt(a.text)}`;
    case "notify_team":
      return `Prévenir l'équipe : ${messageExcerpt(a.text)}`;
    default:
      return describeAction(a, names);
  }
}

/** Libellé d'un bloc validé (« Attendre 1 jour », « A déjà déposé ? », « Message : Bonjour Léa… »). */
export function nodeTitle(node: GraphNode, names: GraphNames = {}): string {
  switch (node.type) {
    case "trigger":
      return "Départ";
    case "stop":
      return "Arrêter";
    case "wait":
      return `Attendre ${formatWaitHours(node.hours)}`;
    case "condition":
      return describeCondition(node.condition, names);
    case "action":
      return actionLabel(node.action, names);
  }
}

function actionPhrase(a: GraphAction, names: GraphNames): string {
  switch (a.type) {
    case "send_message":
      return `le message « ${messageExcerpt(a.text)} »`;
    case "notify_team":
      return `la note à l'équipe « ${messageExcerpt(a.text)} »`;
    case "tag":
      return `l'étiquette « ${a.tag} »`;
    case "suggest_channel":
      return `la proposition du canal « ${names.channels?.[a.channelId] ?? "canal supprimé"} »`;
    case "send_sequence":
      return `le message du bot « ${GRAPH_SEQUENCE_LABELS[a.trigger]} »`;
  }
}

/**
 * Le bloc dans une phrase (« En attente avant le message « Bonjour Léa… » », « Arrêtée sur l'étiquette « vip » ») :
 * un seul niveau de guillemets.
 */
export function nodePhrase(node: GraphNode, names: GraphNames = {}): string {
  switch (node.type) {
    case "trigger":
      return "le départ";
    case "stop":
      return "l'arrêt";
    case "wait":
      return `l'attente de ${formatWaitHours(node.hours)}`;
    case "condition":
      return `la question « ${describeCondition(node.condition, names)} »`;
    case "action":
      return actionPhrase(node.action, names);
  }
}

/** « de » devant une phrase de bloc, avec la contraction française (« du message », « de l'attente »). */
export function fromPhrase(phrase: string): string {
  if (phrase.startsWith("le ")) return `du ${phrase.slice(3)}`;
  if (phrase.startsWith("les ")) return `des ${phrase.slice(4)}`;
  return `de ${phrase}`;
}

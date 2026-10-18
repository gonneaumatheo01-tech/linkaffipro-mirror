// Parcours de la conversation (contrat §3.4) : le modèle PROPOSE une étape, le code DÉCIDE. Le lien part seulement
// quand les règles de la persona le permettent et que le modèle le propose ; jamais au premier message de l'assistant.
import type { ConversationStage } from "./types";

/** Intérêt minimal (sur 10) quand la persona exige un intérêt détecté. */
export const OFFER_INTEREST_THRESHOLD = 6;
/** Bornes de `Persona.maxOfferSends`. */
export const MAX_OFFER_SENDS_LIMIT = 3;

export type OfferConversation = {
  memberMessages: number;
  offerSends: number;
  isMinor: boolean;
  isFirstAssistantTurn: boolean;
};

export type OfferPersona = {
  minExchangesBeforeOffer: number;
  requireInterest: boolean;
  maxOfferSends: number;
  hasOffer: boolean;
};

export type OfferProposal = { send_offer: boolean; style_update: { interest: number } };

/** Nombre d'envois du lien permis par conversation (1 à 3). */
export function offerSendsAllowed(persona: Pick<OfferPersona, "maxOfferSends">): number {
  const n = Math.round(persona.maxOfferSends);
  return Math.min(MAX_OFFER_SENDS_LIMIT, Math.max(1, Number.isFinite(n) ? n : 1));
}

/**
 * Le lien POURRAIT-il partir à ce tour (tout sauf l'avis du modèle) ? Offre liée, pas un mineur, pas le premier message
 * de l'assistant, pas une relance, assez de messages de la personne, nombre d'envois non atteint.
 */
export function offerAllowedNow(
  conv: OfferConversation,
  persona: OfferPersona,
  kind: "reply" | "follow_up" = "reply",
): boolean {
  if (!persona.hasOffer || conv.isMinor || conv.isFirstAssistantTurn || kind !== "reply")
    return false;
  if (conv.memberMessages < Math.max(1, Math.round(persona.minExchangesBeforeOffer))) return false;
  return conv.offerSends < offerSendsAllowed(persona);
}

/**
 * `canSendOffer` (contrat §3.4) : le modèle propose (`send_offer`), l'intérêt est suffisant si la persona l'exige, et
 * toutes les règles de `offerAllowedNow` sont remplies. Jamais au premier message, jamais dans une relance.
 */
export function canSendOffer(
  conv: OfferConversation,
  persona: OfferPersona,
  output: OfferProposal,
  kind: "reply" | "follow_up" = "reply",
): boolean {
  if (!output.send_offer) return false;
  if (persona.requireInterest && output.style_update.interest < OFFER_INTEREST_THRESHOLD)
    return false;
  return offerAllowedNow(conv, persona, kind);
}

const RANK: Record<ConversationStage, number> = {
  WELCOME: 0,
  CHAT: 1,
  PROPOSAL: 2,
  LINK_SENT: 3,
  FOLLOW_UP: 3,
  CONVERTED: 5,
  CLOSED: 6,
};

/**
 * Étape après un tour envoyé. Règles :
 * - CONVERTED et CLOSED ne changent pas ici (conversion et fermeture sont décidées ailleurs par le code) ;
 * - lien réellement parti → LINK_SENT ; relance → FOLLOW_UP ;
 * - premier message de l'assistant → WELCOME ;
 * - sinon l'avis du modèle n'est retenu que pour CHAT ou PROPOSAL, sans jamais revenir en arrière (après une relance :
 *   LINK_SENT si le lien était déjà parti, sinon au moins CHAT).
 */
export function decideStage(input: {
  current: ConversationStage;
  proposed: ConversationStage | null;
  offerSent: boolean;
  kind: "reply" | "follow_up";
  isFirstAssistantTurn: boolean;
  offerSendsBefore: number;
}): ConversationStage {
  const { current } = input;
  if (current === "CONVERTED" || current === "CLOSED") return current;
  if (input.offerSent) return "LINK_SENT";
  if (input.kind === "follow_up") return "FOLLOW_UP";
  if (input.isFirstAssistantTurn) return "WELCOME";
  let base: ConversationStage = current;
  if (current === "FOLLOW_UP") base = input.offerSendsBefore > 0 ? "LINK_SENT" : "CHAT";
  if (base === "WELCOME") base = "CHAT";
  const proposed =
    input.proposed === "CHAT" || input.proposed === "PROPOSAL" ? input.proposed : null;
  return proposed && RANK[proposed] > RANK[base] ? proposed : base;
}

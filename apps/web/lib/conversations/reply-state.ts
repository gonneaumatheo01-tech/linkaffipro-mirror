/**
 * L'assistante répondra-t-elle vraiment à cette personne ? (phase 17, boîte de réception et fiche d'une conversation).
 * Une conversation « L'assistante répond » (statut BOT) peut rester sans réponse : le webhook enregistre les messages
 * de tout le monde et ne bloque que la réponse. Même règle que `assistantMayReply` du webhook
 * (`packages/telegram/src/handlers/assistant.ts`) et que le contrôle du worker avant l'appel : bot en mode assistant,
 * persona de la conversation (sinon celle du bot) active, activation (désactivé / équipe / tout le monde), plus le bot
 * actif (un bot désactivé ne reçoit plus rien). Règles pures (testées) ; la vérification « compte de l'équipe » est
 * faite par l'appelant avec `isAssistantTeamMember`, seulement quand l'activation est « Seulement l'équipe ».
 */
import { canAssistantReply, type AssistantActivation } from "@linkaffipro/chat";

export type ReplyBlock =
  | "activation_off"
  | "bot_inactive"
  | "not_assistant_bot"
  | "no_persona"
  | "persona_inactive"
  | "team_only";

export type ReplyCheck = {
  activation: AssistantActivation;
  botActive: boolean;
  /** `Bot.mode` : « ASSISTANT » ou « STANDARD ». */
  botMode: string;
  /** Persona de la conversation, sinon celle du bot : active ou non ; null s'il n'y en a aucune. */
  personaActive: boolean | null;
  /** Compte de l'équipe (n'a d'effet qu'avec l'activation « Seulement l'équipe »). */
  isTeamMember: boolean;
};

/** Pourquoi personne ne répondra à cette personne si la conversation est laissée à l'assistante ; null : elle répond. */
export function replyBlock(c: ReplyCheck): ReplyBlock | null {
  if (c.activation === "off") return "activation_off";
  if (!c.botActive) return "bot_inactive";
  if (c.botMode !== "ASSISTANT") return "not_assistant_bot";
  if (c.personaActive === null) return "no_persona";
  if (!c.personaActive) return "persona_inactive";
  if (!canAssistantReply(c.activation, { isTeamMember: c.isTeamMember })) return "team_only";
  return null;
}

/** Raison en clair (fin de phrase, sans majuscule ni point), avec l'endroit où la régler. */
export function replyBlockReason(code: ReplyBlock): string {
  switch (code) {
    case "activation_off":
      return "l'assistant de conversation est désactivé (Réglages → IA de conversation)";
    case "bot_inactive":
      return "le bot de cette conversation est désactivé (Réglages → Bots)";
    case "not_assistant_bot":
      return "ce bot n'est plus en mode assistant (Réglages → Bots)";
    case "no_persona":
      return "aucune persona n'est liée à ce bot (Réglages → Bots)";
    case "persona_inactive":
      return "la persona de cette conversation est désactivée (onglet Personas)";
    case "team_only":
      return "l'essai est limité aux comptes de l'équipe, et cette personne n'en fait pas partie (Réglages → IA de conversation)";
  }
}

/** Raison en phrase complète (majuscule, point final), pour le survol de la pastille « Personne ne répond ». */
export function replyBlockTitle(code: ReplyBlock): string {
  const r = replyBlockReason(code);
  return `${r.charAt(0).toLocaleUpperCase("fr")}${r.slice(1)}.`;
}

/** Phrase de la fiche quand la conversation est laissée à l'assistante mais que personne ne répondra. */
export function nobodyRepliesSentence(code: ReplyBlock): string {
  return `Personne ne répond pour l'instant : ${replyBlockReason(code)}. Prenez la main pour lui répondre vous-même.`;
}

/** Avertissement de la fiche quand l'équipe a la main (ou a fermé) : rendre la main ne ferait répondre personne. */
export function releaseWarning(code: ReplyBlock): string {
  return `En rendant la main, personne ne répondra : ${replyBlockReason(code)}.`;
}

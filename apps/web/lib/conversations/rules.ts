/**
 * Règles de la reprise en main d'une conversation par l'équipe (phase 17, contrat docs/ASSISTANT-CONVERSATION.md § 6) :
 * qui peut quoi selon l'état de la conversation, pourquoi un envoi est impossible (phrase prête à afficher), étape
 * retrouvée à la réouverture, contrôle du texte d'un message de l'équipe. Règles pures (testées), partagées par les
 * actions serveur, la page et la route du fil en direct.
 */
import type { ConversationStage, ConversationStatus } from "@linkaffipro/db";
import { assistantWord, TEAM_CLOSED_REASON } from "./labels";

/** Longueur maximale d'un message de l'équipe (Telegram : 4 096 caractères ; marge pour l'échappement). */
export const TEAM_MESSAGE_MAX = 4000;

/** Préfixe du repère posé sur les messages reçus pendant la reprise en main (ils ne reçoivent pas de réponse). */
export const TEAM_TURN_PREFIX = "team-";

/** Repère des messages reçus pendant la reprise : `team-<horodatage>` (jamais pris par l'assistant ensuite). */
export function teamTurnId(now: Date): string {
  return `${TEAM_TURN_PREFIX}${now.getTime()}`;
}

export type ConversationRuleInput = {
  status: ConversationStatus;
  stoppedAt: Date | null;
  isMinor: boolean;
  closedReason: string | null;
  /** La personne a bloqué le bot (`MemberBotState.blockedAt`). */
  memberBlocked: boolean;
  /** Le bot de la conversation est actif. */
  botActive: boolean;
};

export type SendLockCode =
  "stopped" | "minor" | "team_blocked" | "member_blocked" | "unreachable" | "bot_inactive";

export type SendLock = { code: SendLockCode; message: string };

/** Conversation définitivement close : /stop, mineur ou bloquée par l'équipe. Plus aucune action possible. */
export function isFinal(
  c: Pick<ConversationRuleInput, "status" | "stoppedAt" | "isMinor" | "closedReason">,
): boolean {
  return Boolean(c.stoppedAt) || c.isMinor || (c.status === "CLOSED" && c.closedReason === "TEAM");
}

/** Fermée parce que la personne a bloqué le bot ou ne peut plus être jointe : elle reprend si la personne réécrit. */
export function isPersonGone(c: Pick<ConversationRuleInput, "status" | "closedReason">): boolean {
  return (
    c.status === "CLOSED" && (c.closedReason === "BLOCKED" || c.closedReason === "UNREACHABLE")
  );
}

/** Pourquoi aucun message ne peut partir vers cette personne (phrase prête à afficher), ou null si l'envoi est permis. */
export function sendLock(c: ConversationRuleInput): SendLock | null {
  if (c.stoppedAt)
    return {
      code: "stopped",
      message:
        "Cette personne a demandé l'arrêt (/stop) : plus aucun message ne peut lui être envoyé.",
    };
  if (c.isMinor)
    return {
      code: "minor",
      message:
        "Cette personne a dit avoir moins de 18 ans : la conversation est fermée et plus aucun message ne peut lui être envoyé.",
    };
  if (c.status === "CLOSED" && c.closedReason === "TEAM")
    return {
      code: "team_blocked",
      message:
        "Cette conversation a été bloquée par l'équipe : plus aucun message ne peut lui être envoyé.",
    };
  if (c.memberBlocked || (c.status === "CLOSED" && c.closedReason === "BLOCKED"))
    return {
      code: "member_blocked",
      message:
        "Cette personne a bloqué le bot : impossible de lui écrire. Si elle réécrit au bot, la conversation reprend.",
    };
  if (c.status === "CLOSED" && c.closedReason === "UNREACHABLE")
    return {
      code: "unreachable",
      message:
        "Le bot ne peut plus écrire à cette personne. Si elle réécrit au bot, la conversation reprend.",
    };
  if (!c.botActive)
    return {
      code: "bot_inactive",
      message:
        "Le bot de cette conversation est désactivé (Réglages → Bots) : aucun message ne peut partir.",
    };
  return null;
}

export type ConversationActions = {
  /** « Prendre la main » : l'assistante se tait, l'équipe écrit. */
  takeOver: boolean;
  /** « Rendre à l'assistante ». */
  release: boolean;
  /** « Fermer » (sans bloquer). */
  close: boolean;
  /** « Bloquer » : plus aucun envoi possible, définitivement. */
  block: boolean;
  /** Envoi d'un message par l'équipe. */
  send: boolean;
  /** Raison pour laquelle rien ne peut partir (null si l'envoi est permis). */
  lock: SendLock | null;
};

/**
 * Actions possibles sur une conversation :
 * - /stop, mineur ou bloquée par l'équipe : rien (définitif) ;
 * - fermée parce que la personne a bloqué le bot (ou ne peut plus être jointe) : seulement « Bloquer » (elle reprendrait
 *   sinon toute seule si la personne réécrit) ;
 * - sinon : prendre la main (si l'équipe ne l'a pas déjà), la rendre (si l'assistante ne l'a pas déjà), fermer (si elle
 *   est ouverte), bloquer ; une conversation fermée par l'équipe se rouvre en prenant ou en rendant la main, ou en
 *   écrivant.
 */
export function conversationActions(c: ConversationRuleInput): ConversationActions {
  const lock = sendLock(c);
  if (isFinal(c))
    return { takeOver: false, release: false, close: false, block: false, send: false, lock };
  const gone = isPersonGone(c);
  return {
    takeOver: !gone && c.status !== "HUMAN",
    release: !gone && c.status !== "BOT",
    close: c.status !== "CLOSED",
    block: true,
    send: lock === null,
    lock,
  };
}

/** Raison pour laquelle une action est refusée (phrase), pour le retour d'une action serveur. */
export function refusalFor(
  action: "takeOver" | "release" | "close" | "block" | "send",
  c: ConversationRuleInput,
  assistant: string,
): string {
  const lock = sendLock(c);
  if (isFinal(c) && lock) return lock.message;
  if (isPersonGone(c) && lock && action !== "block") return lock.message;
  switch (action) {
    case "takeOver":
      return "L'équipe a déjà la main sur cette conversation.";
    case "release":
      return `C'est déjà ${assistant} qui répond dans cette conversation.`;
    case "close":
      return "Cette conversation est déjà fermée.";
    case "block":
      return "Cette conversation est déjà bloquée.";
    case "send":
      return lock?.message ?? "Impossible d'envoyer un message dans cette conversation.";
  }
}

/** Le statut est-il fermé « de façon réversible » (fermée par l'équipe, ou raison inconnue) ? */
export function isReopenableByTeam(
  c: Pick<ConversationRuleInput, "status" | "closedReason" | "stoppedAt" | "isMinor">,
): boolean {
  return (
    c.status === "CLOSED" &&
    !c.stoppedAt &&
    !c.isMinor &&
    c.closedReason !== "TEAM" &&
    c.closedReason !== "BLOCKED" &&
    c.closedReason !== "UNREACHABLE"
  );
}

/**
 * Étape d'une conversation rouverte par l'équipe : celle d'avant la fermeture (dernier passage vers « Fermée »), sinon
 * « Discussion » si l'assistante a déjà répondu, sinon « Accueil » (même règle que la réception du bot).
 */
export function reopenStage(input: {
  stageBeforeClose: ConversationStage | null;
  assistantTurns: number;
}): ConversationStage {
  const before = input.stageBeforeClose;
  if (before && before !== "CLOSED") return before;
  return input.assistantTurns > 0 ? "CHAT" : "WELCOME";
}

export { TEAM_CLOSED_REASON };

/**
 * Dernier message parti vers la personne, au sens des relances du worker (`Conversation.lastAssistantAt`), quand
 * l'équipe rend la main : le plus récent entre celui déjà noté (assistante) et le dernier message sortant du fil
 * (souvent celui de l'équipe). Sans lui, le worker annulerait la relance (« la personne a écrit depuis le dernier
 * message de l'assistante ») alors que l'équipe lui a répondu.
 */
export function lastSentAt(lastAssistantAt: Date | null, lastOutCreatedAt: Date): Date {
  return lastAssistantAt && lastAssistantAt.getTime() > lastOutCreatedAt.getTime()
    ? lastAssistantAt
    : lastOutCreatedAt;
}

/** Refus de « Rendre » quand un tour de l'assistante tient encore la conversation (rien n'a changé). */
export function busyRefusal(gender: string | null | undefined): string {
  const word = assistantWord(gender);
  return `${word.charAt(0).toUpperCase()}${word.slice(1)} finit de traiter un message de cette conversation : réessayez dans quelques secondes.`;
}

export type TeamTextCheck = { ok: true; text: string } | { ok: false; error: string };

/** Texte d'un message de l'équipe : non vide, 4 000 caractères au plus (espaces de début et de fin retirés). */
export function checkTeamText(raw: unknown): TeamTextCheck {
  const text = typeof raw === "string" ? raw.replace(/\r\n?/g, "\n").trim() : "";
  if (!text) return { ok: false, error: "Écrivez un message avant de cliquer sur « Envoyer »." };
  const length = [...text].length;
  if (length > TEAM_MESSAGE_MAX)
    return {
      ok: false,
      error: `Message trop long : ${TEAM_MESSAGE_MAX.toLocaleString("fr-FR")} caractères au plus (il en fait ${length.toLocaleString("fr-FR")}).`,
    };
  return { ok: true, text };
}

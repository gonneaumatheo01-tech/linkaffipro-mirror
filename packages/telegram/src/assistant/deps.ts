// Dépendances (accès base, file) de la réception par le bot assistant (phase 17, contrat § 4), abstraites pour tester le
// handler avec des updates simulées. Implémentation réelle : `prisma-deps.ts`.
import type {
  ChatMedia,
  ConversationStage,
  ConversationStatus,
  FixedTextKey,
} from "@linkaffipro/chat";
import type { User } from "grammy/types";
import type { BotIdentity } from "../ports";

/** Conversation telle que la lit le handler (une par bot et par membre). */
export type AssistantConversation = {
  id: string;
  status: ConversationStatus;
  stage: ConversationStage;
  isMinor: boolean;
  stoppedAt: Date | null;
  /** Raison de la fermeture (STOP, MINOR, TEAM, TEAM_CLOSED, BLOCKED, UNREACHABLE), null si ouverte. */
  closedReason: string | null;
  /** Langue de réponse courante (textes fixes). */
  language: string | null;
  personaId: string | null;
  source: string | null;
};

/** Persona utile à la réception : active ou non, langues et prénom (textes fixes). */
export type AssistantPersonaInfo = {
  id: string;
  name: string;
  gender: string;
  languages: string[];
  isActive: boolean;
};

export interface AssistantDeps {
  /** Repli quand le middleware n'a pas fourni le membre : enregistre (ou met à jour) le membre. */
  memberSeen(bot: BotIdentity, from: User): Promise<{ memberId: string }>;
  /** `/start` : membre démarré sur ce bot (joignable) et événement `member.start`. */
  memberStarted(
    bot: BotIdentity,
    from: User,
    payload: string | undefined,
  ): Promise<{ memberId: string }>;
  /**
   * Conversation (bot, membre), créée si absente (création concurrente gérée). `personaId` : persona du bot, posée au
   * premier message (ou plus tard si elle manquait) ; `source` : premier paramètre de `/start` reçu, jamais écrasé.
   */
  ensureConversation(input: {
    botId: string;
    memberId: string;
    personaId: string | null;
    source: string | null;
  }): Promise<AssistantConversation>;
  /**
   * Conversation fermée seulement parce que l'envoi a échoué (bot bloqué, personne injoignable) et la personne réécrit
   * d'elle-même : elle repart (statut BOT, étape d'avant la fermeture), événement `reopened`. Jamais après un /stop, pour
   * un mineur ni après une fermeture par l'équipe. Renvoie la conversation rouverte, ou null si rien n'a changé.
   */
  reopenConversation(input: {
    conversationId: string;
    botId: string;
    memberId: string;
    at: Date;
  }): Promise<AssistantConversation | null>;
  /** Liaison d'un compte de l'équipe (`/start admin_<jeton>`, Mon compte) : son nom, ou null si le jeton est invalide. */
  linkAdminAccount(token: string, telegramUserId: bigint): Promise<{ name: string } | null>;
  /** Persona (null si elle n'existe plus). */
  persona(personaId: string): Promise<AssistantPersonaInfo | null>;
  /** L'activation (`Setting` `assistant.venice` : off / team / all) permet-elle de répondre à ce compte Telegram ? */
  activationAllows(telegramUserId: bigint): Promise<boolean>;
  /**
   * Message reçu → `ConversationMessage` IN (anti-doublon : une update renvoyée par Telegram est ignorée sans erreur),
   * `lastInboundAt`, relances remises à zéro, `memberMessages + 1` si `countsAsExchange`.
   * `minor` (âge déclaré de moins de 18 ans détecté par le code) : dans la MÊME transaction, conversation marquée
   * mineure et fermée (raison MINOR, sauf fermeture déjà faite), relance et nouvel essai annulés, événements `minor` et
   * `stage_changed`. `minorClosed.wasAnswering` : l'assistante avait la parole (statut BOT, sans /stop) juste avant.
   */
  recordInbound(input: {
    conversationId: string;
    telegramMessageId: number;
    text: string;
    media: ChatMedia | null;
    meta: Record<string, unknown>;
    countsAsExchange: boolean;
    minor?: { age: number | null; botId: string; memberId: string };
    at: Date;
  }): Promise<{ duplicate: boolean; minorClosed?: { wasAnswering: boolean } }>;
  /** Texte fixe envoyé par le bot (author SYSTEM, OUT), pour la boîte de réception. Ne lève jamais. */
  recordFixedReply(input: {
    conversationId: string;
    key: FixedTextKey;
    text: string;
    telegramMessageId: number | null;
    at: Date;
  }): Promise<void>;
  /**
   * `/stop` : définitif (`stoppedAt`, CLOSED `STOP`, plus aucune relance), événements `stopped` (+ `stage_changed`).
   * `changed: false` si la conversation était déjà stoppée.
   */
  stopConversation(input: {
    conversationId: string;
    botId: string;
    memberId: string;
    at: Date;
  }): Promise<{ changed: boolean }>;
  /**
   * `/reset` : messages (jusqu'au /reset compris ; ceux envoyés après par la personne restent), texte des messages
   * envoyés par le bot (`OutboundMessage`), résumé, faits et style effacés, messages encore en file annulés (FAILED, texte
   * vidé : rien ne part après « j'ai tout oublié »), compteurs remis à zéro (sauf les liens envoyés), étape WELCOME (sauf
   * conversation fermée, et CONVERTED si l'inscription est déjà comptée), événement `reset` (portant l'identifiant
   * Telegram du /reset).
   * Fait sous le verrou de la conversation (jamais pendant un tour de l'assistant, attente bornée). `duplicate` : ce
   * /reset a déjà été traité (update renvoyée par Telegram) : rien n'est effacé une seconde fois.
   */
  resetConversation(input: {
    conversationId: string;
    botId: string;
    memberId: string;
    telegramMessageId: number;
    at: Date;
  }): Promise<{ duplicate: boolean }>;
  /**
   * Réserve le texte fixe `stoppedAlready` pour aujourd'hui (jour de Paris) : true la première fois du jour (événement
   * enregistré), false ensuite.
   */
  claimStoppedReply(input: {
    conversationId: string;
    botId: string;
    memberId: string;
    at: Date;
  }): Promise<boolean>;
  /** La personne a bloqué le bot : plus aucune relance prévue (événement `blocked`). Absent : rien. */
  conversationBlocked?(input: { botId: string; telegramUserId: bigint; at: Date }): Promise<void>;
  /** Tour de l'assistant en file (`chat` `turn`, anti-rebond). Jamais d'appel à l'IA dans le webhook. */
  enqueueTurn(conversationId: string): Promise<void>;
}

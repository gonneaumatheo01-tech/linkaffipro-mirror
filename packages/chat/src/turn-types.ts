// Types d'un tour de l'assistant (contrat §3.10) : entrée, dépendances injectées, résultat. La persistance est faite
// par l'appelant (worker, ou bouton « Tester » du site) : le moteur ne lit ni la base ni les réglages.
import type { StyleProfile } from "./style";
import type {
  ChatLang,
  ConversationStage,
  LlmClient,
  LlmUsage,
  UsagePurpose,
  UsageRecord,
} from "./types";

/** Persona telle que le moteur la lit (champs utiles du modèle Prisma `Persona`, contrat §1). */
export type PersonaInput = {
  name: string;
  /** "F" → « l'assistante », "M" → « l'assistant ». */
  gender: string;
  personality: string;
  tone: string;
  /** Codes des 6 langues (fr en es pt de it) ; la première est la langue par défaut. */
  languages: string[];
  interests: string[];
  extraPrompt: string | null;
  /** null = modèle par défaut des réglages. */
  model: string | null;
  /** null = température des réglages. */
  temperature: number | null;
  minExchangesBeforeOffer: number;
  requireInterest: boolean;
  maxOfferSends: number;
  followUpAfterHours: number;
  followUpsMax: number;
  /** Fiche de l'offre : seuls éléments que l'assistant peut dire de l'app. */
  offerPitch: string;
  offerButtonText: string;
  /** Offre Link Affi liée (`affiliateCampaignId` renseigné) : sans offre, jamais de lien. */
  hasOffer: boolean;
  /** Visuel de l'app envoyé avec le lien (photo + légende). */
  offerMediaAssetId: string | null;
  /** Titre du canal dont la persona est l'assistante (facultatif, pour la présentation). */
  channelTitle?: string | null;
  /** Nom du bot (facultatif). */
  botName?: string | null;
};

/** Réglages utiles au tour (lus par l'appelant dans `Setting` `assistant.venice`). */
export type TurnSettings = {
  defaultModel: string;
  fallbackModel: string;
  temperature: number;
  maxTokens: number;
  modelSupportsReasoning(modelId: string): boolean;
};

export type ChatMediaKind = "photo" | "sticker" | "voice" | "video" | "document" | "other";
export type ChatMedia = { kind: ChatMediaKind; mediaAssetId?: string | null };

/** Message de l'historique (ConversationMessage), du plus ancien au plus récent. */
export type HistoryMessage = {
  direction: "IN" | "OUT";
  author: "MEMBER" | "ASSISTANT" | "TEAM" | "SYSTEM";
  text: string;
  media?: ChatMedia | null;
  at?: Date | null;
};

/** Message entrant traité par ce tour (`id` = ConversationMessage, pour que l'appelant les marque). */
export type TurnInbound = { id?: string; text: string; media?: ChatMedia | null; at?: Date | null };

/** État de la conversation au début du tour (lu par l'appelant). */
export type ConversationState = {
  stage: ConversationStage;
  style: StyleProfile;
  summary: string | null;
  facts: string[];
  /** Messages de la personne déjà comptés (y compris ceux de ce tour). */
  memberMessages: number;
  assistantTurns: number;
  offerSends: number;
  followUpCount: number;
  isMinor: boolean;
  /**
   * Aucun message de l'assistant avant ce tour : présentation exigée, jamais de lien. À calculer par l'appelant avec
   * `assistantTurns === 0` (ou l'absence de message OUT de l'assistant), JAMAIS avec l'étape : l'étape reste WELCOME
   * après la présentation tant que la personne n'a pas répondu (pas de relance après la seule présentation).
   */
  isFirstAssistantTurn: boolean;
  /** `Member.languageCode` de Telegram. */
  memberLanguageCode: string | null;
  lastInboundAt?: Date | null;
  lastAssistantAt?: Date | null;
  /** Dernier message « Je reviens vers toi dans un instant » envoyé (au plus un par heure). */
  lastNeutralAt?: Date | null;
};

export type TurnKind = "reply" | "follow_up";

export type TurnInput = {
  kind: TurnKind;
  persona: PersonaInput;
  settings: TurnSettings;
  conversation: ConversationState;
  /** Derniers messages AVANT ce tour (les 20 derniers sont envoyés au modèle), sans les messages entrants du tour. */
  history: HistoryMessage[];
  /** Messages de la personne de ce tour (vide pour une relance). */
  inbound: TurnInbound[];
  /** Plus de 30 messages hors du résumé : un résumé roulant est demandé après les envois. */
  needsSummary?: boolean;
  /** Messages anciens (au-delà des 20 derniers) à fondre dans le résumé. */
  summaryMessages?: HistoryMessage[];
  /** Motif du coût (« TEST » pour le bouton « Tester ») ; sinon REPLY ou FOLLOW_UP selon `kind`. */
  usagePurpose?: UsagePurpose;
  /**
   * Nouveaux essais déjà faits pour ce tour après une panne de l'IA (0 au premier passage) : reprendre
   * `TurnResult.retryCount` du passage précédent ; remettre à 0 quand la personne écrit un nouveau message.
   */
  retryCount?: number;
  /**
   * Résumé roulant laissé à l'appelant (`summarizeAfterTurn`, après l'enregistrement du tour) : le tour rend la main dès
   * le dernier envoi, sans attendre un appel de plus à l'IA (le worker enregistre les faits du tour d'abord).
   */
  deferSummary?: boolean;
};

export type ChatButton = { text: string; url: string };

export type SendResult =
  | { ok: true; telegramMessageId?: number }
  | { ok: false; blocked: boolean; unreachable: boolean; error: string };

/**
 * Options d'un envoi : boutons, et texte fixe envoyé (`minorStop`, `retryLater`… ; absent pour une réponse du modèle).
 * L'envoi du worker s'en sert pour écrire les faits au moment où le message part (tour de réponse compté sauf pour
 * l'arrêt mineur et « je reviens vers toi »).
 */
export type SendOptions = { buttons?: ChatButton[][]; fixedKey?: string | null };

/** Envoi vers la personne (implémenté par le bot, ou par le faux envoi des tests et du « Tester »). Texte brut. */
export type ChatSender = {
  sendTyping(): Promise<void>;
  sendText(text: string, opts?: SendOptions): Promise<SendResult>;
  sendMedia(
    media: { mediaAssetId: string },
    caption: string,
    opts?: SendOptions,
  ): Promise<SendResult>;
};

/** Minuteries du « écrit… » pendant l'appel au modèle (injectables pour les tests). */
export type TypingTimers = {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
};

export type TurnDeps = {
  llm: LlmClient;
  sender: ChatSender;
  now(): Date;
  sleep(ms: number): Promise<void>;
  random(): number;
  /** Crée le lien d'offre suivi (un sub-ID par envoi) : appelé seulement quand le lien part réellement. */
  createOfferLink(): Promise<{ url: string; subId: string } | null>;
  /** Relu juste avant le premier envoi : reprise par l'équipe (abort) ou messages arrivés pendant la préparation. */
  beforeSend(): Promise<{ abort: boolean; newInbound: TurnInbound[] }>;
  recordUsage(u: UsageRecord): Promise<void>;
  /** Plafond mensuel atteint ? Vérifié avant CHAQUE appel au modèle. */
  capReached(): Promise<boolean>;
  /** Coût en euros d'un appel (prix du cache des modèles, `cost.usd` de la réponse s'il existe). */
  costEur(model: string, usage: LlmUsage, costUsd: number | null): number;
  timers?: TypingTimers;
};

export type TurnOutcome = "replied" | "minor" | "skipped_cap" | "failed" | "aborted";

export type SentPart = {
  index: number;
  text: string;
  telegramMessageId?: number;
  /** Le bouton du lien d'offre est sur ce message. */
  offerSubId: string | null;
  /** Visuel de l'offre envoyé en photo avec ce texte en légende. */
  mediaAssetId: string | null;
  /** Texte fixe envoyé (repli sûr, arrêt mineur, « je reviens vers toi »). */
  fixedKey: string | null;
};

export type TurnEventType = "stage_changed" | "offer_sent" | "minor" | "ai_failed" | "cap_reached";
/** Événement à enregistrer (ConversationEvent + Event), jamais de texte dedans. */
export type TurnEvent = { type: TurnEventType; payload: Record<string, unknown> };

export type StageChange = { from: ConversationStage; to: ConversationStage };

export type TurnResult = {
  outcome: TurnOutcome;
  /** Parties réellement envoyées, dans l'ordre. */
  sent: SentPart[];
  newStage: ConversationStage;
  stageChanges: StageChange[];
  style: StyleProfile;
  facts: string[];
  /** Nouveau résumé roulant (absent si aucun résumé n'a été fait). */
  summary?: string;
  offerSent: { subId: string; url: string } | null;
  events: TurnEvent[];
  /**
   * Nouvel essai demandé (panne de l'IA) : les messages entrants du tour sont rendus au tour suivant. Absent après
   * `MAX_TURN_ATTEMPTS` passages ou une panne qui se reproduirait (échec définitif : événement `ai_failed` avec
   * `final: true`, l'alerte prévient l'admin).
   */
  retryAt?: Date;
  /** Avec `retryAt` : valeur de `TurnInput.retryCount` à donner au prochain passage. */
  retryCount?: number;
  /** Langue de réponse retenue (`Conversation.language`). */
  language: ChatLang;
  /** Modèle qui a produit la réponse envoyée (null : texte fixe ou aucun envoi). */
  model: string | null;
  /** Codes de rejet des réponses refusées pendant ce tour (meta.rejected). */
  rejected: string[];
  /** Note interne du modèle (jamais envoyée à la personne). */
  note: string | null;
  /** Messages entrants pris en compte par ce tour (ceux de l'entrée + ceux arrivés avant l'envoi et regroupés). */
  inboundUsed: TurnInbound[];
  /** Messages arrivés après la régénération : non traités, à rendre au tour suivant. */
  deferredInbound: TurnInbound[];
  /** Compteur de relances après ce tour (0 après une réponse, +1 après une relance). */
  followUpCount: number;
  /** Prochaine relance (null : aucune). */
  nextFollowUpAt: Date | null;
  /** « Je reviens vers toi dans un instant » envoyé à ce tour (mettre à jour lastNeutralAt). */
  neutralSent: boolean;
  /** Conversation à fermer (mineur, bot bloqué, personne injoignable). */
  closeReason: "MINOR" | "BLOCKED" | "UNREACHABLE" | null;
  /** Échec d'envoi qui a arrêté le tour. */
  sendError: { blocked: boolean; unreachable: boolean; error: string } | null;
  /** Lien d'offre créé mais pas parti (envoi du dernier message en échec). */
  unsentOfferSubId: string | null;
};

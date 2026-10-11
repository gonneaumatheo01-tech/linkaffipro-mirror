/**
 * Dépendances du flux d'adhésion (accès base et file d'attente), abstraites pour les tests.
 */
import type { InviteLinkKind, MembershipStatus, Prisma } from "@linkaffipro/db";
import type { User } from "grammy/types";
import type { BotIdentity } from "../ports";
import type { GateLinkDeps } from "./gate-links";
import type { RuleData } from "./rules";

export type ChannelInfo = {
  id: string;
  title: string;
  username: string | null;
  language: string;
  telegramChatId: bigint;
  primaryBotId: string | null;
  isActive: boolean;
};
export type InviteLinkInfo = {
  id: string;
  kind: InviteLinkKind;
  name: string;
  channelId: string;
  campaignId: string | null;
  adPlatform: string | null;
  adCampaignName: string | null;
  adName: string | null;
  sourceChannelId: string | null;
  telegramInviteLink: string;
};
export type MembershipInfo = {
  id: string;
  code: string;
  memberId: string;
  channelId: string;
  status: MembershipStatus;
  requestedAt: Date;
  approveAt: Date | null;
  userChatId: bigint | null;
  inviteLinkId: string | null;
  approvalRuleId: string | null;
  source: Record<string, unknown>;
  remindersSent: number;
};
export type GateButton = { channelId: string; title: string; url: string };
export type SequenceText = {
  texts: Record<string, string>;
  buttons: unknown[];
  mediaAssetId?: string | null;
} | null;

/**
 * Accès base et file du flux d'adhésion. Les liens des canaux à rejoindre (`GateLinkDeps`) se créent avec n'importe
 * lequel de nos bots administrateurs du canal à rejoindre (voir gate-links.ts).
 */
export interface JoinFlowDeps extends GateLinkDeps {
  upsertMember(
    from: User,
  ): Promise<{ memberId: string; languageCode: string | null; firstName: string | null }>;
  findChannelByChatId(chatId: bigint): Promise<ChannelInfo | null>;
  getChannels(ids: string[]): Promise<ChannelInfo[]>;
  /** Bot qui doit agir pour ce canal : bot principal s'il est administrateur, sinon le premier bot administrateur. */
  actingBotIdFor(channelId: string): Promise<{ botId: string; warning?: string } | null>;
  findInviteLinkByUrl(url: string): Promise<InviteLinkInfo | null>;
  /**
   * Liens de ce canal créés par notre bot d'identifiant Telegram `creatorTelegramId` dont l'adresse commence par
   * `prefix` (quelques-uns, actifs d'abord) : relecture d'un lien dont Telegram a masqué la fin (« https://t.me/+AbCd… »,
   * lien créé par un autre administrateur que le bot qui reçoit la demande). Le choix se fait par `pickMaskedLink`.
   * Facultatif (tests anciens) : aucun lien.
   */
  findInviteLinksByPrefix?(input: {
    channelId: string;
    prefix: string;
    creatorTelegramId: bigint;
  }): Promise<Array<InviteLinkInfo & { isActive: boolean }>>;
  /**
   * Règle d'une nouvelle demande selon sa provenance (phase 11) : lien d'invitation de la demande (null : lien que la
   * plateforme n'a pas créé, ou aucun lien), règles actives du canal → `resolveRuleForProvenance` (canaux à rejoindre
   * effectifs ; aucune règle → `NO_RULE` ou `NO_RULE_DIRECT`).
   */
  resolveRule(channelId: string, link: InviteLinkInfo | null): Promise<RuleData>;
  createMembership(data: {
    code: string;
    memberId: string;
    channelId: string;
    status: MembershipStatus;
    inviteLinkId: string | null;
    approvalRuleId: string | null;
    userChatId: bigint | null;
    requestedAt: Date;
    approveAt: Date | null;
    expiresAt: Date | null;
    source: Record<string, unknown>;
  }): Promise<{ id: string }>;
  updateMembership(
    id: string,
    data: Partial<{
      status: MembershipStatus;
      approveAt: Date | null;
      gateSatisfiedAt: Date;
      joinedAt: Date;
      leftAt: Date;
      source: Record<string, unknown>;
      remindersSent: number;
      lastReminderAt: Date;
    }>,
  ): Promise<void>;
  findMembershipByCode(code: string): Promise<MembershipInfo | null>;
  /** Dernière demande ouverte ou approuvée d'un membre sur un canal. */
  findLatestMembership(memberId: string, channelId: string): Promise<MembershipInfo | null>;
  /**
   * Règle d'une demande enregistrée, avec ses canaux à rejoindre effectifs : sans le canal d'où vient la personne, et
   * aucun si l'accueil n'en a pas demandé (`source.appliedRule.noGates`). Sert au « ✅ J'ai rejoint », au renvoi de
   * l'accueil et aux rappels : jamais un canal que l'accueil n'a pas demandé.
   */
  getRuleForMembership(m: MembershipInfo): Promise<RuleData>;
  /**
   * Date du dernier message d'accueil (OutboundMessage WELCOME, en file ou envoyé) de ce bot à ce membre, ou null.
   * Anti-doublon : pas deux accueils du même bot à la même personne en 10 minutes (`isDuplicateWelcome`).
   */
  lastWelcomeAt(memberId: string, botId: string): Promise<Date | null>;
  incrementInviteLink(
    id: string,
    field: "requests" | "approved" | "joined" | "left",
  ): Promise<void>;
  /** Demande par identifiant (renvoi de l'accueil depuis le site). */
  findMembershipById(id: string): Promise<MembershipInfo | null>;
  /** Prénom et langue d'un membre (renvoi de l'accueil). */
  getMember(
    memberId: string,
  ): Promise<{ memberId: string; languageCode: string | null; firstName: string | null } | null>;
  /** Identité d'un de nos bots actifs (jamais le jeton), ou null. */
  getBotIdentity(botId: string): Promise<BotIdentity | null>;
  /**
   * Le bot peut-il écrire en premier à ce membre ? Vrai seulement si le membre a ouvert la conversation avec le bot
   * (`startedAt`) et ne l'a pas bloqué. Hors de ce cas, Telegram n'accepte un message que dans les 5 minutes qui
   * suivent la demande d'adhésion (`user_chat_id`).
   */
  canWriteTo(memberId: string, botId: string): Promise<boolean>;
  getSequenceText(
    channelId: string,
    botId: string,
    trigger: "JOIN_REQUEST" | "GATE_SATISFIED" | "APPROVED" | "GATE_REMINDER",
  ): Promise<SequenceText>;
  enqueueDm(input: {
    botId: string;
    memberId: string;
    chatId: bigint | null;
    kind: "WELCOME" | "GATE_REMINDER" | "ACCEPTED";
    text: string;
    buttons: Array<Array<{ text: string; url: string }>>;
    mediaAssetId?: string | null;
  }): Promise<void>;
  setCanDm(memberId: string, botId: string, canDm: boolean): Promise<void>;
  recordEvent(input: {
    type: string;
    memberId?: string | null;
    channelId?: string | null;
    botId?: string | null;
    payload?: Prisma.InputJsonValue;
  }): Promise<void>;
  /** Émet un événement vers les automatisations (optionnel, jamais bloquant). */
  emitAutomation?(
    trigger: "JOINED" | "LEFT",
    memberId: string,
    context: Record<string, unknown>,
  ): Promise<void>;
}

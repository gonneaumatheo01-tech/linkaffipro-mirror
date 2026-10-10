import type { Vertical } from "@linkaffipro/core";
import type { Chat, ChatMemberAdministrator, ChatMemberOwner, Update, User } from "grammy/types";

/** Identité d'un bot telle que connue en base (jamais le jeton). */
export type BotIdentity = {
  id: string;
  name: string;
  username: string;
  telegramBotId: bigint;
  vertical: Vertical;
};

export type AdminRights = Record<string, boolean | string | undefined>;

/** Un de nos bots trouvé parmi les administrateurs d'un canal. */
export type OurBotAdmin = { telegramBotId: bigint; username: string };

/**
 * Dépendances des handlers (accès base). Abstraites pour pouvoir tester les handlers
 * avec des updates simulées sans base de données.
 */
export interface TelegramDeps {
  /** Journalise une update brute (type `telegram.<update_type>`). */
  recordUpdate(bot: BotIdentity, updateType: string, update: Update, refs: { memberId?: string; channelId?: string }): Promise<void>;
  /** Enregistre (ou met à jour) un membre et marque `canDm = true, startedAt`. Retourne l'id du membre. */
  memberStarted(bot: BotIdentity, from: User, payload: string | undefined): Promise<{ memberId: string }>;
  /** Met à jour un membre vu (sans démarrage). Retourne l'id. */
  memberSeen(bot: BotIdentity, from: User): Promise<{ memberId: string }>;
  /** Le membre a bloqué (ou débloqué) le bot en privé. */
  memberDmStatus(bot: BotIdentity, from: User, canDm: boolean): Promise<void>;
  /** Crée ou met à jour un canal/groupe. Retourne l'id interne et `created: true` s'il vient d'être créé. */
  upsertChannel(chat: Chat): Promise<{ channelId: string; created?: boolean }>;
  /** Le bot a des droits d'administrateur sur ce canal. */
  setChannelAdmin(channelId: string, botTelegramId: bigint, rights: AdminRights): Promise<void>;
  /** Le bot n'est plus administrateur du canal. */
  revokeChannelAdmin(channelId: string, botTelegramId: bigint): Promise<void>;
  /** Identifiants Telegram de tous nos bots (pour reconnaître nos bots parmi les administrateurs). */
  listOurBotTelegramIds(): Promise<bigint[]>;
  /** Lie un compte interne à un telegramUserId via un jeton `admin_<token>`. Retourne le nom lié ou null. */
  linkAdminAccount(token: string, telegramUserId: bigint): Promise<{ name: string } | null>;
  /** L'expéditeur est-il un utilisateur de la plateforme (`User.telegramUserId`) ou l'admin (`Setting admin.telegramUserId`) ? */
  isPlatformUser(telegramUserId: bigint): Promise<boolean>;
  /** Journal d'audit d'une action sur un canal déclenchée depuis Telegram (utilisateur retrouvé par son identifiant Telegram). */
  auditChannel?(input: { action: string; channelId: string; telegramUserId: bigint; metadata?: Record<string, unknown> }): Promise<void>;
  /** Re-vérifie les droits de nos bots sur un canal avec les jetons de chacun d'eux (quand le bot courant n'est pas administrateur). */
  recheckChannelRights?(channelId: string): Promise<OurBotAdmin[]>;
}

/** Sous-ensemble des dépendances nécessaire pour connaître un canal et ses droits (handlers spécialisés). */
export type ChannelDeps = Pick<TelegramDeps, "upsertChannel" | "setChannelAdmin" | "revokeChannelAdmin" | "listOurBotTelegramIds">;

export function extractAdminRights(member: ChatMemberAdministrator | ChatMemberOwner): AdminRights {
  const rights: AdminRights = { status: member.status };
  for (const [k, v] of Object.entries(member)) {
    if (k.startsWith("can_") || k === "is_anonymous" || k === "custom_title") rights[k] = v as boolean | string;
  }
  return rights;
}

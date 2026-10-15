import type { Vertical } from "@linkaffipro/core";
import type { Chat, ChatMemberAdministrator, ChatMemberOwner, Update, User } from "grammy/types";
import type { CustomEmojiAddOutcome, ExtractedCustomEmoji } from "./custom-emoji/extract";

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
  recordUpdate(
    bot: BotIdentity,
    updateType: string,
    update: Update,
    refs: { memberId?: string; channelId?: string },
  ): Promise<void>;
  /** Enregistre (ou met à jour) un membre et marque `canDm = true, startedAt`. Retourne l'id du membre. */
  memberStarted(
    bot: BotIdentity,
    from: User,
    payload: string | undefined,
  ): Promise<{ memberId: string }>;
  /** Met à jour un membre vu (sans démarrage). Retourne l'id. */
  memberSeen(bot: BotIdentity, from: User): Promise<{ memberId: string }>;
  /** Le membre a bloqué (ou débloqué) le bot en privé. */
  memberDmStatus(bot: BotIdentity, from: User, canDm: boolean): Promise<void>;
  /**
   * Le membre a écrit au bot en privé (n'importe quel message, pas seulement /start ; phase 14, décision E2) : Telegram
   * laisse désormais le bot lui écrire, donc il devient joignable (`canDm`, `startedAt` si absent, `blockedAt` effacé).
   * Sans écriture s'il l'était déjà. Absent dans les tests qui n'en ont pas besoin.
   */
  memberWrote?(bot: BotIdentity, memberId: string): Promise<void>;
  /**
   * Crée ou met à jour un canal/groupe. Retourne l'id interne et `created: true` seulement pour l'appel qui l'a réellement créé
   * (plusieurs bots peuvent recevoir la même première mise à jour en même temps).
   */
  upsertChannel(chat: Chat): Promise<{ channelId: string; created?: boolean }>;
  /** Id interne d'un canal déjà connu (sans rien créer), sinon null. */
  findChannelId(telegramChatId: number): Promise<string | null>;
  /** Le bot a des droits d'administrateur sur ce canal (sans effet ni événement si rien n'a changé). */
  setChannelAdmin(channelId: string, botTelegramId: bigint, rights: AdminRights): Promise<void>;
  /** Le bot n'est plus administrateur du canal. */
  revokeChannelAdmin(channelId: string, botTelegramId: bigint): Promise<void>;
  /** Identifiants Telegram de tous nos bots (pour reconnaître nos bots parmi les administrateurs). */
  listOurBotTelegramIds(): Promise<bigint[]>;
  /** Nos bots enregistrés comme administrateurs du canal (seuls eux peuvent perdre leurs droits). Absent : tous nos bots. */
  listChannelAdminBotIds?(channelId: string): Promise<bigint[]>;
  /**
   * Canal créé automatiquement : pose le bot principal s'il n'y en a pas encore (bot administrateur du même univers que le canal,
   * sinon le bot qui a détecté le canal s'il est administrateur, sinon le premier bot administrateur, sinon le bot détecteur).
   */
  initPrimaryBot?(channelId: string, detectorBotTelegramId: bigint | null): Promise<void>;
  /** Lie un compte interne à un telegramUserId via un jeton `admin_<token>`. Retourne le nom lié ou null. */
  linkAdminAccount(token: string, telegramUserId: bigint): Promise<{ name: string } | null>;
  /** L'expéditeur est-il un utilisateur de la plateforme (`User.telegramUserId`) ou l'admin (`Setting admin.telegramUserId`) ? */
  isPlatformUser(telegramUserId: bigint): Promise<boolean>;
  /**
   * L'expéditeur est-il l'admin du dialogue avec Claude (`Setting admin.telegramUserId`, messages `pnpm tg:send` / `tg:inbox`) ?
   * Ses réponses (« fait », « 1 »…) sur le bot casino ne reçoivent pas l'aide « Pour ajouter un canal ».
   */
  isAdminDialogPartner?(telegramUserId: bigint): Promise<boolean>;
  /** Journal d'audit d'une action sur un canal déclenchée depuis Telegram (utilisateur retrouvé par son identifiant Telegram). */
  auditChannel?(input: {
    action: string;
    channelId: string;
    telegramUserId: bigint;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  /**
   * Re-vérifie les droits de nos bots sur un canal avec les jetons de chacun d'eux (quand le bot courant n'est pas administrateur).
   * `unavailable` : vérification impossible pour le moment (réseau, limite de débit) ; les droits enregistrés sont conservés.
   */
  recheckChannelRights?(channelId: string): Promise<RecheckOutcome>;
  /**
   * Phase 12 : l'un de nos autres bots actifs (sauf `exceptBotTelegramId`, le bot courant, qui a déjà essayé) est-il
   * administrateur de ce chat ? Lecture seule avec leurs propres jetons, aucune écriture. Faux sur un doute (réseau).
   */
  isOurBotAdminOf?(telegramChatId: number, exceptBotTelegramId: bigint): Promise<boolean>;
  /** Méthode 2 depuis le bot : un utilisateur de la plateforme colle le lien public d'un canal (t.me/<nom>, @nom). */
  importChannelByLink?(input: string, telegramUserId: bigint): Promise<LinkImportOutcome>;
  /**
   * Phase 12 : emojis animés d'un message envoyé au bot par un utilisateur de la plateforme → bibliothèque de l'équipe
   * (sans doublon, un emoji retiré y revient), événement `custom_emoji.added` et aperçus enfilés. Absent : rien n'est fait.
   */
  addCustomEmojis?(input: {
    emojis: ExtractedCustomEmoji[];
    telegramUserId: bigint;
    botId: string;
  }): Promise<CustomEmojiAddOutcome>;
}

/** Résultat d'une re-vérification des droits pour le bot (méthode 1). */
export type RecheckOutcome = { admins: OurBotAdmin[]; unavailable: boolean };

/** Résultat d'un import par lien depuis le bot. `reason` : lien privé, canal introuvable, ou vérification impossible. */
export type LinkImportOutcome =
  | {
      ok: true;
      title: string;
      created: boolean;
      admins: OurBotAdmin[];
      /** Droits non vérifiables pour le moment (réseau, 429, aucun bot actif) : `admins` vide ne veut pas dire « aucun bot ». */
      unavailable?: boolean;
    }
  | { ok: false; reason: "private" | "not_found" | "invalid" | "unavailable" };

/** Sous-ensemble des dépendances nécessaire pour connaître un canal et ses droits (handlers spécialisés). */
export type ChannelDeps = Pick<
  TelegramDeps,
  | "upsertChannel"
  | "findChannelId"
  | "setChannelAdmin"
  | "revokeChannelAdmin"
  | "listOurBotTelegramIds"
  | "listChannelAdminBotIds"
  | "initPrimaryBot"
>;

export function extractAdminRights(member: ChatMemberAdministrator | ChatMemberOwner): AdminRights {
  const rights: AdminRights = { status: member.status };
  for (const [k, v] of Object.entries(member)) {
    if (k.startsWith("can_") || k === "is_anonymous" || k === "custom_title")
      rights[k] = v as boolean | string;
  }
  return rights;
}

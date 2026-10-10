import { GrammyError, type Api } from "grammy";
import type {
  Chat,
  ChatMember,
  ChatMemberAdministrator,
  ChatMemberOwner,
  Update,
} from "grammy/types";
import { extractAdminRights, type ChannelDeps, type OurBotAdmin } from "../ports";

export function isGroupLike(chat: Chat): boolean {
  return chat.type === "channel" || chat.type === "supergroup" || chat.type === "group";
}

export function isAdminStatus(m: ChatMember): m is ChatMemberAdministrator | ChatMemberOwner {
  return m.status === "administrator" || m.status === "creator";
}

/** API minimale nécessaire au relevé des droits (facile à simuler dans les tests). */
export type AdminsApi = Pick<Api, "getChatAdministrators" | "getChatMember">;

export type RightsSync =
  | { ok: true; ourAdmins: OurBotAdmin[] }
  /** `accessDenied` : refus de Telegram (400/403, ce bot n'a pas accès) ; sinon panne passagère (réseau, 429, 5xx). */
  | { ok: false; error: string; accessDenied: boolean };

export type KnownChannel = { channelId: string; created: boolean; rights: RightsSync | null };

/** Erreur Telegram « pas d'accès » (400 chat introuvable ou droits manquants, 403 bot retiré), par opposition à une panne passagère. */
export function isTelegramAccessError(err: unknown): boolean {
  return err instanceof GrammyError && (err.error_code === 400 || err.error_code === 403);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type BotPresence =
  | { status: "admin"; member: ChatMemberAdministrator | ChatMemberOwner }
  | { status: "absent" }
  | { status: "unknown" };

/**
 * Statut réel d'un de nos bots absent de la liste des administrateurs, lu par `getChatMember` :
 * « admin » (la liste était incomplète), « absent » (sûr : membre simple, parti, exclu ou inconnu du canal),
 * « unknown » (vérification impossible : on ne retire rien sur un doute).
 */
export async function botPresence(
  api: Pick<Api, "getChatMember">,
  chatId: number,
  botTelegramId: bigint,
): Promise<BotPresence> {
  try {
    const m = await api.getChatMember(chatId, Number(botTelegramId));
    return isAdminStatus(m) ? { status: "admin", member: m } : { status: "absent" };
  } catch (err) {
    if (
      err instanceof GrammyError &&
      err.error_code === 400 &&
      /user not found|member not found|PARTICIPANT_ID_INVALID|USER_ID_INVALID/i.test(
        err.description,
      )
    ) {
      return { status: "absent" };
    }
    return { status: "unknown" };
  }
}

/**
 * Lit les administrateurs du chat avec `api` (le bot courant, `return_bots` : sans ce paramètre Telegram omet nos autres bots)
 * et enregistre les droits de chacun de nos bots présents.
 * Avec `revokeMissing`, un de nos bots enregistré comme administrateur mais absent de la liste n'est retiré qu'après
 * confirmation par `getChatMember` (jamais sur un doute).
 * Échec (bot non administrateur, réseau) : `{ ok: false }`, jamais une exception.
 */
export async function syncChannelRights(
  api: AdminsApi,
  deps: ChannelDeps,
  channelId: string,
  chatId: number,
  opts: { revokeMissing?: boolean } = {},
): Promise<RightsSync> {
  let admins: ChatMember[];
  try {
    admins = await api.getChatAdministrators(chatId, { return_bots: true });
  } catch (err) {
    return { ok: false, error: errorText(err), accessDenied: isTelegramAccessError(err) };
  }
  if (!Array.isArray(admins))
    return { ok: false, error: "réponse inattendue de getChatAdministrators", accessDenied: false };
  const ours = await deps.listOurBotTelegramIds();
  const oursSet = new Set(ours.map(String));
  const found: OurBotAdmin[] = [];
  for (const admin of admins) {
    if (!admin.user.is_bot || !oursSet.has(String(admin.user.id)) || !isAdminStatus(admin))
      continue;
    await deps.setChannelAdmin(channelId, BigInt(admin.user.id), extractAdminRights(admin));
    found.push({
      telegramBotId: BigInt(admin.user.id),
      username: admin.user.username ?? String(admin.user.id),
    });
  }
  if (opts.revokeMissing) {
    const recorded = deps.listChannelAdminBotIds
      ? await deps.listChannelAdminBotIds(channelId)
      : ours;
    for (const id of recorded) {
      if (!oursSet.has(String(id)) || found.some((f) => f.telegramBotId === id)) continue;
      const presence = await botPresence(api, chatId, id);
      if (presence.status === "admin") {
        await deps.setChannelAdmin(channelId, id, extractAdminRights(presence.member));
        found.push({ telegramBotId: id, username: presence.member.user.username ?? String(id) });
      } else if (presence.status === "absent") {
        await deps.revokeChannelAdmin(channelId, id);
      }
    }
  }
  return { ok: true, ourAdmins: found };
}

/**
 * S'assure qu'un canal (ou groupe) est connu en base. S'il vient d'être créé, ou si `refreshRights` est demandé,
 * relève les droits de nos bots via `getChatAdministrators` (sans jamais lever : un bot non administrateur ne peut pas lire la liste).
 * Canal créé : bot principal posé (bot qui a reçu la mise à jour, `ctx.me`, comme candidat).
 */
export async function ensureChannelKnown(
  ctx: { api: AdminsApi; me?: { id: number } },
  deps: ChannelDeps,
  chat: Chat,
  opts: { refreshRights?: boolean } = {},
): Promise<KnownChannel> {
  const { channelId, created = false } = await deps.upsertChannel(chat);
  let rights: RightsSync | null = null;
  if (created || opts.refreshRights) {
    rights = await syncChannelRights(ctx.api, deps, channelId, chat.id, {
      revokeMissing: !created,
    });
    if (!rights.ok)
      console.warn("[telegram] getChatAdministrators impossible pour", chat.id, rights.error);
  }
  if (created && deps.initPrimaryBot) {
    try {
      await deps.initPrimaryBot(channelId, ctx.me ? BigInt(ctx.me.id) : null);
    } catch (err) {
      console.warn("[telegram] bot principal non posé pour", chat.id, errorText(err));
    }
  }
  return { channelId, created, rights };
}

/** Mises à jour de groupe que Telegram n'envoie qu'à un bot administrateur (elles prouvent ses droits). */
const GROUP_ADMIN_UPDATES = new Set([
  "chat_join_request",
  "chat_member",
  "message_reaction",
  "message_reaction_count",
]);

/**
 * Cette mise à jour peut-elle créer un canal encore inconnu ? Pas de canal fantôme :
 * - bot retiré (`my_chat_member` left / kicked) d'un chat inconnu : rien à créer ;
 * - canal : toute autre mise à jour (publication, demande d'adhésion, réactions, membres…) ;
 * - groupe : seulement si le bot y est administrateur (promotion du bot, ou mise à jour réservée aux administrateurs).
 */
export function mayCreateChannelFrom(type: string, update: Update, chat: Chat): boolean {
  if (type === "my_chat_member") {
    const member = update.my_chat_member?.new_chat_member;
    if (!member || member.status === "left" || member.status === "kicked") return false;
    return chat.type === "channel" || isAdminStatus(member);
  }
  if (chat.type === "channel") return true;
  return GROUP_ADMIN_UPDATES.has(type);
}

/** Résultat de `ensureChannelKnown` pour l'update en cours (posé par le middleware de core, lu par les handlers). */
const knownByUpdate = new WeakMap<Update, KnownChannel>();
export function rememberKnownChannel(update: Update, known: KnownChannel): void {
  knownByUpdate.set(update, known);
}
export function knownChannelFor(update: Update): KnownChannel | undefined {
  return knownByUpdate.get(update);
}

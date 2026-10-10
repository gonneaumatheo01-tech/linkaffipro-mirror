import type { Api } from "grammy";
import type { Chat, ChatMember, Update } from "grammy/types";
import { extractAdminRights, type ChannelDeps, type OurBotAdmin } from "../ports";

export function isGroupLike(chat: Chat): boolean {
  return chat.type === "channel" || chat.type === "supergroup" || chat.type === "group";
}

export function isAdminStatus(m: ChatMember): m is Extract<ChatMember, { status: "administrator" | "creator" }> {
  return m.status === "administrator" || m.status === "creator";
}

/** API minimale nécessaire au relevé des droits (facile à simuler dans les tests). */
export type AdminsApi = Pick<Api, "getChatAdministrators">;

export type RightsSync = { ok: true; ourAdmins: OurBotAdmin[] } | { ok: false; error: string };

export type KnownChannel = { channelId: string; created: boolean; rights: RightsSync | null };

/**
 * Lit les administrateurs du chat avec `api` (le bot courant) et enregistre les droits de chacun de nos bots présents.
 * Avec `revokeMissing`, nos bots absents de la liste perdent leurs droits en base (la liste est complète quand l'appel réussit).
 * Échec sans droit d'administrateur : `{ ok: false }`, jamais une exception.
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
    admins = await api.getChatAdministrators(chatId);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!Array.isArray(admins)) return { ok: false, error: "réponse inattendue de getChatAdministrators" };
  const ours = await deps.listOurBotTelegramIds();
  const oursSet = new Set(ours.map(String));
  const found: OurBotAdmin[] = [];
  for (const admin of admins) {
    if (!admin.user.is_bot || !oursSet.has(String(admin.user.id)) || !isAdminStatus(admin)) continue;
    await deps.setChannelAdmin(channelId, BigInt(admin.user.id), extractAdminRights(admin));
    found.push({ telegramBotId: BigInt(admin.user.id), username: admin.user.username ?? String(admin.user.id) });
  }
  if (opts.revokeMissing) {
    for (const id of ours) {
      if (!found.some((f) => f.telegramBotId === id)) await deps.revokeChannelAdmin(channelId, id);
    }
  }
  return { ok: true, ourAdmins: found };
}

/**
 * S'assure qu'un canal (ou groupe) est connu en base. S'il vient d'être créé, ou si `refreshRights` est demandé,
 * relève les droits de nos bots via `getChatAdministrators` (sans jamais lever : un bot non administrateur ne peut pas lire la liste).
 */
export async function ensureChannelKnown(
  ctx: { api: AdminsApi },
  deps: ChannelDeps,
  chat: Chat,
  opts: { refreshRights?: boolean } = {},
): Promise<KnownChannel> {
  const { channelId, created = false } = await deps.upsertChannel(chat);
  let rights: RightsSync | null = null;
  if (created || opts.refreshRights) {
    rights = await syncChannelRights(ctx.api, deps, channelId, chat.id, { revokeMissing: !created });
    if (!rights.ok) console.warn("[telegram] getChatAdministrators impossible pour", chat.id, rights.error);
  }
  return { channelId, created, rights };
}

/** Résultat de `ensureChannelKnown` pour l'update en cours (posé par le middleware de core, lu par les handlers). */
const knownByUpdate = new WeakMap<Update, KnownChannel>();
export function rememberKnownChannel(update: Update, known: KnownChannel): void {
  knownByUpdate.set(update, known);
}
export function knownChannelFor(update: Update): KnownChannel | undefined {
  return knownByUpdate.get(update);
}

import { Api, GrammyError } from "grammy";
import type { Chat, ChatMember } from "grammy/types";
import { TELEGRAM_ALLOWED_UPDATES, decrypt, encrypt, randomToken, type Vertical } from "@linkaffipro/core";
import { prisma, audit } from "@linkaffipro/db";
import { evictBot } from "./factory";
import { extractAdminRights } from "./ports";
import { prismaTelegramDeps } from "./prisma-deps";
import { chatFromFullInfo } from "./handlers/forward";
import { parseChannelLink } from "./channels/username";

export function webhookUrlFor(botId: string, baseUrl = process.env.APP_BASE_URL): string {
  if (!baseUrl) throw new Error("APP_BASE_URL manquante");
  return `${baseUrl.replace(/\/$/, "")}/api/telegram/${botId}`;
}

export type RegisterResult = {
  botId: string;
  username: string;
  name: string;
  created: boolean;
  webhook: Awaited<ReturnType<Api["getWebhookInfo"]>>;
};

/**
 * Enregistre un bot à partir de son jeton : getMe, chiffrement, enregistrement en base, pose du webhook.
 * Code commun à l'interface (page Bots) et au script `pnpm bots:register`.
 */
export async function registerBotFromToken(
  token: string,
  vertical: Vertical,
  opts: { userId?: string | null } = {},
): Promise<RegisterResult> {
  const trimmed = token.trim();
  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(trimmed)) throw new Error("Format de jeton invalide");
  const api = new Api(trimmed);
  let me;
  try {
    me = await api.getMe();
  } catch (err) {
    if (err instanceof GrammyError && err.error_code === 401) throw new Error("Jeton refusé par Telegram (401)");
    throw err;
  }
  const username = me.username ?? String(me.id);
  const existing = await prisma.bot.findUnique({ where: { telegramBotId: BigInt(me.id) } });
  const webhookSecret = existing?.webhookSecret ?? randomToken(32);
  const bot = await prisma.bot.upsert({
    where: { telegramBotId: BigInt(me.id) },
    create: {
      telegramBotId: BigInt(me.id),
      name: me.first_name,
      username,
      tokenEncrypted: encrypt(trimmed),
      vertical,
      webhookSecret,
      isActive: true,
    },
    update: { name: me.first_name, username, tokenEncrypted: encrypt(trimmed), vertical, isActive: true, lastError: null },
  });
  evictBot(bot.id);
  const webhook = await setWebhookForBot(bot.id);
  await audit({
    userId: opts.userId ?? null,
    action: existing ? "bot.updated" : "bot.created",
    entityType: "Bot",
    entityId: bot.id,
    metadata: { username, vertical },
  });
  return { botId: bot.id, username, name: me.first_name, created: !existing, webhook };
}

/** (Re)pose le webhook d'un bot à partir de APP_BASE_URL et renvoie getWebhookInfo. */
export async function setWebhookForBot(botId: string) {
  const bot = await prisma.bot.findUniqueOrThrow({ where: { id: botId } });
  const { decrypt } = await import("@linkaffipro/core");
  const api = new Api(decrypt(bot.tokenEncrypted));
  const url = webhookUrlFor(bot.id);
  try {
    await api.setWebhook(url, {
      allowed_updates: [...TELEGRAM_ALLOWED_UPDATES],
      secret_token: bot.webhookSecret,
      drop_pending_updates: false,
    });
    const info = await api.getWebhookInfo();
    await prisma.bot.update({ where: { id: botId }, data: { lastError: info.last_error_message ?? null } });
    return info;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.bot.update({ where: { id: botId }, data: { lastError: message } });
    throw err;
  }
}

export async function getWebhookInfoForBot(botId: string) {
  const bot = await prisma.bot.findUniqueOrThrow({ where: { id: botId } });
  const { decrypt } = await import("@linkaffipro/core");
  const api = new Api(decrypt(bot.tokenEncrypted));
  return api.getWebhookInfo();
}

/** Repose les webhooks de tous les bots actifs. */
export async function setAllWebhooks(): Promise<Array<{ username: string; url?: string; error?: string }>> {
  const bots = await prisma.bot.findMany({ where: { isActive: true } });
  const out: Array<{ username: string; url?: string; error?: string }> = [];
  for (const b of bots) {
    try {
      const info = await setWebhookForBot(b.id);
      out.push({ username: b.username, url: info.url, error: info.last_error_message });
    } catch (err) {
      out.push({ username: b.username, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

// ============================================================
// Canaux existants : import par lien public, par identifiant, re-vérification des droits (tous nos bots)
// ============================================================

export type ChannelBotRight = { botId: string; telegramBotId: bigint; username: string; rights: Record<string, boolean | string | undefined> };

export type ReadAdminsResult =
  | { ok: true; admins: ChannelBotRight[]; readBy: string }
  | { ok: false; reason: "no_bot" | "not_admin" | "error"; message: string };

type ActiveBot = { id: string; username: string; telegramBotId: bigint; tokenEncrypted: string };

function apiFor(bot: { tokenEncrypted: string }): Api {
  return new Api(decrypt(bot.tokenEncrypted));
}

function isAdminMember(m: ChatMember): m is Extract<ChatMember, { status: "administrator" | "creator" }> {
  return m.status === "administrator" || m.status === "creator";
}

/** Erreur Telegram « le bot n'a pas accès » (400 chat introuvable, 403 bot retiré, CHAT_ADMIN_REQUIRED…), par opposition à une panne réseau. */
function isAccessError(err: unknown): boolean {
  return err instanceof GrammyError && (err.error_code === 400 || err.error_code === 403);
}

async function activeBots(): Promise<ActiveBot[]> {
  return prisma.bot.findMany({ where: { isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true, username: true, telegramBotId: true, tokenEncrypted: true } });
}

/**
 * Lit la liste des administrateurs d'un chat avec chacun de nos bots actifs (le premier qui y a accès suffit : la liste est complète)
 * et renvoie ceux de nos bots qui en font partie. Aucune écriture en base.
 */
export async function readOurAdminsForChat(telegramChatId: bigint | number, bots?: ActiveBot[]): Promise<ReadAdminsResult> {
  const list = bots ?? (await activeBots());
  if (list.length === 0) return { ok: false, reason: "no_bot", message: "Aucun bot actif." };
  const byTelegramId = new Map(list.map((b) => [b.telegramBotId.toString(), b]));
  let lastError: unknown = null;
  let accessErrors = 0;
  for (const bot of list) {
    try {
      const members = await apiFor(bot).getChatAdministrators(Number(telegramChatId));
      const admins: ChannelBotRight[] = [];
      for (const m of members) {
        const ours = m.user.is_bot ? byTelegramId.get(String(m.user.id)) : undefined;
        if (!ours || !isAdminMember(m)) continue;
        admins.push({ botId: ours.id, telegramBotId: ours.telegramBotId, username: ours.username, rights: extractAdminRights(m) });
      }
      return { ok: true, admins, readBy: bot.username };
    } catch (err) {
      lastError = err;
      if (isAccessError(err)) accessErrors += 1;
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  // Tous nos bots ont reçu un refus d'accès : aucun n'est administrateur. Sinon (réseau…), on ne conclut rien.
  return accessErrors === list.length ? { ok: false, reason: "not_admin", message } : { ok: false, reason: "error", message };
}

export type RecheckResult = {
  channelId: string;
  title: string;
  admins: ChannelBotRight[];
  /** Bots dont les droits viennent d'être retirés en base. */
  revoked: string[];
  /** Vide si la lecture a réussi ; sinon l'explication (aucun bot administrateur, ou erreur réseau). */
  warning: string | null;
};

/**
 * Re-vérifie les droits de nos bots sur un canal (`getChatAdministrators` via chaque bot actif) et met à jour
 * `ChannelBotAdmin` (ajout / retrait). Audit `channel.rights_rechecked` sauf `audit: false`.
 */
export async function recheckChannelRights(channelId: string, opts: { userId?: string | null; audit?: boolean } = {}): Promise<RecheckResult> {
  const channel = await prisma.channel.findUniqueOrThrow({ where: { id: channelId }, select: { id: true, title: true, telegramChatId: true } });
  const bots = await activeBots();
  const read = await readOurAdminsForChat(channel.telegramChatId, bots);
  const before = await prisma.channelBotAdmin.findMany({ where: { channelId, revokedAt: null }, select: { botId: true, bot: { select: { username: true } } } });
  const revoked: string[] = [];
  let admins: ChannelBotRight[] = [];
  let warning: string | null = null;

  if (read.ok) {
    admins = read.admins;
    const present = new Set(admins.map((a) => a.botId));
    for (const a of admins) await prismaTelegramDeps.setChannelAdmin(channelId, a.telegramBotId, a.rights);
    for (const b of bots) {
      if (present.has(b.id)) continue;
      if (before.some((x) => x.botId === b.id)) revoked.push(b.username);
      await prismaTelegramDeps.revokeChannelAdmin(channelId, b.telegramBotId);
    }
  } else if (read.reason === "not_admin") {
    // Aucun de nos bots n'a accès au canal : ils n'en sont plus administrateurs.
    for (const b of bots) {
      if (before.some((x) => x.botId === b.id)) revoked.push(b.username);
      await prismaTelegramDeps.revokeChannelAdmin(channelId, b.telegramBotId);
    }
    warning = "Aucun de nos bots n'est administrateur de ce canal.";
  } else {
    warning = read.reason === "no_bot" ? "Aucun bot actif : impossible de vérifier." : `Vérification impossible pour le moment (${read.message}). Les droits enregistrés sont conservés.`;
  }

  if (opts.audit !== false) {
    await audit({
      userId: opts.userId ?? null,
      action: "channel.rights_rechecked",
      entityType: "Channel",
      entityId: channelId,
      metadata: { admins: admins.map((a) => a.username), revoked, warning },
    });
  }
  return { channelId, title: channel.title, admins, revoked, warning };
}

/** Re-vérifie les droits sur tous les canaux actifs (un audit par canal). */
export async function recheckAllChannelRights(opts: { userId?: string | null } = {}): Promise<RecheckResult[]> {
  const channels = await prisma.channel.findMany({ where: { isActive: true }, orderBy: { title: "asc" }, select: { id: true } });
  const out: RecheckResult[] = [];
  for (const c of channels) out.push(await recheckChannelRights(c.id, opts));
  return out;
}

export type ImportedChannel = { channelId: string; title: string; created: boolean; admins: ChannelBotRight[]; warning: string | null };

/** Phrase de confirmation commune aux trois méthodes d'ajout. */
export function importedChannelMessage(r: ImportedChannel): string {
  const verb = r.created ? "ajouté" : "déjà connu, mis à jour";
  const admins = r.admins.length > 0 ? `bots administrateurs : ${r.admins.map((a) => `@${a.username}`).join(", ")}` : "aucun de nos bots n'est administrateur : ajoutez-en un dans Telegram (Canal → Administrateurs → Ajouter)";
  return `Canal « ${r.title} » ${verb} ✅ (${admins})`;
}

/** Enregistre un chat Telegram connu (objet `Chat`) comme canal, relève les droits, audite avec la source donnée. */
export async function importChannelFromChat(
  chat: Chat,
  opts: { source: "channel.imported_by_link" | "channel.imported_from_account"; userId?: string | null; metadata?: Record<string, unknown> },
): Promise<ImportedChannel> {
  if (chat.type === "private") throw new Error("Ce lien désigne une personne, pas un canal.");
  const { channelId, created = false } = await prismaTelegramDeps.upsertChannel(chat);
  const r = await recheckChannelRights(channelId, { userId: opts.userId, audit: false });
  await audit({
    userId: opts.userId ?? null,
    action: opts.source,
    entityType: "Channel",
    entityId: channelId,
    metadata: { ...(opts.metadata ?? {}), title: r.title, telegramChatId: String(chat.id), created, admins: r.admins.map((a) => a.username) },
  });
  return { channelId, title: r.title, created, admins: r.admins, warning: r.warning };
}

/**
 * Méthode 2 : import d'un canal public par son nom (`t.me/<nom>`, `@nom`, `nom`) → `getChat` avec le premier bot actif
 * (puis les autres en cas d'échec) → création du canal et relevé des droits de tous nos bots.
 * Erreurs lisibles (canal privé ou nom faux : utiliser la méthode 1).
 */
export async function importChannelByUsername(input: string, opts: { userId?: string | null } = {}): Promise<ImportedChannel> {
  const parsed = parseChannelLink(input);
  if (parsed.kind === "invite") throw new Error("Ce lien est un lien d'invitation privé : il ne permet pas de retrouver le canal. Utilisez la méthode 1 (transférer un message du canal à l'un des bots).");
  if (parsed.kind === "invalid") throw new Error("Nom de canal invalide. Collez un lien comme t.me/mon_canal ou @mon_canal (lettres, chiffres et _ ; 4 caractères au moins).");
  const bots = await activeBots();
  if (bots.length === 0) throw new Error("Aucun bot actif : ajoutez d'abord un bot (page Bots).");
  let chat: Chat | null = null;
  let lastError: unknown = null;
  for (const bot of bots) {
    try {
      const full = await apiFor(bot).getChat(`@${parsed.username}`);
      chat = chatFromFullInfo(full);
      if (!chat) throw new Error("Ce lien désigne une personne, pas un canal.");
      break;
    } catch (err) {
      lastError = err;
      if (!(err instanceof GrammyError)) throw err;
    }
  }
  if (!chat) {
    const detail = lastError instanceof GrammyError ? lastError.description : "";
    throw new Error(`Ce canal est privé ou le nom est faux : utilisez la méthode 1 (transférer un message du canal à l'un des bots).${detail ? ` Telegram : ${detail}` : ""}`);
  }
  return importChannelFromChat(chat, { source: "channel.imported_by_link", userId: opts.userId, metadata: { username: parsed.username } });
}

/**
 * Méthode « Importer tous mes canaux » : un canal connu par son identifiant Telegram (compte utilisateur MTProto).
 * `getChat` via nos bots pour un titre à jour quand l'un d'eux y a accès ; sinon les informations fournies suffisent.
 */
export async function importChannelByChatId(
  input: { telegramChatId: bigint; title: string; username: string | null; isBroadcast?: boolean },
  opts: { userId?: string | null } = {},
): Promise<ImportedChannel> {
  const bots = await activeBots();
  let chat: Chat | null = null;
  for (const bot of bots) {
    try {
      chat = chatFromFullInfo(await apiFor(bot).getChat(Number(input.telegramChatId)));
      if (chat) break;
    } catch {
      /* ce bot n'a pas accès : on essaie le suivant */
    }
  }
  chat ??= input.isBroadcast === false
    ? { id: Number(input.telegramChatId), type: "supergroup", title: input.title, username: input.username ?? undefined }
    : { id: Number(input.telegramChatId), type: "channel", title: input.title, username: input.username ?? undefined };
  return importChannelFromChat(chat, { source: "channel.imported_from_account", userId: opts.userId });
}

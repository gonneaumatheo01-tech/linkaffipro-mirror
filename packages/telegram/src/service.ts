import { Api, GrammyError } from "grammy";
import type { Chat } from "grammy/types";
import { TELEGRAM_ALLOWED_UPDATES, encrypt, randomToken, type Vertical } from "@linkaffipro/core";
import { CHANNEL_BOT_WHERE, prisma, audit, toJsonValue } from "@linkaffipro/db";
import type { ChatLang } from "@linkaffipro/chat";
import { evictBot, getOrCreateBot } from "./factory";
import { extractAdminRights, type BotMode } from "./ports";
import { prismaTelegramDeps } from "./prisma-deps";
import { chatFromFullInfo } from "./handlers/forward";
import { botPresence, isAdminStatus, isTelegramAccessError } from "./handlers/channels";
import { parseChannelLink } from "./channels/username";
import { PROFILE_LANGS, assistantProfilePlan, assistantProfileTextOk } from "./assistant/profile";

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
 * Code commun à l'interface (Réglages → Bots) et au script `pnpm bots:register`.
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
    if (err instanceof GrammyError && err.error_code === 401)
      throw new Error("Jeton refusé par Telegram (401)");
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
    update: {
      name: me.first_name,
      username,
      tokenEncrypted: encrypt(trimmed),
      vertical,
      isActive: true,
      lastError: null,
    },
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
    await prisma.bot.update({
      where: { id: botId },
      data: { lastError: info.last_error_message ?? null },
    });
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
export async function setAllWebhooks(): Promise<
  Array<{ username: string; url?: string; error?: string }>
> {
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
// Phase 17 : profil Telegram d'un bot assistant de conversation (description, description courte, commandes)
// ============================================================

/** Méthodes de l'API Telegram utilisées pour le profil d'un bot (grammY `Api` ; simulées dans les tests). */
export type AssistantProfileApi = Pick<
  Api,
  "setMyDescription" | "setMyShortDescription" | "setMyCommands" | "deleteMyCommands"
>;

/** Repère du profil posé par nous (`Setting` `assistant.botProfile.<botId>`) : langues à retirer plus tard. */
export const ASSISTANT_PROFILE_SETTING_PREFIX = "assistant.botProfile.";

export type AssistantProfileReport =
  | { mode: "ASSISTANT"; applied: true; languages: string[]; warnings: string[] }
  | { mode: "ASSISTANT"; applied: false; reason: "no_persona"; warnings: string[] }
  | { mode: "STANDARD"; cleared: boolean; languages: string[] };

function storedProfileLanguages(value: unknown): ChatLang[] | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as { languages?: unknown }).languages;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (l): l is ChatLang => typeof l === "string" && PROFILE_LANGS.includes(l as ChatLang),
  );
}

/** Retire la description, la description courte et les commandes d'une langue (null = valeur par défaut). */
async function clearProfileLanguage(
  api: AssistantProfileApi,
  lang: ChatLang | null,
): Promise<void> {
  const other = lang ? { language_code: lang } : undefined;
  await api.setMyDescription("", other);
  await api.setMyShortDescription("", other);
  await api.deleteMyCommands(other);
}

/**
 * Pose le profil Telegram d'un bot selon son mode (contrat docs/ASSISTANT-CONVERSATION.md § 4) :
 * - bot ASSISTANT avec persona : description et description courte qui DISENT que c'est l'assistante / l'assistant du
 *   canal (une IA), par langue de la persona (textes de la fiche s'ils disent « assistant(e) », sinon refusés), et
 *   commandes `/start`, `/stop` « Arrêter la conversation », `/reset` « Tout effacer et recommencer », traduites ; les
 *   langues posées avant et absentes maintenant sont retirées ;
 * - bot ASSISTANT sans persona : rien n'est posé (`no_persona`) ;
 * - bot normal : remise à vide de ce que nous avions posé (repère `assistant.botProfile.<botId>`), jamais d'un profil
 *   écrit par l'équipe dans @BotFather.
 * Lève sur un refus de Telegram (l'appelant affiche l'erreur).
 */
export async function setAssistantProfile(
  botId: string,
  opts: { api?: AssistantProfileApi } = {},
): Promise<AssistantProfileReport> {
  const bot = await prisma.bot.findUniqueOrThrow({
    where: { id: botId },
    include: {
      persona: {
        select: {
          name: true,
          gender: true,
          languages: true,
          botDescription: true,
          botShortDescription: true,
        },
      },
    },
  });
  const api: AssistantProfileApi = opts.api ?? getOrCreateBot(bot, prismaTelegramDeps).api;
  const key = `${ASSISTANT_PROFILE_SETTING_PREFIX}${bot.id}`;
  const marker = await prisma.setting.findUnique({ where: { key } });
  const previous = storedProfileLanguages(marker?.value);

  if (bot.mode !== "ASSISTANT") {
    if (previous === null) return { mode: "STANDARD", cleared: false, languages: [] };
    await clearProfileLanguage(api, null);
    for (const lang of previous) await clearProfileLanguage(api, lang);
    await prisma.setting.delete({ where: { key } }).catch(() => undefined);
    return { mode: "STANDARD", cleared: true, languages: previous };
  }

  if (!bot.persona)
    return { mode: "ASSISTANT", applied: false, reason: "no_persona", warnings: [] };
  const plan = assistantProfilePlan(bot.persona);
  for (const entry of plan.entries) {
    const other = entry.languageCode ? { language_code: entry.languageCode } : undefined;
    // Garde-fou (règle 2 du client) : jamais une description qui ne dit pas « assistant(e) » ou qui nie être une IA.
    if (
      !assistantProfileTextOk(entry.description) ||
      !assistantProfileTextOk(entry.shortDescription)
    )
      throw new Error(
        "Description du bot refusée : elle doit dire que c'est l'assistante ou l'assistant du canal, sans laisser croire à une vraie personne.",
      );
    await api.setMyDescription(entry.description, other);
    await api.setMyShortDescription(entry.shortDescription, other);
    await api.setMyCommands(entry.commands, other);
  }
  for (const lang of previous ?? [])
    if (!plan.languages.includes(lang)) await clearProfileLanguage(api, lang);
  const value = toJsonValue({ languages: plan.languages, setAt: new Date().toISOString() });
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  return { mode: "ASSISTANT", applied: true, languages: plan.languages, warnings: plan.warnings };
}

// ============================================================
// Canaux existants : import par lien public, par identifiant, re-vérification des droits (tous nos bots)
// ============================================================

export type ChannelBotRight = {
  botId: string;
  telegramBotId: bigint;
  username: string;
  rights: Record<string, boolean | string | undefined>;
};

export type ReadAdminsResult =
  | { ok: true; admins: ChannelBotRight[]; readBy: string; readByBotId: string }
  | { ok: false; reason: "no_bot" | "not_admin" | "error"; message: string };

/**
 * Bot actif tel que lu en base pour les vérifications (jamais le jeton en clair). Lecture seule des droits : les bots
 * assistants de conversation en font partie (leur mode garde la bonne instance en cache).
 */
export type ActiveBot = {
  id: string;
  name: string;
  username: string;
  telegramBotId: bigint;
  vertical: Vertical;
  tokenEncrypted: string;
  mode?: BotMode;
  personaId?: string | null;
};

/**
 * API grammY d'un de nos bots : l'instance mise en cache (la même que celle des webhooks), ce qui évite de recréer un client
 * à chaque appel et permet aux tests d'intercepter les appels comme pour le webhook.
 */
function apiFor(bot: ActiveBot): Api {
  return getOrCreateBot(bot, prismaTelegramDeps).api;
}

/** Nos bots actifs, du plus ancien au plus récent (ordre stable des essais). */
export async function listActiveBots(): Promise<ActiveBot[]> {
  // Phase 26 : jamais le Boss (il n'administre aucun canal).
  return prisma.bot.findMany({
    where: { isActive: true, ...CHANNEL_BOT_WHERE },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      username: true,
      telegramBotId: true,
      vertical: true,
      tokenEncrypted: true,
      mode: true,
      personaId: true,
    },
  });
}

/**
 * Lit la liste des administrateurs d'un chat (avec `return_bots` : nos autres bots y figurent) avec le premier de nos bots actifs
 * qui y a accès : un seul appel réussi suffit, la liste est complète. Renvoie ceux de nos bots qui en font partie. Aucune écriture en base.
 */
export async function readOurAdminsForChat(
  telegramChatId: bigint | number,
  bots?: ActiveBot[],
): Promise<ReadAdminsResult> {
  const list = bots ?? (await listActiveBots());
  if (list.length === 0) return { ok: false, reason: "no_bot", message: "Aucun bot actif." };
  const byTelegramId = new Map(list.map((b) => [b.telegramBotId.toString(), b]));
  let lastError: unknown = null;
  let accessErrors = 0;
  for (const bot of list) {
    try {
      const members = await apiFor(bot).getChatAdministrators(Number(telegramChatId), {
        return_bots: true,
      });
      const admins: ChannelBotRight[] = [];
      for (const m of members) {
        const ours = m.user.is_bot ? byTelegramId.get(String(m.user.id)) : undefined;
        if (!ours || !isAdminStatus(m)) continue;
        admins.push({
          botId: ours.id,
          telegramBotId: ours.telegramBotId,
          username: ours.username,
          rights: extractAdminRights(m),
        });
      }
      return { ok: true, admins, readBy: bot.username, readByBotId: bot.id };
    } catch (err) {
      lastError = err;
      if (isTelegramAccessError(err)) accessErrors += 1;
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  // Tous nos bots ont reçu un refus d'accès : aucun n'est administrateur. Sinon (réseau, 429…), on ne conclut rien.
  return accessErrors === list.length
    ? { ok: false, reason: "not_admin", message }
    : { ok: false, reason: "error", message };
}

export type RecheckResult = {
  channelId: string;
  title: string;
  admins: ChannelBotRight[];
  /** Bots dont les droits viennent d'être retirés en base. */
  revoked: string[];
  /** « ok » : liste lue ; « not_admin » : aucun de nos bots n'a accès ; « unavailable » : vérification impossible pour le moment ; « no_bot » : aucun bot actif. */
  status: "ok" | "not_admin" | "unavailable" | "no_bot";
  /** Vide si la lecture a réussi ; sinon l'explication (aucun bot administrateur, ou erreur réseau). */
  warning: string | null;
};

/**
 * Re-vérifie les droits de nos bots sur un canal (`getChatAdministrators` via le premier bot actif qui y a accès) et met à jour
 * `ChannelBotAdmin` (ajout / retrait). Un bot enregistré comme administrateur mais absent de la liste n'est retiré qu'après
 * confirmation par `getChatMember` ; en cas de doute (réseau), ses droits sont conservés. Audit `channel.rights_rechecked` sauf `audit: false`.
 */
export async function recheckChannelRights(
  channelId: string,
  opts: { userId?: string | null; audit?: boolean } = {},
): Promise<RecheckResult> {
  const channel = await prisma.channel.findUniqueOrThrow({
    where: { id: channelId },
    select: { id: true, title: true, telegramChatId: true },
  });
  const bots = await listActiveBots();
  const read = await readOurAdminsForChat(channel.telegramChatId, bots);
  const before = await prisma.channelBotAdmin.findMany({
    where: { channelId, revokedAt: null },
    select: { botId: true },
  });
  const wasAdmin = (botId: string) => before.some((x) => x.botId === botId);
  const revoked: string[] = [];
  let admins: ChannelBotRight[] = [];
  let warning: string | null = null;
  let status: RecheckResult["status"];

  if (read.ok) {
    status = "ok";
    admins = [...read.admins];
    const reader = bots.find((b) => b.id === read.readByBotId);
    for (const a of admins)
      await prismaTelegramDeps.setChannelAdmin(channelId, a.telegramBotId, a.rights);
    for (const b of bots) {
      if (admins.some((a) => a.botId === b.id) || !wasAdmin(b.id)) continue;
      // Enregistré comme administrateur mais absent de la liste : on confirme avant de retirer.
      const presence = reader
        ? await botPresence(apiFor(reader), Number(channel.telegramChatId), b.telegramBotId)
        : ({ status: "unknown" } as const);
      if (presence.status === "admin") {
        const rights = extractAdminRights(presence.member);
        await prismaTelegramDeps.setChannelAdmin(channelId, b.telegramBotId, rights);
        admins.push({ botId: b.id, telegramBotId: b.telegramBotId, username: b.username, rights });
      } else if (presence.status === "absent") {
        revoked.push(b.username);
        await prismaTelegramDeps.revokeChannelAdmin(channelId, b.telegramBotId);
      }
    }
  } else if (read.reason === "not_admin") {
    status = "not_admin";
    // Tous nos bots reçoivent un refus d'accès : aucun n'est plus administrateur.
    for (const b of bots) {
      if (!wasAdmin(b.id)) continue;
      revoked.push(b.username);
      await prismaTelegramDeps.revokeChannelAdmin(channelId, b.telegramBotId);
    }
    warning = "Aucun de nos bots n'est administrateur de ce canal.";
  } else if (read.reason === "no_bot") {
    status = "no_bot";
    warning = "Aucun bot actif : impossible de vérifier.";
  } else {
    status = "unavailable";
    warning = `Vérification impossible pour le moment (${read.message}). Les droits enregistrés sont conservés.`;
  }

  if (opts.audit !== false) {
    await audit({
      userId: opts.userId ?? null,
      action: "channel.rights_rechecked",
      entityType: "Channel",
      entityId: channelId,
      metadata: { admins: admins.map((a) => a.username), revoked, status, warning },
    });
  }
  return { channelId, title: channel.title, admins, revoked, status, warning };
}

/** Re-vérifie les droits sur tous les canaux actifs (un audit par canal), 5 canaux à la fois. */
export async function recheckAllChannelRights(
  opts: { userId?: string | null } = {},
): Promise<RecheckResult[]> {
  const channels = await prisma.channel.findMany({
    where: { isActive: true },
    orderBy: { title: "asc" },
    select: { id: true },
  });
  return mapWithLimit(channels, 5, (c) => recheckChannelRights(c.id, opts));
}

/** `fn` sur chaque élément, `limit` à la fois au plus ; résultats dans l'ordre d'entrée. */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

export type ImportedChannel = {
  channelId: string;
  title: string;
  created: boolean;
  admins: ChannelBotRight[];
  /** Statut de la re-vérification des droits : `admins` vide ne veut dire « aucun bot » que si le statut est `not_admin`. */
  status: RecheckResult["status"];
  warning: string | null;
};

/** La re-vérification n'a pas pu conclure (réseau, 429, aucun bot actif) : les droits ne sont pas connus. */
export function rightsUnverified(status: RecheckResult["status"]): boolean {
  return status === "unavailable" || status === "no_bot";
}

/** Phrase de confirmation commune aux trois méthodes d'ajout. */
export function importedChannelMessage(r: ImportedChannel): string {
  const verb = r.created ? "ajouté" : "déjà connu, mis à jour";
  const admins =
    r.admins.length > 0
      ? `bots administrateurs : ${r.admins.map((a) => `@${a.username}`).join(", ")}`
      : rightsUnverified(r.status)
        ? "droits de nos bots non vérifiables pour le moment : cliquez « Re-vérifier les droits des bots » dans une minute"
        : "aucun de nos bots n'est administrateur : ajoutez-en un dans Telegram (Canal → Administrateurs → Ajouter)";
  return `Canal « ${r.title} » ${verb} ✅ (${admins})`;
}

/** Raison d'un échec d'import (texte lisible dans `message`, code pour le bot qui répond dans la langue du membre). */
export type ChannelImportErrorCode =
  "invite" | "private" | "invalid" | "not_found" | "person" | "no_bot" | "unavailable";

export class ChannelImportError extends Error {
  readonly code: ChannelImportErrorCode;
  constructor(code: ChannelImportErrorCode, message: string) {
    super(message);
    this.name = "ChannelImportError";
    this.code = code;
  }
}

const METHOD_1 = "utilisez la méthode 1 (transférer un message du canal à l'un des bots)";

/** Enregistre un chat Telegram connu (objet `Chat`) comme canal, relève les droits, audite avec la source donnée. */
export async function importChannelFromChat(
  chat: Chat,
  opts: {
    source: "channel.imported_by_link" | "channel.imported_from_account";
    userId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<ImportedChannel> {
  if (chat.type === "private")
    throw new ChannelImportError("person", "Ce lien désigne une personne, pas un canal.");
  const { channelId, created = false } = await prismaTelegramDeps.upsertChannel(chat);
  const r = await recheckChannelRights(channelId, { userId: opts.userId, audit: false });
  if (created) await prismaTelegramDeps.initPrimaryBot?.(channelId, null);
  await audit({
    userId: opts.userId ?? null,
    action: opts.source,
    entityType: "Channel",
    entityId: channelId,
    metadata: {
      ...(opts.metadata ?? {}),
      title: r.title,
      telegramChatId: String(chat.id),
      created,
      admins: r.admins.map((a) => a.username),
    },
  });
  return {
    channelId,
    title: r.title,
    created,
    admins: r.admins,
    status: r.status,
    warning: r.warning,
  };
}

/**
 * Méthode 2 : import d'un canal public par son nom (`t.me/<nom>`, `t.me/s/<nom>`, `@nom`, `nom`) → `getChat` avec le premier bot actif
 * (puis les autres en cas de panne passagère) → création du canal et relevé des droits de tous nos bots.
 * Erreurs `ChannelImportError` lisibles (canal privé ou nom faux : utiliser la méthode 1).
 */
export async function importChannelByUsername(
  input: string,
  opts: { userId?: string | null; metadata?: Record<string, unknown> } = {},
): Promise<ImportedChannel> {
  const parsed = parseChannelLink(input);
  if (parsed.kind === "invite")
    throw new ChannelImportError(
      "invite",
      `Ce lien est un lien d'invitation privé : il ne permet pas de retrouver le canal. ${METHOD_1.charAt(0).toUpperCase()}${METHOD_1.slice(1)}.`,
    );
  if (parsed.kind === "private")
    throw new ChannelImportError(
      "private",
      `Ce lien est celui d'un message de canal privé : il ne permet pas de retrouver le canal. ${METHOD_1.charAt(0).toUpperCase()}${METHOD_1.slice(1)}.`,
    );
  if (parsed.kind === "invalid")
    throw new ChannelImportError(
      "invalid",
      "Nom de canal invalide. Collez un lien comme t.me/mon_canal ou @mon_canal (lettres, chiffres et _ ; 4 caractères au moins).",
    );
  const bots = await listActiveBots();
  if (bots.length === 0)
    throw new ChannelImportError(
      "no_bot",
      "Aucun bot actif : ajoutez d'abord un bot (Réglages → Bots).",
    );
  let chat: Chat | null = null;
  let lastError: unknown = null;
  for (const bot of bots) {
    try {
      chat = chatFromFullInfo(await apiFor(bot).getChat(`@${parsed.username}`));
      if (!chat)
        throw new ChannelImportError("person", "Ce lien désigne une personne, pas un canal.");
      break;
    } catch (err) {
      if (err instanceof ChannelImportError) throw err;
      lastError = err;
      // Nom introuvable : la réponse serait la même avec nos autres bots.
      if (isTelegramAccessError(err)) break;
    }
  }
  if (!chat) {
    if (isTelegramAccessError(lastError)) {
      const detail = lastError instanceof GrammyError ? lastError.description : "";
      throw new ChannelImportError(
        "not_found",
        `Ce canal est privé ou le nom est faux : ${METHOD_1}.${detail ? ` Telegram : ${detail}` : ""}`,
      );
    }
    throw new ChannelImportError(
      "unavailable",
      "Vérification impossible pour le moment, réessayez dans une minute.",
    );
  }
  return importChannelFromChat(chat, {
    source: "channel.imported_by_link",
    userId: opts.userId,
    metadata: { ...(opts.metadata ?? {}), username: parsed.username },
  });
}

/**
 * Méthode « Importer tous mes canaux » : un canal connu par son identifiant Telegram (compte utilisateur MTProto).
 * `getChat` via nos bots pour un titre à jour quand l'un d'eux y a accès ; sinon les informations fournies suffisent.
 */
export async function importChannelByChatId(
  input: { telegramChatId: bigint; title: string; username: string | null; isBroadcast?: boolean },
  opts: { userId?: string | null; bots?: ActiveBot[] } = {},
): Promise<ImportedChannel> {
  const bots = opts.bots ?? (await listActiveBots());
  let chat: Chat | null = null;
  for (const bot of bots) {
    try {
      chat = chatFromFullInfo(await apiFor(bot).getChat(Number(input.telegramChatId)));
      if (chat) break;
    } catch {
      /* ce bot n'a pas accès : on essaie le suivant */
    }
  }
  chat ??=
    input.isBroadcast === false
      ? {
          id: Number(input.telegramChatId),
          type: "supergroup",
          title: input.title,
          username: input.username ?? undefined,
        }
      : {
          id: Number(input.telegramChatId),
          type: "channel",
          title: input.title,
          username: input.username ?? undefined,
        };
  return importChannelFromChat(chat, {
    source: "channel.imported_from_account",
    userId: opts.userId,
  });
}

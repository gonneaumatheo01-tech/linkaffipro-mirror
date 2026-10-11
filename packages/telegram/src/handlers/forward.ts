import type { Bot, Context } from "grammy";
import type { Chat, ChatFullInfo, Message } from "grammy/types";
import { pickLang, t, type Lang } from "../i18n";
import type { BotIdentity, OurBotAdmin, TelegramDeps } from "../ports";
import { findChannelLinkInText, parseChannelLink } from "../channels/username";
import { syncChannelRights } from "./channels";

/** Canal d'origine d'un message transféré (`forward_origin` actuel, ou l'ancien `forward_from_chat`). */
export function forwardedChannelOf(msg: Message): Chat.ChannelChat | null {
  const origin = msg.forward_origin;
  if (origin?.type === "channel" && origin.chat?.type === "channel") return origin.chat;
  const legacy = (msg as { forward_from_chat?: Chat }).forward_from_chat;
  if (legacy && legacy.type === "channel") return legacy;
  return null;
}

/** Le message est-il un transfert (quelle que soit son origine : personne, groupe, compte masqué) ? */
function isForwarded(msg: Message): boolean {
  const legacy = msg as {
    forward_from?: unknown;
    forward_from_chat?: unknown;
    forward_sender_name?: unknown;
    forward_date?: unknown;
  };
  return Boolean(
    msg.forward_origin ||
    legacy.forward_from ||
    legacy.forward_from_chat ||
    legacy.forward_sender_name ||
    legacy.forward_date,
  );
}

/** Réduit la réponse de `getChat` à la forme `Chat` attendue par `upsertChannel`. */
export function chatFromFullInfo(full: ChatFullInfo): Chat | null {
  if (full.type === "private") return null;
  if (full.type === "channel")
    return { id: full.id, type: "channel", title: full.title, username: full.username };
  if (full.type === "supergroup")
    return { id: full.id, type: "supergroup", title: full.title, username: full.username };
  return { id: full.id, type: "group", title: full.title };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Texte de confirmation en français (les utilisateurs de la plateforme sont l'équipe). */
export function forwardReplyText(
  title: string,
  admins: OurBotAdmin[],
  botUsername: string,
): string {
  const name = escapeHtml(title);
  if (admins.length > 0) {
    return `Canal « ${name} » ajouté ✅ (bots administrateurs : ${admins.map((a) => `@${a.username}`).join(", ")})`;
  }
  return [
    `Canal « ${name} » ajouté, mais aucun de nos bots n'en est administrateur ⚠️`,
    "",
    "Pour que le bot puisse accueillir les membres, ajoutez-le comme administrateur dans Telegram :",
    `ouvrez le canal → Administrateurs → Ajouter un administrateur → @${botUsername} → validez (droit « Ajouter des membres »).`,
    "",
    "Puis transférez-moi de nouveau un message du canal : je vérifierai les droits.",
  ].join("\n");
}

/**
 * Mémoire courte (processus web) des traitements récents : un transfert de 10 messages d'un coup donne une seule réponse
 * et un seul audit. Purement en mémoire : après un redémarrage, au pire une réponse en double.
 */
export class RecentKeys {
  private readonly until = new Map<string, number>();
  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxSize = 5000,
  ) {}

  /** Vrai si la clé a été vue et n'a pas expiré ; sinon la retient pour `ttlMs` et renvoie faux. Synchrone : sûr entre deux `await`. */
  hit(key: string, ttlMs: number): boolean {
    const now = this.now();
    const until = this.until.get(key);
    if (until !== undefined && until > now) return true;
    if (this.until.size >= this.maxSize) {
      for (const [k, v] of this.until) if (v <= now) this.until.delete(k);
      if (this.until.size >= this.maxSize) this.until.clear();
    }
    this.until.set(key, now + ttlMs);
    return false;
  }

  /** Raccourcit la mémoire d'une clé (aucun bot administrateur, vérification impossible : l'utilisateur doit pouvoir réessayer vite). */
  shorten(key: string, ttlMs: number): void {
    if (this.until.has(key)) this.until.set(key, this.now() + ttlMs);
  }
}

/** Clé de la mémoire courte d'un album transféré (`media_group_id`) : un seul traitement pour tout l'album. */
export function albumKey(botId: string, mediaGroupId: string): string {
  return `mg:${botId}:${mediaGroupId}`;
}

/** Fenêtre pendant laquelle un même canal transféré par la même personne au même bot n'est traité qu'une fois. */
export const FORWARD_DEDUP_MS = 60_000;
/** Fenêtre raccourcie quand il faut pouvoir réessayer (aucun bot administrateur, vérification impossible). */
export const FORWARD_RETRY_MS = 5_000;
/** Aide après un transfert sans origine canal : une fois par minute au plus. */
export const HELP_AFTER_FORWARD_MS = 60_000;
/** Aide après un simple texte : une fois toutes les 6 heures au plus (l'admin écrit aussi au bot pour d'autres raisons). */
export const HELP_AFTER_TEXT_MS = 6 * 3600_000;

type MessageCtx = Context & { message: Message; from: NonNullable<Context["from"]> };

async function reply(ctx: Context, text: string): Promise<void> {
  await ctx.reply(text, { link_preview_options: { is_disabled: true } });
}

/** Transfert d'un message de canal par un utilisateur de la plateforme : création du canal et relevé des droits. */
async function handleChannelForward(
  ctx: MessageCtx,
  identity: BotIdentity,
  deps: TelegramDeps,
  origin: Chat.ChannelChat,
  lang: Lang,
  memory: RecentKeys,
): Promise<void> {
  const from = ctx.from;
  // Album transféré : un seul traitement pour tout le groupe de médias ; puis une fois par (bot, personne, canal) et par minute.
  if (
    ctx.message.media_group_id &&
    memory.hit(albumKey(identity.id, ctx.message.media_group_id), FORWARD_DEDUP_MS)
  )
    return;
  const key = `fwd:${identity.id}:${from.id}:${origin.id}`;
  if (memory.hit(key, FORWARD_DEDUP_MS)) return;

  // Titre et nom à jour si le bot a accès au canal ; sinon l'en-tête du transfert suffit.
  let chat: Chat = origin;
  try {
    const full = chatFromFullInfo(await ctx.api.getChat(origin.id));
    if (full) chat = full;
  } catch {
    /* bot absent du canal : on garde les informations du transfert */
  }

  const { channelId, created = false } = await deps.upsertChannel(chat);
  const sync = await syncChannelRights(ctx.api, deps, channelId, chat.id, {
    revokeMissing: !created,
  });
  let admins: OurBotAdmin[] = sync.ok ? sync.ourAdmins : [];
  let unavailable = false;
  if (!sync.ok) {
    // Ce bot n'a pas pu lire la liste : un autre de nos bots est peut-être administrateur (vérification avec leurs propres jetons).
    if (deps.recheckChannelRights) {
      try {
        const r = await deps.recheckChannelRights(channelId);
        admins = r.admins;
        unavailable = r.unavailable;
      } catch (err) {
        unavailable = true;
        console.warn(
          "[telegram] re-vérification des droits impossible pour",
          chat.id,
          (err as Error).message,
        );
      }
    } else {
      unavailable = !sync.accessDenied;
    }
  }
  if (created && deps.initPrimaryBot) {
    try {
      await deps.initPrimaryBot(channelId, identity.telegramBotId);
    } catch (err) {
      console.warn("[telegram] bot principal non posé pour", chat.id, (err as Error).message);
    }
  }
  const title = "title" in chat && chat.title ? chat.title : String(chat.id);
  await deps.auditChannel?.({
    action: "channel.imported_by_forward",
    channelId,
    telegramUserId: BigInt(from.id),
    metadata: {
      title,
      telegramChatId: String(chat.id),
      created,
      admins: admins.map((a) => a.username),
      viaBot: identity.username,
      unavailable,
    },
  });
  if (admins.length === 0) memory.shorten(key, FORWARD_RETRY_MS);
  if (admins.length === 0 && unavailable) {
    await reply(ctx, t(lang, "forwardCheckUnavailable"));
    return;
  }
  await ctx.reply(forwardReplyText(title, admins, identity.username), {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

/** Lien public collé par un utilisateur de la plateforme (méthode 2 depuis le bot). */
async function handleLink(
  ctx: MessageCtx,
  identity: BotIdentity,
  deps: TelegramDeps,
  link: string,
  lang: Lang,
  memory: RecentKeys,
): Promise<void> {
  const parsed = parseChannelLink(link);
  if (parsed.kind === "invite" || parsed.kind === "private")
    return reply(ctx, t(lang, "forwardPrivateLink"));
  if (parsed.kind === "invalid" || !deps.importChannelByLink)
    return reply(ctx, t(lang, "forwardHelp"));
  const key = `link:${identity.id}:${ctx.from.id}:${parsed.username.toLowerCase()}`;
  if (memory.hit(key, FORWARD_DEDUP_MS)) return;
  const r = await deps.importChannelByLink(link, BigInt(ctx.from.id));
  if (r.ok) {
    if (r.admins.length === 0) memory.shorten(key, FORWARD_RETRY_MS);
    // Canal enregistré mais droits non vérifiables (réseau, 429) : ne pas annoncer « aucun de nos bots n'est administrateur ».
    if (r.admins.length === 0 && r.unavailable)
      return reply(ctx, t(lang, "forwardCheckUnavailable"));
    await ctx.reply(forwardReplyText(r.title, r.admins, identity.username), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    return;
  }
  memory.shorten(key, FORWARD_RETRY_MS);
  const textKey =
    r.reason === "private"
      ? "forwardPrivateLink"
      : r.reason === "not_found"
        ? "forwardLinkNotFound"
        : r.reason === "unavailable"
          ? "forwardCheckUnavailable"
          : "forwardHelp";
  await reply(ctx, t(lang, textKey));
}

/**
 * Aide sur un simple texte (ni transfert, ni lien) ? Jamais en réponse à un message, ni pour l'admin du dialogue avec Claude
 * sur le bot casino (celui de `pnpm tg:send`) : ses « fait », « 1 »… sont des réponses lues par `pnpm tg:inbox`.
 */
async function textHelpWanted(
  ctx: MessageCtx,
  identity: BotIdentity,
  deps: TelegramDeps,
): Promise<boolean> {
  if (ctx.message.reply_to_message) return false;
  if (identity.vertical === "CASINO" && deps.isAdminDialogPartner)
    return !(await deps.isAdminDialogPartner(BigInt(ctx.from.id)));
  return true;
}

/**
 * Messages privés des utilisateurs de la plateforme (`User.telegramUserId` ou admin du Setting `admin.telegramUserId`) :
 * - méthode 1 : un message transféré depuis un canal → le canal est créé (ou mis à jour) et les droits de nos bots relevés ;
 * - un message réduit au lien public t.me/<nom> ou au @nom → import du canal (méthode 2) ; un lien cité dans une phrase ou un
 *   lien de bot (offre `?start=`) n'importe rien ;
 * - un transfert sans origine canal → aide courte (transférer un message, ou ajouter le bot puis publier, ou coller le lien) ;
 * - un simple texte → la même aide, sauf réponse à un message ou admin du dialogue avec Claude (`textHelpWanted`).
 * Un expéditeur inconnu passe au traitement habituel (`next()`), sans réponse particulière. Les commandes passent toujours.
 * `memory` : anti-doublons propre à l'instance du bot (une par bot dans le processus web).
 */
export function registerForwardHandlers(
  bot: Bot,
  identity: BotIdentity,
  deps: TelegramDeps,
  memory: RecentKeys = new RecentKeys(),
): void {
  bot.on("message", async (ctx, next) => {
    const from = ctx.from;
    if (!from || ctx.chat.type !== "private") return next();
    const msg = ctx.message;
    const forwarded = isForwarded(msg);
    const text = msg.text ?? "";
    if (!forwarded && text.startsWith("/")) return next();
    const origin = forwardedChannelOf(msg);
    const link = !forwarded && text ? findChannelLinkInText(text) : null;
    // Ni transfert, ni texte (photo, autocollant…) : rien de particulier.
    if (!origin && !forwarded && !text) return next();
    if (!(await deps.isPlatformUser(BigInt(from.id)))) return next();

    const lang = pickLang(from.language_code);
    const c = ctx as MessageCtx;
    if (origin) return handleChannelForward(c, identity, deps, origin, lang, memory);
    if (link) return handleLink(c, identity, deps, link, lang, memory);
    if (!forwarded && !(await textHelpWanted(c, identity, deps))) return next();
    const helpKey = forwarded
      ? `help-fwd:${identity.id}:${from.id}`
      : `help-text:${identity.id}:${from.id}`;
    if (memory.hit(helpKey, forwarded ? HELP_AFTER_FORWARD_MS : HELP_AFTER_TEXT_MS)) return next();
    await reply(ctx, t(lang, "forwardHelp"));
  });
}

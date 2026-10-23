import type { Bot, Context } from "grammy";
import type { Update } from "grammy/types";
import { pickLang, t } from "../i18n";
import { extractAdminRights, isAssistantBot, type BotIdentity, type TelegramDeps } from "../ports";
import { redactAssistantUpdate } from "../assistant/logic";
import {
  ensureChannelKnown,
  isAdminStatus,
  isGroupLike,
  knownChannelFor,
  mayCreateChannelFrom,
  rememberKnownChannel,
} from "./channels";
import { registerCustomEmojiHandlers } from "./custom-emoji";
import { RecentKeys, registerForwardHandlers } from "./forward";
import { registerAgentsAdminHandlers } from "./agents-admin";
import { registerMediaInboxHandlers } from "./media-inbox";
import { redactAdminSecretUpdate } from "../agents/redact";

const UPDATE_TYPES = [
  "message",
  "edited_message",
  "channel_post",
  "edited_channel_post",
  "callback_query",
  "chat_member",
  "my_chat_member",
  "chat_join_request",
  "message_reaction",
  "message_reaction_count",
  "inline_query",
] as const;

/**
 * Faut-il relever les droits de nos bots même sur un canal déjà connu ? Oui sur une publication du canal,
 * et quand le bot lui-même vient d'être nommé administrateur (inutile quand il vient d'être retiré : l'appel échouerait).
 */
function shouldRefreshRights(type: string, update: Update): boolean {
  if (type === "channel_post" || type === "edited_channel_post") return true;
  if (type === "my_chat_member" && update.my_chat_member)
    return isAdminStatus(update.my_chat_member.new_chat_member);
  return false;
}

/** Message (nouveau, pas modifié) envoyé par la personne elle-même dans sa conversation privée avec le bot. */
function wroteToBot(type: string, update: Update, fromId: number): boolean {
  if (type !== "message" || !update.message) return false;
  const chat = update.message.chat;
  return chat.type === "private" && chat.id === fromId;
}

export function updateTypeOf(update: Update): string {
  for (const k of UPDATE_TYPES) if (k in update) return k;
  const other = Object.keys(update).find((k) => k !== "update_id");
  return other ?? "unknown";
}

/** Membre vu par le middleware pour cette update (évite un second enregistrement dans les handlers qui suivent). */
const memberByUpdate = new WeakMap<Update, string>();

/** Identifiant du membre enregistré par le middleware pour cette update, s'il y en a un. */
export function seenMemberIdOf(update: Update): string | undefined {
  return memberByUpdate.get(update);
}

/**
 * Enregistre les handlers de base sur une instance grammY.
 * Tout passe par `deps` (accès base), ce qui permet des tests avec des updates simulées.
 */
export function registerCoreHandlers(
  bot: Bot,
  identity: BotIdentity,
  deps: TelegramDeps,
  hooks: {
    beforeStart?: (bot: Bot) => void;
    /**
     * Phase 17 : bot en mode assistant de conversation. Seuls le middleware (membre vu, journal SANS texte), le statut
     * du bot (`my_chat_member`) et ces handlers sont gardés : ni emojis animés, ni transfert de canal, ni adhésion, ni
     * offres, ni réactions, ni `/start` générique.
     */
    assistant?: (bot: Bot) => void;
  } = {},
): void {
  const assistantMode = isAssistantBot(identity);
  // Journalisation de toute update reçue (append-only) et connaissance du canal :
  // toute mise à jour venant d'un canal inconnu (channel_post, chat_join_request, chat_member, réactions, my_chat_member…)
  // crée le canal et relève les droits de nos bots. Jamais de canal fantôme : un bot retiré d'un chat inconnu, ou un groupe
  // où le bot n'est pas administrateur, ne crée rien (on retrouve seulement le canal s'il est déjà connu).
  bot.use(async (ctx, next) => {
    const type = updateTypeOf(ctx.update);
    const refs: { memberId?: string; channelId?: string } = {};
    try {
      const chat = ctx.chat;
      if (chat && isGroupLike(chat)) {
        if (mayCreateChannelFrom(type, ctx.update, chat)) {
          const known = await ensureChannelKnown(ctx, deps, chat, {
            refreshRights: shouldRefreshRights(type, ctx.update),
          });
          rememberKnownChannel(ctx.update, known);
          refs.channelId = known.channelId;
        } else {
          const channelId = await deps.findChannelId(chat.id);
          if (channelId) {
            rememberKnownChannel(ctx.update, { channelId, created: false, rights: null });
            refs.channelId = channelId;
          }
        }
      }
      if (ctx.from && !ctx.from.is_bot) {
        const { memberId } = await deps.memberSeen(identity, ctx.from);
        refs.memberId = memberId;
        memberByUpdate.set(ctx.update, memberId);
        // Message privé de la personne au bot (« ok », une photo… pas seulement /start) : Telegram laisse ensuite le
        // bot lui écrire, elle devient joignable (« Accepté », rappels tardifs ; phase 14, décision E2).
        if (wroteToBot(type, ctx.update, ctx.from.id)) await deps.memberWrote?.(identity, memberId);
      }
    } catch (err) {
      console.error("[telegram] pré-traitement", err);
    }
    // Bot assistant : le journal ne garde jamais le texte d'une conversation (longueur seulement).
    // Phase 19 : une clé collée par l'admin (« clé fal … », réponse à une demande SECRET) n'est jamais journalisée.
    const logged = assistantMode
      ? redactAssistantUpdate(ctx.update)
      : await redactAdminSecretUpdate(ctx.update, deps);
    await deps.recordUpdate(identity, type, logged, refs);
    await next();
  });

  if (assistantMode) hooks.assistant?.(bot);
  else registerStandardHandlers(bot, identity, deps, hooks.beforeStart);

  registerBotStatusHandlers(bot, identity, deps);
}

/** Handlers d'un bot normal : emojis animés, transfert de canal, handlers spécialisés, puis `/start` générique. */
function registerStandardHandlers(
  bot: Bot,
  identity: BotIdentity,
  deps: TelegramDeps,
  beforeStart: ((bot: Bot) => void) | undefined,
): void {
  // Emojis animés d'un message envoyé par l'équipe (bibliothèque, phase 12) : avant le transfert de canal, qui suit
  // seulement quand le message vient d'un de nos canaux (déjà connu, ou dont l'un de nos bots est administrateur).
  // Mémoire courte partagée : un album d'un canal tiers n'est pas ajouté par ses autres photos.
  // Phase 19 : dialogue admin des agents (boutons de validation, réponses, commandes) puis dépôt dans la médiathèque,
  // avant les emojis animés et le transfert de canal (un média sans mot-clé de médiathèque continue vers eux).
  registerAgentsAdminHandlers(bot, identity, deps);
  registerMediaInboxHandlers(bot, identity, deps);

  const forwardMemory = new RecentKeys();
  registerCustomEmojiHandlers(bot, identity, deps, forwardMemory);

  // Transfert d'un message de canal au bot (ajout d'un canal existant) : avant tout `/start`.
  registerForwardHandlers(bot, identity, deps, forwardMemory);

  // Handlers spécialisés (adhésion, offres, réactions) : ils doivent passer avant le /start générique.
  beforeStart?.(bot);

  bot.command("start", async (ctx: Context) => {
    const from = ctx.from;
    if (!from || ctx.chat?.type !== "private") return;
    const payload = typeof ctx.match === "string" && ctx.match.length > 0 ? ctx.match : undefined;
    // Charges utiles réservées aux handlers spécialisés (déjà traitées en amont si implémentées).
    if (payload && /^[go][A-Za-z0-9_-]/.test(payload) && !payload.startsWith("admin_")) return;
    const lang = pickLang(from.language_code);

    if (payload?.startsWith("admin_")) {
      const linked = await deps.linkAdminAccount(payload.slice("admin_".length), BigInt(from.id));
      await deps.memberStarted(identity, from, payload);
      await ctx.reply(
        linked ? t(lang, "adminLinked", { name: linked.name }) : t(lang, "adminLinkInvalid"),
      );
      return;
    }

    await deps.memberStarted(identity, from, payload);
    await ctx.reply(t(lang, "welcome", { botName: identity.name, vertical: identity.vertical }));
  });
}

/** Statut du bot (tous les modes) : ajouté / retiré d'un canal, bloqué / débloqué par un membre, erreurs. */
function registerBotStatusHandlers(bot: Bot, identity: BotIdentity, deps: TelegramDeps): void {
  // Le bot est ajouté / retiré d'un canal, ou bloqué / débloqué par un membre en privé.
  bot.on("my_chat_member", async (ctx) => {
    const upd = ctx.myChatMember;
    const chat = upd.chat;
    const newMember = upd.new_chat_member;

    if (chat.type === "private") {
      const blocked = newMember.status === "kicked" || newMember.status === "left";
      await deps.memberDmStatus(identity, upd.from, !blocked);
      return;
    }
    if (!isGroupLike(chat)) return;

    // Le middleware a déjà créé le canal (si permis) et tenté le relevé complet des droits ; ici on applique le statut du bot
    // lui-même, qui fait foi (le relevé échoue justement quand le bot vient d'être retiré ou n'est pas administrateur).
    const known = knownChannelFor(ctx.update);
    if (isAdminStatus(newMember)) {
      const channelId = known?.channelId ?? (await deps.upsertChannel(chat)).channelId;
      if (!known?.rights?.ok)
        await deps.setChannelAdmin(
          channelId,
          identity.telegramBotId,
          extractAdminRights(newMember),
        );
    } else {
      // Retiré (ou rétrogradé) : seulement sur un canal déjà connu ; un chat inconnu n'est jamais créé pour ça.
      const channelId = known?.channelId ?? (await deps.findChannelId(chat.id));
      if (channelId) await deps.revokeChannelAdmin(channelId, identity.telegramBotId);
    }
  });

  bot.catch((err) => {
    console.error("[telegram] erreur handler", identity.username, err.error);
  });
}

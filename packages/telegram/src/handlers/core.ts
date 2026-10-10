import type { Bot, Context } from "grammy";
import type { Update } from "grammy/types";
import { pickLang, t } from "../i18n";
import { extractAdminRights, type BotIdentity, type TelegramDeps } from "../ports";
import {
  ensureChannelKnown,
  isAdminStatus,
  isGroupLike,
  knownChannelFor,
  mayCreateChannelFrom,
  rememberKnownChannel,
} from "./channels";
import { registerForwardHandlers } from "./forward";

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

export function updateTypeOf(update: Update): string {
  for (const k of UPDATE_TYPES) if (k in update) return k;
  const other = Object.keys(update).find((k) => k !== "update_id");
  return other ?? "unknown";
}

/**
 * Enregistre les handlers de base sur une instance grammY.
 * Tout passe par `deps` (accès base), ce qui permet des tests avec des updates simulées.
 */
export function registerCoreHandlers(
  bot: Bot,
  identity: BotIdentity,
  deps: TelegramDeps,
  hooks: { beforeStart?: (bot: Bot) => void } = {},
): void {
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
      }
    } catch (err) {
      console.error("[telegram] pré-traitement", err);
    }
    await deps.recordUpdate(identity, type, ctx.update, refs);
    await next();
  });

  // Transfert d'un message de canal au bot (ajout d'un canal existant) : avant tout `/start`.
  registerForwardHandlers(bot, identity, deps);

  // Handlers spécialisés (adhésion, offres, réactions) : ils doivent passer avant le /start générique.
  hooks.beforeStart?.(bot);

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

import type { Bot, Context } from "grammy";
import type { Chat, ChatMember, Update } from "grammy/types";
import { pickLang, t } from "../i18n";
import { extractAdminRights, type BotIdentity, type TelegramDeps } from "../ports";

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

export function updateTypeOf(update: Update): string {
  for (const k of UPDATE_TYPES) if (k in update) return k;
  const other = Object.keys(update).find((k) => k !== "update_id");
  return other ?? "unknown";
}

function isGroupLike(chat: Chat): boolean {
  return chat.type === "channel" || chat.type === "supergroup" || chat.type === "group";
}

function isAdminStatus(m: ChatMember): m is Extract<ChatMember, { status: "administrator" | "creator" }> {
  return m.status === "administrator" || m.status === "creator";
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
  // Journalisation de toute update reçue (append-only).
  bot.use(async (ctx, next) => {
    const type = updateTypeOf(ctx.update);
    const refs: { memberId?: string; channelId?: string } = {};
    try {
      const chat = ctx.chat;
      if (chat && isGroupLike(chat)) {
        const { channelId } = await deps.upsertChannel(chat);
        refs.channelId = channelId;
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
      await ctx.reply(linked ? t(lang, "adminLinked", { name: linked.name }) : t(lang, "adminLinkInvalid"));
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

    const { channelId } = await deps.upsertChannel(chat);
    if (isAdminStatus(newMember)) {
      await deps.setChannelAdmin(channelId, identity.telegramBotId, extractAdminRights(newMember));
    } else {
      await deps.revokeChannelAdmin(channelId, identity.telegramBotId);
    }
  });

  // Un message est publié dans un canal : on s'assure de connaître le canal et ses administrateurs.
  bot.on(["channel_post", "edited_channel_post"], async (ctx) => {
    const chat = ctx.chat;
    if (!chat || !isGroupLike(chat)) return;
    const { channelId } = await deps.upsertChannel(chat);
    try {
      const admins = await ctx.api.getChatAdministrators(chat.id);
      const ours = new Set((await deps.listOurBotTelegramIds()).map(String));
      for (const admin of admins) {
        if (!admin.user.is_bot || !ours.has(String(admin.user.id))) continue;
        if (isAdminStatus(admin)) {
          await deps.setChannelAdmin(channelId, BigInt(admin.user.id), extractAdminRights(admin));
        }
      }
    } catch (err) {
      // Sans droit d'administrateur, getChatAdministrators échoue : ce n'est pas une erreur bloquante.
      console.warn("[telegram] getChatAdministrators impossible pour", chat.id, (err as Error).message);
    }
  });

  bot.catch((err) => {
    console.error("[telegram] erreur handler", identity.username, err.error);
  });
}

import type { Bot } from "grammy";
import type { Chat, ChatFullInfo, Message } from "grammy/types";
import { pickLang, t } from "../i18n";
import type { BotIdentity, OurBotAdmin, TelegramDeps } from "../ports";
import { syncChannelRights } from "./channels";

/** Canal d'origine d'un message transféré (`forward_origin` actuel, ou l'ancien `forward_from_chat`). */
export function forwardedChannelOf(msg: Message): Chat.ChannelChat | null {
  const origin = msg.forward_origin;
  if (origin?.type === "channel" && origin.chat?.type === "channel") return origin.chat;
  const legacy = (msg as { forward_from_chat?: Chat }).forward_from_chat;
  if (legacy && legacy.type === "channel") return legacy;
  return null;
}

/** Réduit la réponse de `getChat` à la forme `Chat` attendue par `upsertChannel`. */
export function chatFromFullInfo(full: ChatFullInfo): Chat | null {
  if (full.type === "private") return null;
  if (full.type === "channel") return { id: full.id, type: "channel", title: full.title, username: full.username };
  if (full.type === "supergroup") return { id: full.id, type: "supergroup", title: full.title, username: full.username };
  return { id: full.id, type: "group", title: full.title };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Texte de confirmation en français (les utilisateurs de la plateforme sont l'équipe). */
export function forwardReplyText(title: string, admins: OurBotAdmin[], botUsername: string): string {
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
 * Méthode 1 d'ajout d'un canal existant : un utilisateur de la plateforme transfère un message du canal au bot en privé.
 * Le canal est créé (ou mis à jour) et les droits de nos bots relevés ; réponse en français.
 * Expéditeur inconnu : réponse neutre, aucune action.
 */
export function registerForwardHandlers(bot: Bot, identity: BotIdentity, deps: TelegramDeps): void {
  bot.on("message", async (ctx, next) => {
    const from = ctx.from;
    if (!from || ctx.chat.type !== "private") return next();
    const origin = forwardedChannelOf(ctx.message);
    if (!origin) return next();

    if (!(await deps.isPlatformUser(BigInt(from.id)))) {
      await ctx.reply(t(pickLang(from.language_code), "forwardUnknownUser"));
      return;
    }

    // Titre et nom à jour si le bot a accès au canal ; sinon l'en-tête du transfert suffit.
    let chat: Chat = origin;
    try {
      const full = chatFromFullInfo(await ctx.api.getChat(origin.id));
      if (full) chat = full;
    } catch {
      /* bot absent du canal : on garde les informations du transfert */
    }

    const { channelId, created = false } = await deps.upsertChannel(chat);
    const sync = await syncChannelRights(ctx.api, deps, channelId, chat.id, { revokeMissing: true });
    let admins: OurBotAdmin[] = sync.ok ? sync.ourAdmins : [];
    // Ce bot n'est pas administrateur : un autre de nos bots l'est peut-être (vérification avec leurs propres jetons).
    if (!sync.ok && deps.recheckChannelRights) {
      try {
        admins = await deps.recheckChannelRights(channelId);
      } catch (err) {
        console.warn("[telegram] re-vérification des droits impossible pour", chat.id, (err as Error).message);
      }
    }
    const title = "title" in chat && chat.title ? chat.title : String(chat.id);
    await deps.auditChannel?.({
      action: "channel.imported_by_forward",
      channelId,
      telegramUserId: BigInt(from.id),
      metadata: { title, telegramChatId: String(chat.id), created, admins: admins.map((a) => a.username), viaBot: identity.username },
    });
    await ctx.reply(forwardReplyText(title, admins, identity.username), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });
}

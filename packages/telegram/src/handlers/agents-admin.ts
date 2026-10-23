import type { Bot, Context } from "grammy";
import { GrammyError } from "grammy";
import { handleAdminText, handleAgentsCallback } from "@linkaffipro/agents";
import type { BotIdentity, TelegramDeps } from "../ports";
import { htmlToPlain } from "../agents/admin-messenger";

/** Réponse en HTML, repli en texte brut si Telegram refuse le HTML. */
async function replyHtml(ctx: Context, text: string): Promise<void> {
  try {
    await ctx.reply(text, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  } catch (err) {
    if (err instanceof GrammyError && /parse entities/i.test(err.description))
      await ctx.reply(htmlToPlain(text), { link_preview_options: { is_disabled: true } });
    else throw err;
  }
}

/**
 * Phase 19 : dialogue admin des agents. Boutons des aperçus (`agv:<id>:ok|edit|no`) et messages texte privés de
 * l'admin (`Setting` `admin.telegramUserId`) : réponses aux demandes, correction d'un post, commandes (« agents »,
 * « pause dating », « ok 12 », « clé fal … »…). Un message qui contenait un secret est supprimé aussitôt.
 * Toute autre personne, et tout message que les agents ne prennent pas : traitement habituel (`next()`).
 * Enregistré avant les emojis animés et le transfert de canal (un texte corrigé peut contenir des emojis animés).
 */
export function registerAgentsAdminHandlers(bot: Bot, identity: BotIdentity, deps: TelegramDeps): void {
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    if (!data.startsWith("agv:") || !deps.agentsDeps) return next();
    try {
      const r = await handleAgentsCallback(deps.agentsDeps(), { data, fromTelegramId: BigInt(ctx.from.id) });
      await ctx.answerCallbackQuery(r.toast ? { text: r.toast } : undefined).catch(() => undefined);
      if (r.removeButtons) await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
      if (r.reply) await replyHtml(ctx, r.reply);
    } catch (err) {
      console.error("[agents] bouton de validation", identity.username, (err as Error).message);
      await ctx.answerCallbackQuery({ text: "Erreur : réessaie dans un instant." }).catch(() => undefined);
    }
  });

  bot.on("message:text", async (ctx, next) => {
    const from = ctx.from;
    if (ctx.chat.type !== "private" || from.is_bot || !deps.agentsDeps || !deps.isAdminDialogPartner) return next();
    const msg = ctx.message;
    if (msg.text.startsWith("/") || msg.forward_origin) return next();
    if (!(await deps.isAdminDialogPartner(BigInt(from.id)))) return next();
    const agents = deps.agentsDeps();
    let r: Awaited<ReturnType<typeof handleAdminText>>;
    try {
      r = await handleAdminText(agents, {
        text: msg.text,
        messageId: msg.message_id,
        replyToMessageId: msg.reply_to_message?.message_id ?? null,
      });
    } catch (err) {
      console.error("[agents] dialogue admin", identity.username, (err as Error).message);
      await ctx.reply("Oups, je n'ai pas pu traiter ce message. Réessaie dans un instant.");
      return;
    }
    if (!r.handled) return next();
    // Le secret ne reste pas dans la conversation (suppression possible en privé pour un message reçu).
    if (r.deleteMessage) await ctx.api.deleteMessage(ctx.chat.id, msg.message_id).catch(() => undefined);
    if (r.reply) await replyHtml(ctx, r.reply);
    if (r.followUp) await r.followUp().catch((err) => console.error("[agents] question suivante", (err as Error).message));
  });
}

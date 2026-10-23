import type { Bot, Context } from "grammy";
import { GrammyError } from "grammy";
import { handleAdminText, handleAgentsCallback, isAgentsCallbackData } from "@linkaffipro/agents";
import type { BotIdentity, TelegramDeps } from "../ports";
import { htmlToPlain } from "../agents/admin-messenger";

/** Taille maximale d'un vocal de l'admin (la transcription refuse au-delà de 2 Mo, environ 2 minutes). */
export const ADMIN_VOICE_MAX_BYTES = 2 * 1024 * 1024;

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
 * Phase 19 : dialogue admin des agents. Boutons des aperçus (`agv:<id>:ok|edit|no`), boutons oui / non des questions
 * (`agh:<id>:oui|non`, phase 22) et messages texte privés de
 * l'admin (`Setting` `admin.telegramUserId`) : réponses aux demandes, correction d'un post, commandes (« agents »,
 * « pause dating », « ok 12 », « clé fal … »…). Un message qui contenait un secret est supprimé aussitôt. Phase 20 :
 * un vocal de l'admin est mis en file pour le worker (transcrit puis traité comme un texte, jamais comme une clé).
 * Toute autre personne, et tout message que les agents ne prennent pas : traitement habituel (`next()`).
 * Enregistré avant les emojis animés et le transfert de canal (un texte corrigé peut contenir des emojis animés).
 */
export function registerAgentsAdminHandlers(bot: Bot, identity: BotIdentity, deps: TelegramDeps): void {
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    if (!isAgentsCallbackData(data) || !deps.agentsDeps) return next();
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

  // Phase 20 : vocal (ou message audio) de l'admin → tâche `admin-voice` du worker (téléchargement, transcription,
  // puis même traitement qu'un texte). Aucun appel à un fournisseur externe dans le webhook.
  bot.on(["message:voice", "message:audio"], async (ctx, next) => {
    const from = ctx.from;
    if (ctx.chat.type !== "private" || from.is_bot || !deps.agentsDeps || !deps.isAdminDialogPartner) return next();
    const msg = ctx.message;
    if (msg.forward_origin) return next();
    if (!(await deps.isAdminDialogPartner(BigInt(from.id)))) return next();
    const audio = msg.voice ?? msg.audio;
    if (!audio) return next();
    const replyLine = (text: string) =>
      ctx.reply(text, { reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true } });
    if (audio.file_size && audio.file_size > ADMIN_VOICE_MAX_BYTES) {
      await replyLine("Vocal trop long pour moi : fais-en un plus court (2 minutes au plus), ou écris-le.");
      return;
    }
    try {
      await deps.agentsDeps().enqueue.orchestrator(
        {
          type: "admin-voice",
          botId: identity.id,
          fileId: audio.file_id,
          messageId: msg.message_id,
          chatId: ctx.chat.id,
          replyToMessageId: msg.reply_to_message?.message_id ?? null,
          mimeType: audio.mime_type ?? "audio/ogg",
        },
        // Idempotent : un webhook rejoué ne transcrit pas deux fois le même vocal.
        { jobId: `admin-voice:${identity.id}:${msg.message_id}` },
      );
    } catch (err) {
      console.error("[agents] vocal de l'admin non mis en file", identity.username, (err as Error).message);
      await replyLine("Je n'arrive pas à écouter ce vocal pour le moment : écris-le-moi, ou réessaie dans un instant.");
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

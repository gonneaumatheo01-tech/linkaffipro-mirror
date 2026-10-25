/**
 * Phase 28, chantier E — réception des vidéos par Kevin (bot `role: ADMIN`) pour le montage, admin EN PRIVÉ seulement
 * (un membre du groupe ou un inconnu : rien, le montage est réservé à l'admin) :
 * - `video`, `document` vidéo ou vidéo transférée → `receiveMontageVideo` (aucun téléchargement ici : la chaîne
 *   télécharge dans le worker) ; légende de l'admin = consignes ; vidéo seule → question « je la monte ou je la
 *   garde ? » quelques secondes plus tard (une phrase juste après la rend inutile) ; refus clair au-delà de 2 Go, de
 *   3 h, ou pour un format inconnu ;
 * - vidéo transférée sans phrase de montage, ou légende à mots-clés de la médiathèque (#casino) : chemin d'avant
 *   (contenu d'un post, phase 34 ; médiathèque) ;
 * - boutons du montage (`msh:`, `mst:`, `msq:`, `mvc:`) : `handleMontageCallback` (admin seulement).
 */
import type { Bot, Context } from "grammy";
import type { Message } from "grammy/types";
import {
  handleMontageCallback,
  isMontageCallbackData,
  isSecretAdminText,
  montageVideoQuestion,
  receiveMontageVideo,
  writeBossTurn,
  type VideoMessage,
} from "@linkaffipro/agents";
import { isBossBot, type BotIdentity, type TelegramDeps } from "../ports";
import { sendBossText, type BossReplyApi } from "../boss/reply";
import { adminRouteFor } from "./agents-admin";

/** Attente par défaut avant la question d'une vidéo envoyée seule. */
export const MONTAGE_QUESTION_DELAY_MS = 4_000;

const VIDEO_EXT = /\.(mp4|mov|mkv|webm|avi|m4v|mpe?g|ts)$/i;

/** Vidéo d'un message (`video`, ou `document` vidéo par son type ou son extension), sinon null (pur). */
export function montageVideoOf(msg: Pick<Message, "message_id" | "video" | "document">): VideoMessage | null {
  const v = msg.video;
  if (v)
    return {
      messageId: msg.message_id,
      fileId: v.file_id,
      fileUniqueId: v.file_unique_id,
      sizeBytes: v.file_size ?? null,
      durationSec: v.duration ?? null,
      width: v.width ?? null,
      height: v.height ?? null,
      mimeType: v.mime_type ?? "video/mp4",
      fileName: v.file_name ?? null,
      asDocument: false,
    };
  const d = msg.document;
  if (d && ((d.mime_type && d.mime_type.startsWith("video/")) || (d.file_name && VIDEO_EXT.test(d.file_name))))
    return {
      messageId: msg.message_id,
      fileId: d.file_id,
      fileUniqueId: d.file_unique_id,
      sizeBytes: d.file_size ?? null,
      durationSec: null,
      width: null,
      height: null,
      mimeType: d.mime_type ?? null,
      fileName: d.file_name ?? null,
      asDocument: true,
    };
  return null;
}

function replyApiOf(ctx: Context): BossReplyApi {
  return {
    sendMessage: (chatId, text, other) => ctx.api.sendMessage(chatId, text, other),
    deleteMessage: (chatId, messageId) => ctx.api.deleteMessage(chatId, messageId),
  };
}

async function remember(deps: TelegramDeps, msg: Message, reply: string): Promise<void> {
  if (!deps.agentsDeps) return;
  const agents = deps.agentsDeps();
  const chatId = BigInt(msg.chat.id);
  const line = `[vidéo envoyée${msg.caption && !msg.forward_origin ? ` : ${msg.caption.slice(0, 300)}` : ""}]`;
  await writeBossTurn(agents, { role: "ADMIN", text: line, source: "text", telegramMessageId: msg.message_id, chatId, fromTelegramId: msg.from ? BigInt(msg.from.id) : null }).catch(() => null);
  await writeBossTurn(agents, { role: "BOSS", text: reply, actionKey: "montage_video", status: "done", telegramMessageId: msg.message_id, chatId }).catch(() => null);
}

/** Handlers du montage sur Kevin : à enregistrer AVANT le dialogue admin (une vidéo transférée y passe ensuite). */
export function registerBossMontageHandlers(bot: Bot, identity: BotIdentity, deps: TelegramDeps): void {
  if (!isBossBot(identity)) return;

  bot.on("message", async (ctx, next) => {
    const msg = ctx.message;
    if (ctx.from.is_bot || !deps.agentsDeps || ctx.chat.type !== "private") return next();
    const video = montageVideoOf(msg);
    if (!video) return next();
    const route = await adminRouteFor(identity, deps, ctx.from.id, ctx.chat.type);
    if (route.kind !== "dialog") return next();
    // Une légende qui ressemble à une clé suit le chemin des secrets (effacée, jamais lue comme une consigne).
    if (msg.caption && !msg.forward_origin && isSecretAdminText(msg.caption, null)) return next();
    const agents = deps.agentsDeps();
    const chatId = msg.chat.id;
    const r = await receiveMontageVideo(agents, {
      chatId: String(chatId),
      video,
      botId: identity.id,
      forwarded: Boolean(msg.forward_origin),
      caption: msg.forward_origin ? null : (msg.caption ?? null),
    });
    if (r.action === "pass") return next();
    const api = replyApiOf(ctx);
    if (r.action === "reply") {
      await sendBossText(api, chatId, r.reply, { replyToMessageId: msg.message_id, ...(r.buttons ? { buttons: r.buttons } : {}) }).catch((err) =>
        console.error("[montage] réponse à la vidéo non envoyée", identity.username, (err as Error).message),
      );
      await remember(deps, msg, r.reply);
      return;
    }
    // Vidéo seule : la question part après un court instant, sauf si une phrase l'a rendue inutile.
    const delay = deps.montageQuestionDelayMs ?? MONTAGE_QUESTION_DELAY_MS;
    setTimeout(() => {
      void (async () => {
        const q = await montageVideoQuestion(deps.agentsDeps!(), String(chatId), r.messageId);
        if (!q) return;
        await sendBossText(api, chatId, q.reply, { replyToMessageId: msg.message_id, buttons: q.buttons });
        await remember(deps, msg, q.reply);
      })().catch((err) => console.error("[montage] question sur la vidéo non envoyée", identity.username, (err as Error).message));
    }, delay);
  });

  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    if (!isMontageCallbackData(data) || !deps.agentsDeps) return next();
    const route = await adminRouteFor(identity, deps, ctx.from.id, ctx.callbackQuery.message?.chat.type ?? "private");
    if (route.kind !== "dialog") {
      // Le montage est réservé à l'admin : rien d'autre qu'un bouton qui se referme.
      await ctx.answerCallbackQuery().catch(() => undefined);
      return;
    }
    const agents = deps.agentsDeps();
    const chatId = ctx.callbackQuery.message?.chat.id ?? ctx.from.id;
    try {
      const r = await handleMontageCallback(agents, { data, fromTelegramId: BigInt(ctx.from.id), chatId: String(chatId) });
      await ctx.answerCallbackQuery(r.toast ? { text: r.toast } : undefined).catch(() => undefined);
      if (r.removeButtons) await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
      const api = replyApiOf(ctx);
      if (r.video) {
        const sent = await agents.admin?.sendStoredVideo?.(BigInt(chatId), { assetId: r.video.assetId, caption: r.video.caption, buttons: r.video.buttons }).catch(() => null);
        if (sent) await agents.prisma.shortClip.updateMany({ where: { id: r.video.clipId }, data: { previewMsgId: BigInt(sent.messageId) } }).catch(() => undefined);
        else await sendBossText(api, chatId, r.video.caption, { buttons: r.video.buttons });
      }
      if (r.reply) await sendBossText(api, chatId, r.reply, { ...(r.buttons ? { buttons: r.buttons } : {}) });
    } catch (err) {
      console.error("[montage] bouton", identity.username, (err as Error).message);
      await ctx.answerCallbackQuery().catch(() => undefined);
    }
  });
}

import type { Message } from "grammy/types";
import { TELEGRAM_CAPTION_MAX, TELEGRAM_TEXT_MAX, textLength } from "@linkaffipro/core";
import { prisma, recordEvent, toJsonValue } from "@linkaffipro/db";
import { enqueue, getRedis } from "@linkaffipro/queue";
import { logger } from "../logger";
import { apiForBot } from "./api";
import { describeTelegramError, withTelegramRetry } from "./errors";
import { buildInlineKeyboard, parseButtons } from "./keyboard";
import { loadMedia, rememberTelegramFile, toInputMedia, type LoadedMedia } from "./media";
import { RateLimiter } from "./rate-limit";

const limiter = () => new RateLimiter(getRedis());

/**
 * Envoie un message programmé dans son canal.
 * - texte seul → sendMessage ;
 * - un média → sendPhoto/Video/Animation/Document avec légende (≤ 1024) et boutons ; si le texte dépasse 1024 :
 *   média sans légende puis message texte avec boutons ;
 * - plusieurs médias → sendMediaGroup (légende sur le premier si ≤ 1024) puis message texte avec boutons si besoin.
 */
export async function sendPost(postId: string): Promise<void> {
  const post = await prisma.post.findUnique({ where: { id: postId }, include: { channel: true, bot: true } });
  if (!post) return;
  if (post.status !== "SENDING") {
    logger.warn({ postId, status: post.status }, "message non en cours d'envoi : ignoré");
    return;
  }
  const { api, username } = await apiForBot(post.botId);
  const chatId = Number(post.channel.telegramChatId);
  const keyboard = buildInlineKeyboard(parseButtons(post.buttons), {
    trackingBaseUrl: process.env.TRACKING_BASE_URL ?? "https://go.goolink.eu",
    botUsername: username,
    postCode: post.code,
  });
  const mediaIds = Array.isArray(post.mediaAssetIds) ? (post.mediaAssetIds as string[]) : [];
  const common = { disable_notification: post.disableNotification, protect_content: post.protectContent };
  const text = post.text ?? "";
  const rl = limiter();

  try {
    if (text && textLength(text) > TELEGRAM_TEXT_MAX) throw new Error("Texte trop long pour Telegram (4096 caractères).");
    const sent: Message[] = [];
    const medias: LoadedMedia[] = [];
    for (const id of mediaIds) {
      const m = await loadMedia(id, post.botId);
      if (m) medias.push(m);
    }
    const captionFits = text.length === 0 || textLength(text) <= TELEGRAM_CAPTION_MAX;

    await rl.forBot(post.botId);
    await rl.forChannel(chatId);

    if (medias.length === 0) {
      const msg = await withTelegramRetry(() =>
        api.sendMessage(chatId, text || "​", { parse_mode: "HTML", reply_markup: keyboard, link_preview_options: { is_disabled: post.disableLinkPreview }, ...common }),
      );
      sent.push(msg);
    } else if (medias.length === 1) {
      const m = medias[0]!;
      const caption = captionFits ? text || undefined : undefined;
      const opts = { caption, parse_mode: "HTML" as const, reply_markup: captionFits ? keyboard : undefined, ...common };
      const msg = await withTelegramRetry<Message>(async () => {
        if (m.kind === "photo") return api.sendPhoto(chatId, m.media, opts);
        if (m.kind === "video") return api.sendVideo(chatId, m.media, opts);
        if (m.kind === "animation") return api.sendAnimation(chatId, m.media, opts);
        return api.sendDocument(chatId, m.media, opts);
      });
      sent.push(msg);
      await rememberTelegramFile(m.assetId, post.botId, msg);
      if (!captionFits) {
        await rl.forChannel(chatId);
        sent.push(await withTelegramRetry(() => api.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard, link_preview_options: { is_disabled: true }, ...common })));
      }
    } else {
      // Album : pas de boutons possibles → album (légende sur le premier) puis texte avec boutons si nécessaire.
      const group = medias.slice(0, 10).map((m, i) => toInputMedia(m, i === 0 && captionFits ? text || undefined : undefined));
      const msgs = await withTelegramRetry(() => api.sendMediaGroup(chatId, group as Parameters<typeof api.sendMediaGroup>[1], common));
      sent.push(...msgs);
      await Promise.all(msgs.map((msg, i) => (medias[i] ? rememberTelegramFile(medias[i]!.assetId, post.botId, msg) : Promise.resolve())));
      if (keyboard || !captionFits) {
        await rl.forChannel(chatId);
        sent.push(await withTelegramRetry(() => api.sendMessage(chatId, !captionFits ? text : text || "👇", { parse_mode: "HTML", reply_markup: keyboard, link_preview_options: { is_disabled: true }, ...common })));
      }
    }

    const ids = sent.map((m) => m.message_id);
    const now = new Date();
    if (post.unpinPrevious) await api.unpinAllChatMessages(chatId).catch((e) => logger.warn({ postId, err: String(e) }, "désépinglage impossible"));
    if (post.pinAfterSend && ids[0]) await api.pinChatMessage(chatId, ids[0], { disable_notification: true }).catch((e) => logger.warn({ postId, err: String(e) }, "épinglage impossible"));

    await prisma.post.update({ where: { id: postId }, data: { status: "SENT", sentAt: now, telegramMessageIds: ids, lastError: null } });
    await prisma.postStats.upsert({ where: { postId }, create: { postId }, update: {} });
    await recordEvent({ type: "post.sent", channelId: post.channelId, botId: post.botId, payload: toJsonValue({ postId, messageIds: ids }) });
    if (post.deleteAfterMinutes && post.deleteAfterMinutes > 0) {
      await enqueue("telegram-send", { type: "delete-post", postId }, { jobId: `delete-post:${postId}:${now.getTime()}`, delay: post.deleteAfterMinutes * 60_000 });
    }
    logger.info({ postId, chatId, ids }, "message envoyé");
  } catch (err) {
    const d = describeTelegramError(err);
    await prisma.post.update({ where: { id: postId }, data: { status: "FAILED", lastError: d.message, attempts: { increment: 1 } } });
    await recordEvent({ type: "post.failed", channelId: post.channelId, botId: post.botId, payload: toJsonValue({ postId, error: d.message }) });
    logger.error({ postId, err: d.message }, "échec d'envoi");
  }
}

/** Supprime sur Telegram les messages d'un post (suppression programmée ou manuelle). */
export async function deletePost(postId: string): Promise<void> {
  const post = await prisma.post.findUnique({ where: { id: postId }, include: { channel: true } });
  if (!post || post.status === "DELETED") return;
  const ids = Array.isArray(post.telegramMessageIds) ? (post.telegramMessageIds as number[]) : [];
  if (ids.length === 0) return;
  const { api } = await apiForBot(post.botId);
  const chatId = Number(post.channel.telegramChatId);
  let error: string | null = null;
  for (const id of ids) {
    try {
      await withTelegramRetry(() => api.deleteMessage(chatId, id));
    } catch (err) {
      error = describeTelegramError(err).message;
    }
  }
  await prisma.post.update({ where: { id: postId }, data: { status: "DELETED", lastError: error } });
  await recordEvent({ type: "post.deleted", channelId: post.channelId, botId: post.botId, payload: toJsonValue({ postId, error }) });
}

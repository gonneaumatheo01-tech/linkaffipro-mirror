import type { Message } from "grammy/types";
import {
  hasCustomEmoji,
  TELEGRAM_CAPTION_MAX,
  TELEGRAM_TEXT_MAX,
  textLength,
  withFallbackEmojis,
} from "@linkaffipro/core";
import { prisma, recordEvent, toJsonValue } from "@linkaffipro/db";
import { enqueue, getRedis } from "@linkaffipro/queue";
import {
  CUSTOM_EMOJIS_DROPPED_ERROR,
  customEmojisDropped,
  sendWithEmojiFallback,
  type CustomEmojiFallbackInfo,
} from "@linkaffipro/telegram";
import { logger } from "../logger";
import { apiForBot } from "./api";
import { describeTelegramError, withTelegramRetry } from "./errors";
import { buildInlineKeyboard, parseButtons } from "./keyboard";
import { loadMedia, rememberTelegramFile, toInputMedia, type LoadedMedia } from "./media";
import { RateLimiter } from "./rate-limit";
import { deletePostAccount, partialPublicationChannel, sendPostAccount } from "./send-post-account";

const limiter = () => new RateLimiter(getRedis());

/** Message passé au bot alors qu'une partie a déjà été publiée par le compte connecté (publication interrompue). */
export const PARTIAL_BY_ACCOUNT_MESSAGE =
  "Une partie de ce message a déjà été publiée par votre compte Telegram : supprimez-la dans Telegram, puis dupliquez ce message et programmez la copie (elle partira en entier).";

/** Note laissée sur un message programmé parti avec les emojis normaux à la place des emojis animés (phase 12). */
export const POST_CUSTOM_EMOJI_FALLBACK_NOTE = {
  resent: "Publié avec les emojis normaux : Telegram a refusé les emojis animés.",
  dropped: "Telegram a affiché les emojis normaux à la place des emojis animés.",
} as const;

/**
 * Envois d'un même message programmé par le bot qui peuvent contenir des emojis animés (groupes, Bot API 9.4) : texte
 * envoyé tel quel ; refus de Telegram à cause d'eux → même envoi aussitôt refait avec les emojis normaux
 * (`sendWithEmojiFallback`) ; une fois le refus constaté, la suite du même message (texte après un album…) part
 * directement avec les emojis normaux. `info` : premier repli constaté (refus, ou emojis retirés en silence).
 */
export function postEmojiSender() {
  let info: CustomEmojiFallbackInfo | null = null;
  const onFallback = (i: CustomEmojiFallbackInfo) => {
    if (!info || (i.resent && !info.resent)) info = i;
  };
  return {
    get info(): CustomEmojiFallbackInfo | null {
      return info;
    },
    /** `html` absent ou sans emoji animé : simple envoi. */
    send<T>(html: string | undefined, send: (html: string | undefined) => Promise<T>): Promise<T> {
      if (!html || !hasCustomEmoji(html)) return send(html);
      if (info?.resent) return send(withFallbackEmojis(html));
      return sendWithEmojiFallback(html, send, onFallback);
    },
    /** Album : Telegram renvoie une liste ; les emojis retirés en silence se lisent sur la légende du premier média. */
    checkAlbum(html: string | undefined, first: Message | undefined): void {
      if (!html || info || !first) return;
      if (customEmojisDropped(html, first))
        onFallback({ error: CUSTOM_EMOJIS_DROPPED_ERROR, resent: false });
    },
  };
}

function messageIdsOf(raw: unknown): number[] {
  return Array.isArray(raw)
    ? raw.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0)
    : [];
}

/**
 * Envoie un message programmé dans son canal.
 * - texte seul → sendMessage ;
 * - un média → sendPhoto/Video/Animation/Document avec légende (≤ 1024) et boutons ; si le texte dépasse 1024 :
 *   média sans légende puis message texte avec boutons ;
 * - plusieurs médias → sendMediaGroup (légende sur le premier si ≤ 1024) puis message texte avec boutons si besoin.
 * Emojis animés publiés par le bot (groupes, phase 12) : refus de Telegram → même envoi aussitôt refait avec les emojis
 * normaux, publié quand même, note `POST_CUSTOM_EMOJI_FALLBACK_NOTE` et événement `post.custom_emoji_fallback`
 * (alerte `custom_emoji_refused`) ; emojis retirés en silence → signalés de la même façon, sans renvoi.
 * Un message avec emojis animés (`publisher` ACCOUNT, phase 12) est publié par le compte Telegram connecté
 * (`send-post-account.ts`) : Telegram interdit ces emojis aux bots dans les canaux. Un message publié en partie par le
 * compte (publication interrompue), puis passé au bot, est refusé : le bot republierait tout (doublon dans le canal) et
 * la partie déjà publiée ne serait plus suivie (vues, suppression programmée).
 */
export async function sendPost(postId: string): Promise<void> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { channel: true, bot: true },
  });
  if (!post) return;
  if (post.status !== "SENDING") {
    logger.warn({ postId, status: post.status }, "message non en cours d'envoi : ignoré");
    return;
  }
  if (post.publisher === "ACCOUNT") {
    await sendPostAccount(post);
    return;
  }
  const partial = messageIdsOf(post.telegramMessageIds);
  if (partial.length > 0 && !post.sentAt) {
    // Identifiants gardés (et leur canal) : la partie publiée reste suivie si le message repasse au compte.
    const messageChannelId = (await partialPublicationChannel(postId)) ?? post.channelId;
    await prisma.post.update({
      where: { id: postId },
      data: {
        status: "FAILED",
        lastError: PARTIAL_BY_ACCOUNT_MESSAGE,
        attempts: { increment: 1 },
      },
    });
    await recordEvent({
      type: "post.failed",
      channelId: post.channelId,
      botId: post.botId,
      payload: toJsonValue({
        postId,
        error: PARTIAL_BY_ACCOUNT_MESSAGE,
        messageIds: partial,
        messageChannelId,
      }),
    });
    logger.error(
      { postId, ids: partial },
      "message publié en partie par le compte : refusé au bot",
    );
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
  const common = {
    disable_notification: post.disableNotification,
    protect_content: post.protectContent,
  };
  const text = post.text ?? "";
  const rl = limiter();
  const emojis = postEmojiSender();

  try {
    if (text && textLength(text) > TELEGRAM_TEXT_MAX)
      throw new Error("Texte trop long pour Telegram (4096 caractères).");
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
      const msg = await emojis.send(text || "​", (t) =>
        withTelegramRetry(() =>
          api.sendMessage(chatId, t ?? "​", {
            parse_mode: "HTML",
            reply_markup: keyboard,
            link_preview_options: { is_disabled: post.disableLinkPreview },
            ...common,
          }),
        ),
      );
      sent.push(msg);
    } else if (medias.length === 1) {
      const m = medias[0]!;
      const caption = captionFits ? text || undefined : undefined;
      const msg = await emojis.send(caption, (c) => {
        const opts = {
          caption: c,
          parse_mode: "HTML" as const,
          reply_markup: captionFits ? keyboard : undefined,
          ...common,
        };
        return withTelegramRetry<Message>(async () => {
          if (m.kind === "photo") return api.sendPhoto(chatId, m.media, opts);
          if (m.kind === "video") return api.sendVideo(chatId, m.media, opts);
          if (m.kind === "animation") return api.sendAnimation(chatId, m.media, opts);
          return api.sendDocument(chatId, m.media, opts);
        });
      });
      sent.push(msg);
      await rememberTelegramFile(m.assetId, post.botId, msg);
      if (!captionFits) {
        await rl.forChannel(chatId);
        sent.push(
          await emojis.send(text, (t) =>
            withTelegramRetry(() =>
              api.sendMessage(chatId, t ?? text, {
                parse_mode: "HTML",
                reply_markup: keyboard,
                link_preview_options: { is_disabled: true },
                ...common,
              }),
            ),
          ),
        );
      }
    } else {
      // Album : pas de boutons possibles → album (légende sur le premier) puis texte avec boutons si nécessaire.
      const albumCaption = captionFits ? text || undefined : undefined;
      const msgs = await emojis.send(albumCaption, (c) => {
        const group = medias.slice(0, 10).map((m, i) => toInputMedia(m, i === 0 ? c : undefined));
        return withTelegramRetry(() =>
          api.sendMediaGroup(chatId, group as Parameters<typeof api.sendMediaGroup>[1], common),
        );
      });
      emojis.checkAlbum(albumCaption, msgs[0]);
      sent.push(...msgs);
      await Promise.all(
        msgs.map((msg, i) =>
          medias[i] ? rememberTelegramFile(medias[i]!.assetId, post.botId, msg) : Promise.resolve(),
        ),
      );
      if (keyboard || !captionFits) {
        await rl.forChannel(chatId);
        const follow = !captionFits ? text : text || "👇";
        sent.push(
          await emojis.send(follow, (t) =>
            withTelegramRetry(() =>
              api.sendMessage(chatId, t ?? follow, {
                parse_mode: "HTML",
                reply_markup: keyboard,
                link_preview_options: { is_disabled: true },
                ...common,
              }),
            ),
          ),
        );
      }
    }

    const ids = sent.map((m) => m.message_id);
    const now = new Date();
    if (post.unpinPrevious)
      await api
        .unpinAllChatMessages(chatId)
        .catch((e) => logger.warn({ postId, err: String(e) }, "désépinglage impossible"));
    if (post.pinAfterSend && ids[0])
      await api
        .pinChatMessage(chatId, ids[0], { disable_notification: true })
        .catch((e) => logger.warn({ postId, err: String(e) }, "épinglage impossible"));

    const fallback = emojis.info;
    await prisma.post.update({
      where: { id: postId },
      data: {
        status: "SENT",
        sentAt: now,
        telegramMessageIds: ids,
        lastError: fallback
          ? POST_CUSTOM_EMOJI_FALLBACK_NOTE[fallback.resent ? "resent" : "dropped"]
          : null,
        viewsNextAt: new Date(now.getTime() + 15 * 60_000),
      },
    });
    await prisma.postStats.upsert({ where: { postId }, create: { postId }, update: {} });
    if (fallback) {
      logger.warn(
        { postId, botId: post.botId, err: fallback.error, resent: fallback.resent },
        "emojis animés refusés : message publié avec les emojis normaux",
      );
      await recordEvent({
        type: "post.custom_emoji_fallback",
        channelId: post.channelId,
        botId: post.botId,
        payload: toJsonValue({
          postId,
          botId: post.botId,
          error: fallback.error,
          resent: fallback.resent,
        }),
      });
    }
    await recordEvent({
      type: "post.sent",
      channelId: post.channelId,
      botId: post.botId,
      payload: toJsonValue({
        postId,
        messageIds: ids,
        ...(fallback ? { customEmojiFallback: true } : {}),
      }),
    });
    if (post.deleteAfterMinutes && post.deleteAfterMinutes > 0) {
      await enqueue(
        "telegram-send",
        { type: "delete-post", postId },
        {
          jobId: `delete-post:${postId}:${now.getTime()}`,
          delay: post.deleteAfterMinutes * 60_000,
        },
      );
    }
    logger.info({ postId, chatId, ids }, "message envoyé");
  } catch (err) {
    const d = describeTelegramError(err);
    await prisma.post.update({
      where: { id: postId },
      data: { status: "FAILED", lastError: d.message, attempts: { increment: 1 } },
    });
    await recordEvent({
      type: "post.failed",
      channelId: post.channelId,
      botId: post.botId,
      payload: toJsonValue({ postId, error: d.message }),
    });
    logger.error({ postId, err: d.message }, "échec d'envoi");
  }
}

/**
 * Supprime sur Telegram les messages d'un post (suppression programmée ou manuelle). Un message publié par le compte
 * Telegram connecté est supprimé par le compte, jamais par le bot.
 */
export async function deletePost(postId: string): Promise<void> {
  const post = await prisma.post.findUnique({ where: { id: postId }, include: { channel: true } });
  if (!post || post.status === "DELETED") return;
  if (post.publisher === "ACCOUNT") {
    await deletePostAccount(post);
    return;
  }
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
  await prisma.post.update({
    where: { id: postId },
    data: { status: "DELETED", lastError: error },
  });
  await recordEvent({
    type: "post.deleted",
    channelId: post.channelId,
    botId: post.botId,
    payload: toJsonValue({ postId, error }),
  });
}

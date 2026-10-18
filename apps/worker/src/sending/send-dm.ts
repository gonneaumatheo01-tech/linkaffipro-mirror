import { prisma, recordEvent, toJsonValue } from "@linkaffipro/db";
import { getRedis } from "@linkaffipro/queue";
import { TELEGRAM_CAPTION_MAX, textLength } from "@linkaffipro/core";
import type { Api } from "grammy";
import type { InlineKeyboardMarkup, Message } from "grammy/types";
import { logger } from "../logger";
import { apiForBot } from "./api";
import { describeDmFailure, describeTelegramError, withTelegramRetry } from "./errors";
import { sendWithEmojiFallback, type CustomEmojiFallbackInfo } from "@linkaffipro/telegram";
import { buildDmKeyboard } from "./keyboard";
import { loadMedia, rememberTelegramFile, type LoadedMedia } from "./media";
import { RateLimiter } from "./rate-limit";
import { recordBroadcastOutcome } from "../broadcasts/progress";

/** Envoie un média en privé (photo, vidéo, gif, document) avec légende et clavier éventuels. */
function sendMedia(
  api: Api,
  chatId: number,
  m: LoadedMedia,
  caption: string | undefined,
  keyboard: InlineKeyboardMarkup | undefined,
): Promise<Message> {
  const opts = { caption, parse_mode: "HTML" as const, reply_markup: keyboard };
  if (m.kind === "photo") return api.sendPhoto(chatId, m.media, opts);
  if (m.kind === "video") return api.sendVideo(chatId, m.media, opts);
  if (m.kind === "animation") return api.sendAnimation(chatId, m.media, opts);
  return api.sendDocument(chatId, m.media, opts);
}

/**
 * Issue d'un envoi (phase 17 : l'assistant de conversation envoie ses messages un par un et doit savoir tout de suite
 * s'ils sont partis). SKIPPED : message introuvable ou déjà traité (rien n'est envoyé).
 */
export type DmSendResult = {
  status: "SENT" | "FAILED" | "BLOCKED" | "SKIPPED";
  telegramMessageId: number | null;
  /** La personne a bloqué le bot. */
  blocked: boolean;
  /** Le bot ne peut plus écrire à cette personne (sans blocage de sa part). */
  unreachable: boolean;
  /** Erreur lisible en français (null si envoyé). */
  error: string | null;
};

/** Types de messages privés qu'un bot assistant de conversation peut envoyer (phase 17). */
const ASSISTANT_DM_KINDS: ReadonlySet<string> = new Set(["ASSISTANT", "TEST"]);

/** Message refusé parce que son bot est devenu un assistant de conversation (phase 17). */
export const ASSISTANT_DM_REFUSED =
  "Non envoyé : ce bot est un assistant de conversation, il n'envoie que ses propres messages de conversation.";

/** Note enregistrée sur un message parti avec les emojis normaux à la place des emojis animés. */
export function customEmojiFallbackNote(info: CustomEmojiFallbackInfo): string {
  return info.resent
    ? "Envoyé avec les emojis normaux : Telegram a refusé les emojis animés."
    : "Telegram a affiché les emojis normaux à la place des emojis animés.";
}

/**
 * Envoie un message privé en file d'attente (`OutboundMessage` QUEUED).
 * Avec un média : média + texte en légende (≤ 1024 caractères) + boutons ; texte plus long : média seul puis
 * texte + boutons en second message. Si le média échoue, le texte part seul (SENT, erreur mémorisée).
 * Emojis animés (phase 12) : texte envoyé tel quel ; si Telegram les refuse, le même message repart aussitôt avec les
 * emojis de remplacement (`sendWithEmojiFallback`), journalisé `dm.custom_emoji_fallback` (alerte `custom_emoji_refused`).
 *
 * Phase 14 (décisions E1, E2) :
 * - un message parti grâce à la fenêtre de 5 minutes d'une demande d'adhésion (`user_chat_id`) ne rend PAS la personne
 *   joignable ensuite : seul « Démarrer » (ou un bouton du bot) le fait (`MemberBotState.startedAt`) ;
 * - « bot was blocked by the user » : message BLOCKED, `canDm` faux et `blockedAt`, événement `dm.blocked` ;
 * - « bot can't initiate conversation with a user » (et les autres refus qui ne sont pas un blocage) : message FAILED
 *   (« Le bot ne peut plus écrire à cette personne… »), `canDm` faux SANS `blockedAt`, événement `dm.unreachable` ;
 * - l'erreur exacte de Telegram est gardée dans les événements (`telegramError`).
 */
export async function sendDm(outboundMessageId: string): Promise<DmSendResult> {
  const om = await prisma.outboundMessage.findUnique({
    where: { id: outboundMessageId },
    include: { member: true },
  });
  if (!om || om.status !== "QUEUED")
    return {
      status: "SKIPPED",
      telegramMessageId: null,
      blocked: false,
      unreachable: false,
      error: om ? `Message déjà traité (${om.status}).` : "Message introuvable.",
    };
  const chatId = om.chatId ?? om.member.telegramUserId;
  const rl = new RateLimiter(getRedis());
  try {
    const { api, mode } = await apiForBot(om.botId);
    // Filet (phase 17) : un assistant de conversation n'envoie que ses messages de conversation (et les essais de
    // l'équipe) ; jamais un accueil, un rappel, un « Accepté », une relance ni un envoi à un groupe.
    if (mode === "ASSISTANT" && !ASSISTANT_DM_KINDS.has(om.kind))
      throw new Error(ASSISTANT_DM_REFUSED);
    await rl.forBot(om.botId);
    await rl.forPrivateChat(chatId);
    const keyboard = buildDmKeyboard(om.buttons);
    const chat = Number(chatId);
    let mediaError: string | null = null;
    let textSent = false;
    let last: Message | null = null;
    // Premier repli des emojis animés de ce message (légende ou texte) : un seul journal par message.
    let emojiFallback: CustomEmojiFallbackInfo | null = null;
    const onFallback = (info: CustomEmojiFallbackInfo) => {
      emojiFallback ??= info;
    };

    const media = om.mediaAssetId
      ? await loadMedia(om.mediaAssetId, om.botId).catch(() => null)
      : null;
    if (media) {
      const captionFits = textLength(om.text) <= TELEGRAM_CAPTION_MAX;
      try {
        const sent = await sendWithEmojiFallback(
          captionFits ? om.text : "",
          (caption) =>
            withTelegramRetry(() =>
              sendMedia(
                api,
                chat,
                media,
                captionFits ? caption : undefined,
                captionFits ? keyboard : undefined,
              ),
            ),
          onFallback,
        );
        await rememberTelegramFile(media.assetId, om.botId, sent);
        last = sent;
        textSent = captionFits;
      } catch (err) {
        const d = describeTelegramError(err);
        // Personne injoignable ou qui a bloqué le bot : le texte seul échouerait de même.
        if (d.blocked || d.unreachable) throw err;
        mediaError = `Média non envoyé : ${d.message}`;
        logger.warn(
          { outboundMessageId: om.id, err: d.message },
          "média du message privé non envoyé, repli texte",
        );
      }
    }
    if (!textSent) {
      if (media && !mediaError) await rl.forPrivateChat(chatId);
      last = await sendWithEmojiFallback(
        om.text,
        (text) =>
          withTelegramRetry(() =>
            api.sendMessage(chat, text, {
              parse_mode: "HTML",
              reply_markup: keyboard,
              link_preview_options: { is_disabled: true },
            }),
          ),
        onFallback,
      );
    }

    const now = new Date();
    const fallback = emojiFallback as CustomEmojiFallbackInfo | null;
    const note =
      [mediaError, fallback ? customEmojiFallbackNote(fallback) : null]
        .filter(Boolean)
        .join(" ; ") || null;
    await prisma.outboundMessage.update({
      where: { id: om.id },
      data: {
        status: "SENT",
        sentAt: now,
        telegramMessageId: last?.message_id ?? null,
        error: note,
      },
    });
    if (fallback) {
      logger.warn(
        { outboundMessageId: om.id, botId: om.botId, err: fallback.error, resent: fallback.resent },
        "emojis animés refusés, message envoyé avec les emojis normaux",
      );
      await recordEvent({
        type: "dm.custom_emoji_fallback",
        memberId: om.memberId,
        botId: om.botId,
        payload: toJsonValue({
          outboundMessageId: om.id,
          botId: om.botId,
          error: fallback.error,
          resent: fallback.resent,
          kind: om.kind,
        }),
      });
    }
    // Message reçu : la personne n'a pas bloqué le bot. Joignable ensuite seulement si elle l'a démarré (startedAt) :
    // un message envoyé grâce à la fenêtre de 5 minutes d'une demande ne la rend pas joignable (canDm faux à la création).
    await prisma.memberBotState.upsert({
      where: { memberId_botId: { memberId: om.memberId, botId: om.botId } },
      create: { memberId: om.memberId, botId: om.botId, canDm: false, lastDmAt: now },
      update: { lastDmAt: now, blockedAt: null },
    });
    await recordEvent({
      type: "dm.sent",
      memberId: om.memberId,
      botId: om.botId,
      payload: toJsonValue({
        outboundMessageId: om.id,
        kind: om.kind,
        media: !!media,
        mediaError,
        customEmojiFallback: !!fallback,
      }),
    });
    await recordBroadcastOutcome(om.broadcastId, "SENT");
    return {
      status: "SENT",
      telegramMessageId: last?.message_id ?? null,
      blocked: false,
      unreachable: false,
      error: null,
    };
  } catch (err) {
    const d = describeDmFailure(err);
    const status = d.status;
    await prisma.outboundMessage.update({
      where: { id: om.id },
      data: { status, error: d.message },
    });
    if (d.blocked) {
      await prisma.memberBotState.upsert({
        where: { memberId_botId: { memberId: om.memberId, botId: om.botId } },
        create: { memberId: om.memberId, botId: om.botId, canDm: false, blockedAt: new Date() },
        update: { canDm: false, blockedAt: new Date() },
      });
    } else if (d.unreachable) {
      // Injoignable sans blocage : plus de message en premier, mais jamais compté comme « a bloqué le bot ».
      await prisma.memberBotState.upsert({
        where: { memberId_botId: { memberId: om.memberId, botId: om.botId } },
        create: { memberId: om.memberId, botId: om.botId, canDm: false },
        update: { canDm: false },
      });
    }
    await recordEvent({
      type: d.blocked ? "dm.blocked" : d.unreachable ? "dm.unreachable" : "dm.failed",
      memberId: om.memberId,
      botId: om.botId,
      payload: toJsonValue({
        outboundMessageId: om.id,
        kind: om.kind,
        error: d.message,
        telegramError: d.telegramError,
      }),
    });
    logger.warn(
      { outboundMessageId: om.id, err: d.message, telegramError: d.telegramError },
      "message privé non envoyé",
    );
    await recordBroadcastOutcome(om.broadcastId, status);
    return {
      status,
      telegramMessageId: null,
      blocked: d.blocked,
      unreachable: d.unreachable,
      error: d.message,
    };
  }
}

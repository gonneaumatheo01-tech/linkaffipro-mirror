/**
 * Envoi des messages de l'assistant de conversation (contrat §5) : implémentation Telegram de `ChatSender`.
 * - « écrit… » : `sendChatAction(typing)` par le bot de la conversation, au débit du bot (25/s) mais SANS prendre le
 *   jeton « 1 message/s » du chat privé ; reprise courte sur 429 ; un échec est sans conséquence.
 * - Chaque partie : `ConversationMessage` OUT (auteur ASSISTANT, tour, rang) + `OutboundMessage` (kind ASSISTANT, texte
 *   ÉCHAPPÉ en HTML : le modèle écrit du texte brut, un « < » ne doit jamais faire refuser le message), envoyés
 *   DIRECTEMENT et dans l'ordre par `sendDm` (débit partagé 1 message/s par chat, 429 `retry_after`, refus 403 classés,
 *   état du bot pour la personne, événements `dm.*`).
 * - Avant CHAQUE partie, relecture de la conversation : reprise par l'équipe, /stop, mineur ou /reset depuis le début
 *   du tour → plus rien ne part (ni la suite de la réponse, ni le bouton d'offre).
 * - Message parti : identifiant Telegram gardé ; message portant le bouton d'offre : événement `offer_sent`.
 *   Message refusé : la ligne de conversation est retirée (la personne ne l'a jamais reçu ; l'`OutboundMessage` garde
 *   l'échec), et le moteur est prévenu (bloqué / injoignable → la conversation sera fermée).
 */
import type { ChatButton, ChatSender, SendResult } from "@linkaffipro/chat";
import { escapeHtml } from "@linkaffipro/core";
import { getRedis } from "@linkaffipro/queue";
import { prisma, toJsonValue } from "@linkaffipro/db";
import { logger } from "../logger";
import { apiForBot } from "../sending/api";
import { withTelegramRetry } from "../sending/errors";
import { RateLimiter } from "../sending/rate-limit";
import { sendDm } from "../sending/send-dm";
import { recordConversationEvent } from "./events";
import { conversationGuard } from "./guard";
import type { GuardVerdict } from "./rules";

export type SenderContext = {
  conversationId: string;
  botId: string;
  memberId: string;
  /** Chat privé (identifiant Telegram de la personne). */
  chatId: bigint;
  turnId: string;
  /** Lien d'offre créé pour ce tour (posé par `createOfferLink` juste avant l'envoi du dernier message). */
  pendingOffer: { subId: string; url: string } | null;
  /** Nombre de liens déjà envoyés dans cette conversation avant ce tour (payload de `offer_sent`). */
  offerSendsBefore: number;
  /** Nombre de /reset de la conversation au début du tour (absent : pas de contrôle du /reset). */
  resetsAtStart?: number;
};

/** Erreur rendue au moteur quand l'assistant n'a plus la parole (il s'arrête, le lien non parti est retiré). */
export const NOT_OURS_ERROR = "conversation reprise ou arrêtée";

/** Partie réellement envoyée (dans l'ordre), pour compléter ses informations après le tour. */
export type SentRow = {
  conversationMessageId: string;
  partIndex: number;
  offerSubId: string | null;
};

export type WorkerChatSender = ChatSender & { sentRows: SentRow[] };

type SendDmFn = typeof sendDm;

export function createWorkerChatSender(
  ctx: SenderContext,
  deps: { sendDm?: SendDmFn; now?: () => Date; guard?: () => Promise<GuardVerdict> } = {},
): WorkerChatSender {
  const send = deps.sendDm ?? sendDm;
  const now = deps.now ?? (() => new Date());
  const guard =
    deps.guard ?? (() => conversationGuard(ctx.conversationId, ctx.resetsAtStart ?? null));
  const sentRows: SentRow[] = [];
  let nextPart = 0;

  async function sendPart(
    text: string,
    opts: { buttons?: ChatButton[][]; mediaAssetId?: string | null },
  ): Promise<SendResult> {
    // /stop, reprise par l'équipe, mineur ou /reset pendant le tour (même entre deux parties) : rien de plus ne part.
    const verdict = await guard();
    if (!verdict.ok) {
      logger.info(
        { conversationId: ctx.conversationId, reason: verdict.reason },
        "assistant : envoi arrêté (la conversation a changé pendant le tour)",
      );
      return { ok: false, blocked: false, unreachable: false, error: NOT_OURS_ERROR };
    }
    const partIndex = nextPart++;
    const buttons = opts.buttons ?? [];
    const offer =
      ctx.pendingOffer && buttons.some((row) => row.some((b) => b.url === ctx.pendingOffer?.url))
        ? ctx.pendingOffer
        : null;
    const mediaAssetId = opts.mediaAssetId ?? null;
    const { om, cm } = await prisma.$transaction(async (tx) => {
      const om = await tx.outboundMessage.create({
        data: {
          botId: ctx.botId,
          memberId: ctx.memberId,
          kind: "ASSISTANT",
          text: escapeHtml(text),
          buttons: toJsonValue(buttons),
          mediaAssetId,
        },
        select: { id: true },
      });
      const cm = await tx.conversationMessage.create({
        data: {
          conversationId: ctx.conversationId,
          direction: "OUT",
          author: "ASSISTANT",
          text,
          ...(mediaAssetId ? { media: toJsonValue({ kind: "photo", mediaAssetId }) } : {}),
          meta: toJsonValue(offer ? { offerSubId: offer.subId } : {}),
          turnId: ctx.turnId,
          partIndex,
          outboundMessageId: om.id,
        },
        select: { id: true },
      });
      return { om, cm };
    });

    const r = await send(om.id);
    if (r.status !== "SENT") {
      await prisma.conversationMessage.delete({ where: { id: cm.id } }).catch(() => undefined);
      return {
        ok: false,
        blocked: r.blocked,
        unreachable: r.unreachable,
        error: r.error ?? "Message non envoyé.",
      };
    }
    if (r.telegramMessageId !== null)
      await prisma.conversationMessage
        .update({ where: { id: cm.id }, data: { telegramMessageId: BigInt(r.telegramMessageId) } })
        .catch((err: Error) =>
          logger.warn({ err: err.message }, "assistant : identifiant Telegram non enregistré"),
        );
    sentRows.push({ conversationMessageId: cm.id, partIndex, offerSubId: offer?.subId ?? null });
    if (offer) {
      ctx.pendingOffer = null;
      await recordConversationEvent(
        { id: ctx.conversationId, botId: ctx.botId, memberId: ctx.memberId },
        {
          type: "offer_sent",
          payload: { subId: offer.subId, offerSends: ctx.offerSendsBefore + 1 },
          at: now(),
        },
      );
    }
    return r.telegramMessageId !== null
      ? { ok: true, telegramMessageId: r.telegramMessageId }
      : { ok: true };
  }

  return {
    sentRows,
    async sendTyping() {
      const { api } = await apiForBot(ctx.botId);
      await new RateLimiter(getRedis()).forBot(ctx.botId);
      // « écrit… » est un confort : une seule attente sur 429, un seul nouvel essai réseau.
      await withTelegramRetry(() => api.sendChatAction(Number(ctx.chatId), "typing"), {
        max429: 1,
        maxNetworkAttempts: 2,
      });
    },
    sendText(text, opts) {
      return sendPart(text, { buttons: opts?.buttons });
    },
    sendMedia(media, caption, opts) {
      return sendPart(caption, { buttons: opts?.buttons, mediaAssetId: media.mediaAssetId });
    },
  };
}

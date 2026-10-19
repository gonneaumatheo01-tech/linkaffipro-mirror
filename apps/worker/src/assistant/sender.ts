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
 * - Message parti : identifiant Telegram gardé, et les FAITS écrits tout de suite (un arrêt du worker plus tard dans le
 *   tour ne les perd plus) : heure du dernier message parti, tour compté (première partie d'une réponse ; jamais
 *   l'arrêt mineur ni « je reviens vers toi »), et pour le message portant le bouton d'offre, dans la même transaction :
 *   compteur des liens, étape LINK_SENT (passage d'étape journalisé) et événement `offer_sent`. `live` dit à la fin du
 *   tour ce qui est déjà écrit.
 *   Message refusé : la ligne de conversation est retirée (la personne ne l'a jamais reçu ; l'`OutboundMessage` garde
 *   l'échec), et le moteur est prévenu (bloqué / injoignable → la conversation sera fermée). Envoi qui lève une erreur
 *   (base indisponible…) : message passé en échec et ligne retirée (jamais un message fantôme « en file »).
 */
import type {
  ChatButton,
  ChatSender,
  ConversationStage,
  SendOptions,
  SendResult,
} from "@linkaffipro/chat";
import { escapeHtml } from "@linkaffipro/core";
import { getRedis } from "@linkaffipro/queue";
import { prisma, toJsonValue } from "@linkaffipro/db";
import { logger } from "../logger";
import { apiForBot } from "../sending/api";
import { withTelegramRetry } from "../sending/errors";
import { RateLimiter } from "../sending/rate-limit";
import { sendDm } from "../sending/send-dm";
import {
  conversationEventRow,
  journalConversationEvent,
  recordConversationEvent,
  type ConversationEventInput,
} from "./events";
import { conversationGuard } from "./guard";
import type { GuardVerdict, LiveWrites } from "./rules";

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
  /** Nombre de prises / rendus de main au début du tour (absent : pas de contrôle). */
  handoversAtStart?: number;
};

/** Textes fixes qui ne sont pas un tour de réponse (le moteur ne les compte pas non plus). */
const NOT_A_TURN: ReadonlySet<string> = new Set(["minorStop", "retryLater"]);
/** Étapes que le lien envoyé ne change pas (même règle que `decideStage` du moteur). */
const KEPT_ON_OFFER: ReadonlySet<string> = new Set(["LINK_SENT", "CONVERTED", "CLOSED"]);

/** Erreur rendue au moteur quand l'assistant n'a plus la parole (il s'arrête, le lien non parti est retiré). */
export const NOT_OURS_ERROR = "conversation reprise ou arrêtée";

/** Partie réellement envoyée (dans l'ordre), pour compléter ses informations après le tour. */
export type SentRow = {
  conversationMessageId: string;
  partIndex: number;
  offerSubId: string | null;
};

export type WorkerChatSender = ChatSender & { sentRows: SentRow[]; live: LiveWrites };

type SendDmFn = typeof sendDm;

export function createWorkerChatSender(
  ctx: SenderContext,
  deps: { sendDm?: SendDmFn; now?: () => Date; guard?: () => Promise<GuardVerdict> } = {},
): WorkerChatSender {
  const send = deps.sendDm ?? sendDm;
  const now = deps.now ?? (() => new Date());
  const guard =
    deps.guard ??
    (() =>
      conversationGuard(
        ctx.conversationId,
        ctx.resetsAtStart ?? null,
        ctx.handoversAtStart ?? null,
      ));
  const sentRows: SentRow[] = [];
  const live: LiveWrites = {
    lastSentAt: null,
    assistantTurnCounted: false,
    offerSends: 0,
    stage: null,
  };
  const ref = { id: ctx.conversationId, botId: ctx.botId, memberId: ctx.memberId };
  let nextPart = 0;

  /**
   * Faits d'une partie partie, écrits tout de suite. Un échec ici (base indisponible) n'arrête rien : ce qui n'est pas
   * marqué dans `live` est écrit à la fin du tour, comme avant.
   */
  async function recordFacts(
    offer: { subId: string } | null,
    fixedKey: string | null | undefined,
  ): Promise<void> {
    const at = now();
    const countTurn = !live.assistantTurnCounted && !NOT_A_TURN.has(fixedKey ?? "");
    const offerEvent: ConversationEventInput | null = offer
      ? {
          type: "offer_sent",
          payload: { subId: offer.subId, offerSends: ctx.offerSendsBefore + live.offerSends + 1 },
          at,
        }
      : null;
    try {
      const change = await prisma.$transaction(async (tx) => {
        let stage: { from: ConversationStage; to: ConversationStage } | null = null;
        if (offer) {
          const rows = await tx.$queryRaw<Array<{ stage: ConversationStage }>>`
            SELECT stage FROM "Conversation" WHERE id = ${ctx.conversationId} FOR UPDATE`;
          const cur = rows[0]?.stage;
          if (cur && !KEPT_ON_OFFER.has(cur)) stage = { from: cur, to: "LINK_SENT" };
        }
        await tx.conversation.updateMany({
          where: { id: ctx.conversationId },
          data: {
            lastAssistantAt: at,
            ...(countTurn ? { assistantTurns: { increment: 1 } } : {}),
            ...(offer ? { offerSends: { increment: 1 } } : {}),
            ...(stage ? { stage: stage.to } : {}),
          },
        });
        if (offerEvent)
          await tx.conversationEvent.create({ data: conversationEventRow(ref, offerEvent) });
        if (stage)
          await tx.conversationEvent.create({
            data: conversationEventRow(ref, {
              type: "stage_changed",
              fromStage: stage.from,
              toStage: stage.to,
              at,
            }),
          });
        return stage;
      });
      live.lastSentAt = at;
      if (countTurn) live.assistantTurnCounted = true;
      if (offer) live.offerSends += 1;
      if (change) live.stage = change;
      if (offerEvent) await journalConversationEvent(ref, offerEvent);
      if (change)
        await journalConversationEvent(ref, {
          type: "stage_changed",
          fromStage: change.from,
          toStage: change.to,
          at,
        });
    } catch (err) {
      logger.warn(
        { conversationId: ctx.conversationId, err: (err as Error).message },
        "assistant : faits de l'envoi non écrits tout de suite (écrits à la fin du tour)",
      );
      if (offerEvent) await recordConversationEvent(ref, offerEvent);
    }
  }

  async function sendPart(
    text: string,
    opts: {
      buttons?: ChatButton[][];
      mediaAssetId?: string | null;
      fixedKey?: string | null;
      offerSubId?: string | null;
    },
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
      ctx.pendingOffer &&
      (opts.offerSubId === ctx.pendingOffer.subId ||
        buttons.some((row) => row.some((b) => b.url === ctx.pendingOffer?.url)))
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

    let r: Awaited<ReturnType<SendDmFn>>;
    try {
      r = await send(om.id);
    } catch (err) {
      // Erreur avant toute réponse de Telegram (base indisponible…) : jamais un message fantôme « en file ».
      const error = err instanceof Error ? err.message : String(err);
      await prisma.outboundMessage
        .updateMany({
          where: { id: om.id, status: "QUEUED" },
          data: { status: "FAILED", error: `Envoi impossible : ${error}`.slice(0, 500) },
        })
        .catch(() => undefined);
      await prisma.conversationMessage.delete({ where: { id: cm.id } }).catch(() => undefined);
      return { ok: false, blocked: false, unreachable: false, error };
    }
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
    if (offer) ctx.pendingOffer = null;
    await recordFacts(offer, opts.fixedKey);
    return r.telegramMessageId !== null
      ? { ok: true, telegramMessageId: r.telegramMessageId }
      : { ok: true };
  }

  return {
    capabilities: { canInitiate: false, canMarkRead: false, canSendButtons: true },
    sentRows,
    live,
    async sendTyping() {
      const { api } = await apiForBot(ctx.botId);
      await new RateLimiter(getRedis()).forBot(ctx.botId);
      // « écrit… » est un confort : une seule attente sur 429, un seul nouvel essai réseau.
      await withTelegramRetry(() => api.sendChatAction(Number(ctx.chatId), "typing"), {
        max429: 1,
        maxNetworkAttempts: 2,
      });
    },
    sendText(text, opts?: SendOptions) {
      return sendPart(text, {
        buttons: opts?.buttons,
        fixedKey: opts?.fixedKey,
        offerSubId: opts?.offerSubId ?? null,
      });
    },
    sendMedia(media, caption, opts?: SendOptions) {
      return sendPart(caption, {
        buttons: opts?.buttons,
        mediaAssetId: media.mediaAssetId,
        fixedKey: opts?.fixedKey,
        offerSubId: opts?.offerSubId ?? null,
      });
    },
  };
}

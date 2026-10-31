/**
 * Transport MTProto du moteur de conversation (phase 18, tache 03) : implementation de `ChatSender`
 * par la session GramJS persistante du compte (client.ts). Un transport = un tour d'une conversation.
 * Pas de boutons possibles depuis un compte utilisateur : le moteur met alors le lien en clair.
 */
import type { ChatCapabilities, ChatSender, SendOptions, SendResult } from "@linkaffipro/chat";
import { prisma, toJsonValue } from "@linkaffipro/db";
import { Api, type TelegramClient } from "telegram";
import { logger } from "./logger";
import { CustomFile } from "telegram/client/uploads.js";

/** Pair accepte par GramJS (identifiant, nom d'utilisateur ou entite deja resolue). */
export type TransportPeer = Parameters<TelegramClient["sendMessage"]>[0];

export type TransportContext = {
  client: TelegramClient;
  peer: TransportPeer;
  conversationId: string;
  memberId: string;
  turnId: string;
};

const CAPABILITIES: ChatCapabilities = {
  canInitiate: true,
  canMarkRead: true,
  canSendButtons: false,
};

/** Classe l'erreur Telegram pour que le moteur ferme la conversation si la personne est perdue. */
export function classifySendError(err: unknown): Extract<SendResult, { ok: false }> {
  const error = err instanceof Error ? err.message : String(err);
  const lower = error.toLowerCase();
  return {
    ok: false,
    blocked: lower.includes("blocked"),
    unreachable: lower.includes("deactivated") || lower.includes("not found"),
    error: error.slice(0, 500),
  };
}

/**
 * Garde-fou deterministe sur les tics d'ecriture. Remplacements surs uniquement : aucun ne peut casser une phrase.
 */
const TIC_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:[çc]a)\s+va\s+nickel\b/gi, "ca va"],
  [/\b(?:[çc]a)\s+va\s+tranquille\b/gi, "ca va"],
  [/\b(?:c'est|ces|ses)\s+nickel\b/gi, "c'est top"],
  [/\bnickel\b/gi, "top"],
  [/\s*,?\s*dis donc\b/gi, ""],
  [/\s+ou quoi\s*\?/gi, " ?"],
];

export function normalizeTics(text: string): string {
  let out = text;
  for (const [re, to] of TIC_RULES) out = out.replace(re, to);
  return out.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+([!?.,;:])/g, "$1").trim();
}

export function createMtprotoTransport(ctx: TransportContext): ChatSender {
  // Rang des parties du tour : avance seulement sur un envoi reussi (aucun trou si un envoi echoue).
  let partIndex = 0;

  async function persist(
    text: string,
    telegramMessageId: number,
    opts?: SendOptions,
    mediaAssetId?: string | null,
  ) {
    const meta: Record<string, unknown> = {};
    if (opts?.offerSubId) meta.offerSubId = opts.offerSubId;
    if (opts?.fixedKey) meta.fixedKey = opts.fixedKey;
    if (mediaAssetId) meta.mediaAssetId = mediaAssetId;
    try {
      await prisma.conversationMessage.create({
        data: {
          conversationId: ctx.conversationId,
          direction: "OUT",
          author: "ASSISTANT",
          text,
          meta: toJsonValue(meta),
          turnId: ctx.turnId,
          partIndex: partIndex++,
          telegramMessageId: BigInt(telegramMessageId),
        },
      });
    } catch (err) {
      // Le message est deja parti : le dire au moteur comme un echec ferait renvoyer un doublon.
      logger.error(
        { conversation: ctx.conversationId, err: err instanceof Error ? err.message : String(err) },
        "message parti mais non enregistre",
      );
    }
  }

  async function send(raw: string, opts?: SendOptions): Promise<SendResult> {
    // Le modele ignore la liste noire du prompt une fois sur trois : on corrige apres coup, a coup sur.
    const text = normalizeTics(raw);
    try {
      const sent = await ctx.client.sendMessage(ctx.peer, { message: text, linkPreview: false });
      await persist(text, sent.id, opts);
      return { ok: true, telegramMessageId: sent.id };
    } catch (err) {
      const result = classifySendError(err);
      logger.warn(
        { conversation: ctx.conversationId, membre: ctx.memberId, err: result.error },
        "envoi refuse",
      );
      return result;
    }
  }

  /**
   * Photo avec legende. Un media absent ou illisible ne perd pas le message : la legende part seule en texte.
   */
  async function sendPhoto(
    mediaAssetId: string | null | undefined,
    caption: string,
    opts?: SendOptions,
  ): Promise<SendResult> {
    if (!mediaAssetId) return send(caption, opts);
    let asset: { bytes: Uint8Array; filename: string } | null = null;
    try {
      asset = await prisma.mediaAsset.findUnique({
        where: { id: mediaAssetId },
        select: { bytes: true, filename: true },
      });
    } catch (err) {
      logger.warn(
        { media: mediaAssetId, err: err instanceof Error ? err.message : String(err) },
        "media illisible",
      );
    }
    if (!asset) return send(caption, opts);
    try {
      const buffer = Buffer.from(asset.bytes);
      const file = new CustomFile(asset.filename, buffer.byteLength, "", buffer);
      const sent = await ctx.client.sendFile(ctx.peer, { file, caption, forceDocument: false });
      await persist(caption, sent.id, opts, mediaAssetId);
      return { ok: true, telegramMessageId: sent.id };
    } catch (err) {
      const result = classifySendError(err);
      logger.warn(
        { conversation: ctx.conversationId, media: mediaAssetId, err: result.error },
        "photo refusee",
      );
      return result;
    }
  }

  return {
    capabilities: CAPABILITIES,
    async sendTyping() {
      // Un « ecrit... » rate est sans consequence : jamais d'erreur rendue.
      try {
        await ctx.client.invoke(
          new Api.messages.SetTyping({
            peer: ctx.peer,
            action: new Api.SendMessageTypingAction(),
          }),
        );
      } catch {
        /* ignore */
      }
    },
    sendText: (text, opts) => send(text, opts),
    sendMedia: (media, caption, opts) => sendPhoto(media.mediaAssetId, caption, opts),
    async markRead() {
      try {
        await ctx.client.markAsRead(ctx.peer);
      } catch {
        /* ignore */
      }
    },
  };
}

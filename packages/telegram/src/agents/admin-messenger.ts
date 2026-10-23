/**
 * Messager du dialogue admin pour les agents (CONTRAT, propriétaire : chantier B). Implémente `AdminMessenger`
 * (`@linkaffipro/agents`) : envoi au seul identifiant admin (`Setting` `admin.telegramUserId`) par le bot du dialogue
 * admin (celui de `notifyAdmin`), boutons inline, média joint (octets `MediaAsset`). Utilisé par le worker et le site.
 */
import { Api, GrammyError, InputFile } from "grammy";
import type { InlineKeyboardMarkup } from "grammy/types";
import type { AdminButton, AdminMessenger } from "@linkaffipro/agents";
import { decrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { splitMessage } from "../admin-chat";
import { ADMIN_BOT_ORDER, ADMIN_BOT_WHERE } from "../admin-bot";

/** Légende d'une photo ou d'une vidéo : au-delà, le texte part dans un second message. */
export const CAPTION_MAX = 1024;

type SendOpts = { parse_mode?: "HTML"; reply_markup?: InlineKeyboardMarkup; reply_parameters?: { message_id: number; allow_sending_without_reply: boolean }; link_preview_options?: { is_disabled: boolean }; caption?: string };

/** Sous-ensemble de l'API grammY utilisé (remplacé par un faux dans les tests). */
export type MessengerApi = {
  sendMessage(chatId: number, text: string, other?: SendOpts): Promise<{ message_id: number }>;
  sendPhoto(chatId: number, photo: InputFile, other?: SendOpts): Promise<{ message_id: number }>;
  sendVideo(chatId: number, video: InputFile, other?: SendOpts): Promise<{ message_id: number }>;
  sendDocument(chatId: number, document: InputFile, other?: SendOpts): Promise<{ message_id: number }>;
  deleteMessage(chatId: number, messageId: number): Promise<unknown>;
};

export type MessengerPort = {
  adminId(): Promise<bigint | null>;
  api(): Promise<MessengerApi | null>;
  media(id: string): Promise<{ bytes: Uint8Array; mimeType: string; filename: string } | null>;
};

function keyboard(buttons?: AdminButton[][]): InlineKeyboardMarkup | undefined {
  if (!buttons?.length) return undefined;
  return { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.callbackData }))) };
}

/** Repli en texte brut quand Telegram refuse le HTML : balises retirées, entités décodées. */
export function htmlToPlain(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

function isParseError(err: unknown): boolean {
  return err instanceof GrammyError ? /parse entities|can't parse/i.test(err.description) : /parse entities/i.test(String((err as Error)?.message));
}

/** Essaie en HTML, puis en texte brut si le HTML est refusé. */
async function withHtmlFallback(
  send: (text: string, html: boolean) => Promise<{ message_id: number }>,
  text: string,
): Promise<{ message_id: number }> {
  try {
    return await send(text, true);
  } catch (err) {
    if (!isParseError(err)) throw err;
    return send(htmlToPlain(text), false);
  }
}

export function createAdminMessengerWith(port: MessengerPort): AdminMessenger {
  return {
    async send(html, opts = {}) {
      const [adminId, api] = await Promise.all([port.adminId(), port.api()]);
      if (!adminId || !api) return null;
      const chatId = Number(adminId);
      const reply_markup = keyboard(opts.buttons);
      const reply_parameters = opts.replyToMessageId
        ? { message_id: opts.replyToMessageId, allow_sending_without_reply: true }
        : undefined;

      const media = opts.mediaAssetId ? await port.media(opts.mediaAssetId) : null;
      if (media) {
        const file = new InputFile(Buffer.from(media.bytes), media.filename);
        const method = media.mimeType.startsWith("image/") ? "sendPhoto" : media.mimeType.startsWith("video/") ? "sendVideo" : "sendDocument";
        const fits = html.length <= CAPTION_MAX;
        const sentMedia = await withHtmlFallback(
          (caption, isHtml) =>
            api[method](chatId, file, {
              ...(fits ? { caption, ...(isHtml ? { parse_mode: "HTML" as const } : {}), reply_markup } : {}),
              reply_parameters,
            }),
          fits ? html : "",
        );
        if (fits) return { messageId: sentMedia.message_id };
      }

      // Texte long : découpé ; les boutons vont avec le dernier morceau (celui qu'on garde).
      const parts = splitMessage(html);
      let last: { message_id: number } | null = null;
      for (let i = 0; i < parts.length; i++) {
        const isLast = i === parts.length - 1;
        last = await withHtmlFallback(
          (text, isHtml) =>
            api.sendMessage(chatId, text, {
              ...(isHtml ? { parse_mode: "HTML" as const } : {}),
              link_preview_options: { is_disabled: true },
              ...(isLast && reply_markup ? { reply_markup } : {}),
              ...(i === 0 && reply_parameters && !media ? { reply_parameters } : {}),
            }),
          parts[i]!,
        );
      }
      return last ? { messageId: last.message_id } : null;
    },
    async deleteMessage(messageId) {
      const [adminId, api] = await Promise.all([port.adminId(), port.api()]);
      if (!adminId || !api) return;
      await api.deleteMessage(Number(adminId), messageId);
    },
  };
}

/** Port réel : `Setting` `admin.telegramUserId`, bot casino STANDARD actif (comme `notifyAdmin`), octets `MediaAsset`. */
const prismaPort: MessengerPort = {
  async adminId() {
    const s = await prisma.setting.findUnique({ where: { key: "admin.telegramUserId" } });
    return s && typeof s.value === "string" && /^\d+$/.test(s.value) ? BigInt(s.value) : null;
  },
  async api() {
    // Jamais un bot assistant de conversation (phase 17).
    const bot = await prisma.bot.findFirst({ where: ADMIN_BOT_WHERE, orderBy: ADMIN_BOT_ORDER });
    return bot ? (new Api(decrypt(bot.tokenEncrypted)) as unknown as MessengerApi) : null;
  },
  async media(id) {
    const a = await prisma.mediaAsset.findUnique({
      where: { id },
      select: { bytes: true, mimeType: true, filename: true },
    });
    return a ? { bytes: a.bytes, mimeType: a.mimeType, filename: a.filename } : null;
  },
};

export function createAdminMessenger(): AdminMessenger {
  return createAdminMessengerWith(prismaPort);
}

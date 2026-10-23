import type { Bot } from "grammy";
import type { Message } from "grammy/types";
import { hasLibraryKeyword, storeLibraryMedia } from "@linkaffipro/agents";
import type { BotIdentity, TelegramDeps } from "../ports";

/** Limite de téléchargement de l'API Bot (`getFile`). */
export const BOT_DOWNLOAD_MAX_BYTES = 20 * 1024 * 1024;
const ALBUM_MEMORY_MS = 60_000;

export type InboxMedia = {
  fileId: string;
  fileUniqueId: string;
  mimeType: string;
  filename: string;
  size?: number;
  width?: number;
  height?: number;
  duration?: number;
};

/** Média d'un message : photo (la plus grande), vidéo, animation, document vidéo ou image. Sinon null. */
export function inboxMediaOf(msg: Message): InboxMedia | null {
  if (msg.photo?.length) {
    const p = msg.photo[msg.photo.length - 1]!;
    return { fileId: p.file_id, fileUniqueId: p.file_unique_id, mimeType: "image/jpeg", filename: `${p.file_unique_id}.jpg`, size: p.file_size, width: p.width, height: p.height };
  }
  const v = msg.video ?? msg.animation;
  if (v)
    return {
      fileId: v.file_id,
      fileUniqueId: v.file_unique_id,
      mimeType: v.mime_type ?? "video/mp4",
      filename: v.file_name ?? `${v.file_unique_id}.mp4`,
      size: v.file_size,
      width: v.width,
      height: v.height,
      duration: v.duration,
    };
  const d = msg.document;
  if (d && d.mime_type && /^(video|image)\//.test(d.mime_type))
    return { fileId: d.file_id, fileUniqueId: d.file_unique_id, mimeType: d.mime_type, filename: d.file_name ?? d.file_unique_id, size: d.file_size };
  return null;
}

async function defaultDownload(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`téléchargement refusé (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Phase 19 : dépôt dans la médiathèque des agents. Un média (photo, vidéo, animation, document vidéo) envoyé ou
 * transféré en privé par l'admin (`Setting` `admin.telegramUserId`) avec une légende à mots-clés (`#casino #roulette`,
 * `#dating #source #lea`, `#photo`) est téléchargé et rangé ; le bot confirme en une ligne. Album : la légende du
 * premier média vaut pour les autres (une minute). Toute autre personne, ou un média sans mot-clé : `next()` (le
 * transfert d'un message de canal continue vers handlers/forward.ts).
 */
export function registerMediaInboxHandlers(bot: Bot, identity: BotIdentity, deps: TelegramDeps): void {
  const albumCaptions = new Map<string, { caption: string; until: number }>();

  bot.on("message", async (ctx, next) => {
    const from = ctx.from;
    if (ctx.chat.type !== "private" || from.is_bot || !deps.agentsDeps || !deps.isAdminDialogPartner) return next();
    const msg = ctx.message;
    const media = inboxMediaOf(msg);
    if (!media) return next();
    const now = Date.now();
    let caption = msg.caption ?? "";
    const group = msg.media_group_id;
    if (group) {
      for (const [k, v] of albumCaptions) if (v.until < now) albumCaptions.delete(k);
      if (hasLibraryKeyword(caption)) albumCaptions.set(group, { caption, until: now + ALBUM_MEMORY_MS });
      else caption = albumCaptions.get(group)?.caption ?? caption;
    }
    if (!hasLibraryKeyword(caption)) return next();
    if (!(await deps.isAdminDialogPartner(BigInt(from.id)))) return next();

    const replyLine = (text: string) =>
      ctx.reply(text, { reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true } });
    if (media.size && media.size > BOT_DOWNLOAD_MAX_BYTES) {
      await replyLine("Fichier trop lourd pour le bot (20 Mo au plus) : envoie une version plus légère.");
      return;
    }
    try {
      const file = await ctx.api.getFile(media.fileId);
      if (!file.file_path) throw new Error("fichier indisponible");
      const url = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
      const bytes = await (deps.downloadTelegramFile ?? defaultDownload)(url);
      const r = await storeLibraryMedia(deps.agentsDeps(), {
        bytes,
        mimeType: media.mimeType,
        filename: media.filename,
        width: media.width ?? null,
        height: media.height ?? null,
        duration: media.duration ?? null,
        caption,
        botId: identity.id,
        telegramFileId: media.fileId,
        fileUniqueId: media.fileUniqueId,
        copyToLibrary: async (channelId) => {
          const copied = await ctx.api.copyMessage(channelId, ctx.chat.id, msg.message_id);
          return { messageId: copied.message_id };
        },
      });
      await replyLine(r.line);
    } catch (err) {
      console.error("[agents] dépôt dans la médiathèque", identity.username, (err as Error).message);
      await replyLine("Je n'ai pas pu ranger ce média. Réessaie dans un instant.");
    }
  });
}

import type { Bot } from "grammy";
import type { Message } from "grammy/types";
import { hasLibraryKeyword, libraryAlbumLine, storeLibraryMedia, type StoreLibraryMediaResult } from "@linkaffipro/agents";
import type { BotIdentity, TelegramDeps } from "../ports";

/** Limite de téléchargement de l'API Bot (`getFile`). */
export const BOT_DOWNLOAD_MAX_BYTES = 20 * 1024 * 1024;
const ALBUM_MEMORY_MS = 60_000;
/** Attente après le dernier média d'un album avant la ligne de confirmation unique. */
export const ALBUM_REPLY_DELAY_MS = 2_000;

type AlbumBatch = {
  pending: number;
  results: StoreLibraryMediaResult[];
  failed: number;
  timer: ReturnType<typeof setTimeout> | null;
  replyTo: number;
};

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
 * Phase 19 : dépôt dans la médiathèque des agents. Un média (photo, vidéo, animation, document vidéo) envoyé (ou
 * transféré d'une personne, sans être transféré d'un canal) en privé par l'admin (`Setting` `admin.telegramUserId`) avec une légende à mots-clés (`#casino #roulette`,
 * `#dating #source #lea`, `#photo`) est téléchargé et rangé ; le bot confirme en une ligne. Album : la légende du
 * premier média vaut pour les autres (une minute) ; une seule ligne de confirmation pour tout l'album, envoyée
 * `ALBUM_REPLY_DELAY_MS` après le dernier média rangé (phase 22). Toute autre personne, ou un média sans mot-clé : `next()` (le
 * transfert d'un message de canal continue vers handlers/forward.ts).
 */
export function registerMediaInboxHandlers(bot: Bot, identity: BotIdentity, deps: TelegramDeps): void {
  const albumCaptions = new Map<string, { caption: string; until: number }>();
  const albums = new Map<string, AlbumBatch>();
  const albumDelay = deps.mediaAlbumReplyDelayMs ?? ALBUM_REPLY_DELAY_MS;

  bot.on("message", async (ctx, next) => {
    const from = ctx.from;
    if (ctx.chat.type !== "private" || from.is_bot || !deps.agentsDeps || !deps.isAdminDialogPartner) return next();
    const msg = ctx.message;
    const media = inboxMediaOf(msg);
    if (!media) return next();
    const now = Date.now();
    // Un message transféré d'un canal garde la légende du CANAL (« #casino », « #paris »… y sont courants) : elle ne
    // vaut jamais rangement, le transfert sert à ajouter le canal (handlers/forward.ts). Seule une légende écrite par
    // l'admin (message non transféré d'un canal, ou légende de l'admin sur le même album) range le média.
    const fromChannel = msg.forward_origin?.type === "channel";
    let caption = fromChannel ? "" : (msg.caption ?? "");
    const group = msg.media_group_id;
    if (group) {
      for (const [k, v] of albumCaptions) if (v.until < now) albumCaptions.delete(k);
      if (hasLibraryKeyword(caption)) albumCaptions.set(group, { caption, until: now + ALBUM_MEMORY_MS });
      else caption = albumCaptions.get(group)?.caption ?? caption;
    }
    if (!hasLibraryKeyword(caption)) return next();
    if (!(await deps.isAdminDialogPartner(BigInt(from.id)))) return next();

    const replyLine = (text: string, to = msg.message_id) =>
      ctx.reply(text, { reply_parameters: { message_id: to, allow_sending_without_reply: true } });
    if (media.size && media.size > BOT_DOWNLOAD_MAX_BYTES) {
      await replyLine("Fichier trop lourd pour le bot (20 Mo au plus) : envoie une version plus légère.");
      return;
    }
    // Album : les médias sont rangés un par un, la confirmation attend le dernier (une seule ligne).
    const batchKey = group ? `${ctx.chat.id}:${group}` : null;
    let batch: AlbumBatch | null = null;
    if (batchKey) {
      batch = albums.get(batchKey) ?? { pending: 0, results: [], failed: 0, timer: null, replyTo: msg.message_id };
      albums.set(batchKey, batch);
      if (batch.timer) clearTimeout(batch.timer);
      batch.timer = null;
      batch.pending++;
    }
    const settle = (result: StoreLibraryMediaResult | null) => {
      if (!batch || !batchKey) return;
      if (result) batch.results.push(result);
      else batch.failed++;
      batch.pending--;
      if (batch.pending > 0) return;
      const b = batch;
      b.timer = setTimeout(() => {
        albums.delete(batchKey);
        void (async () => {
          const line = await libraryAlbumLine(deps.agentsDeps!(), b.results, b.failed);
          if (line) await replyLine(line, b.replyTo);
        })().catch((err) => console.error("[agents] confirmation d'album", identity.username, (err as Error).message));
      }, albumDelay);
    };
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
      if (batch) settle(r);
      else await replyLine(r.line);
    } catch (err) {
      console.error("[agents] dépôt dans la médiathèque", identity.username, (err as Error).message);
      if (batch) settle(null);
      else await replyLine("Je n'ai pas pu ranger ce média. Réessaie dans un instant.");
    }
  });
}

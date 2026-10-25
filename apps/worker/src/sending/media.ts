import { InputFile } from "grammy";
import type { InputMediaDocument, InputMediaPhoto, InputMediaVideo, InputMediaAnimation, Message } from "grammy/types";
import { prisma } from "@linkaffipro/db";
import { assertShortApproved, sendableBytes } from "../montage/media-bytes";

export type MediaKind = "photo" | "video" | "animation" | "document";

export function mediaKindOf(mimeType: string): MediaKind {
  if (mimeType === "image/gif") return "animation";
  if (mimeType.startsWith("image/")) return "photo";
  if (mimeType.startsWith("video/")) return "video";
  return "document";
}

export type LoadedMedia = { assetId: string; kind: MediaKind; media: string | InputFile; filename: string };

/**
 * Charge un média : identifiant Telegram déjà connu pour ce bot, sinon les octets (phase 28 : un short gardé dans
 * Telegram est retrouvé par `sendableBytes` ; un short pas encore validé ne part jamais).
 */
export async function loadMedia(assetId: string, botId: string): Promise<LoadedMedia | null> {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId }, include: { telegramFiles: { where: { botId } } } });
  if (!asset) return null;
  const kind = mediaKindOf(asset.mimeType);
  await assertShortApproved(asset);
  const known = asset.telegramFiles[0];
  if (known) return { assetId, kind, media: known.telegramFileId, filename: asset.filename };
  const bytes = asset.storage === "telegram" ? await sendableBytes(asset) : asset.bytes;
  return { assetId, kind, media: new InputFile(Buffer.from(bytes), asset.filename), filename: asset.filename };
}

export function toInputMedia(m: LoadedMedia, caption?: string): InputMediaPhoto | InputMediaVideo | InputMediaAnimation | InputMediaDocument {
  const base = caption ? { caption, parse_mode: "HTML" as const } : {};
  switch (m.kind) {
    case "photo":
      return { type: "photo", media: m.media, ...base };
    case "video":
      return { type: "video", media: m.media, ...base };
    case "animation":
      return { type: "animation", media: m.media, ...base };
    default:
      return { type: "document", media: m.media, ...base };
  }
}

/** Extrait le file_id du média contenu dans un message Telegram envoyé. */
export function fileIdsOf(msg: Message): { fileId: string; fileUniqueId: string } | null {
  if (msg.photo && msg.photo.length > 0) {
    const p = msg.photo[msg.photo.length - 1]!;
    return { fileId: p.file_id, fileUniqueId: p.file_unique_id };
  }
  const f = msg.video ?? msg.animation ?? msg.document ?? msg.audio ?? msg.voice;
  return f ? { fileId: f.file_id, fileUniqueId: f.file_unique_id } : null;
}

/** Mémorise le file_id Telegram d'un média pour un bot (réutilisation sans ré-upload). */
export async function rememberTelegramFile(assetId: string, botId: string, msg: Message): Promise<void> {
  const ids = fileIdsOf(msg);
  if (!ids) return;
  await prisma.mediaAssetTelegramFile
    .upsert({
      where: { assetId_botId: { assetId, botId } },
      create: { assetId, botId, telegramFileId: ids.fileId, fileUniqueId: ids.fileUniqueId },
      update: { telegramFileId: ids.fileId, fileUniqueId: ids.fileUniqueId },
    })
    .catch(() => undefined);
}

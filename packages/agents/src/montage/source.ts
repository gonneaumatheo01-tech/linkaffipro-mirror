/**
 * Phase 28, chantier D — vidéo longue du client (règle : jamais en base).
 * - `createLongVideoAsset` : `MediaAsset` LONG_VIDEO `storage = "telegram"`, `bytes` vide, empreinte stable du
 *   `fileUniqueId` (le même fichier renvoyé ne crée pas de doublon : la référence passe au message le plus récent).
 * - `downloadSource` : copie de travail sur le disque du worker ; ≤ 20 Mo par le bot de Kevin (API Bot `getFile`),
 *   au-delà par le compte Telegram connecté de l'admin (MTProto, sous `withMtprotoLock`, reprise du fichier partiel).
 *   Plus de 2 Go ou plus de 3 h : refus clair (`MontageRefused`), jamais réessayé.
 * - `createTelegramDownloader` : aiguillage bot / compte, réalisations concrètes branchées par le worker
 *   (`packages/telegram` pour le bot, `packages/mtproto` pour le compte).
 */
import { createHash } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { agentEvent } from "../admin/journal";
import { MONTAGE_LIMITS, MONTAGE_TEAM_KEY, type MontageDeps } from "./contract";
import { MontageRefused, parseTelegramRef, type MontagePipelineDeps, type TelegramRef } from "./runtime";

export type LongVideoInput = {
  /** Conversation où Kevin a reçu la vidéo (identifiant de l'admin en privé, ou du groupe). */
  chatId: string | number | bigint;
  messageId: number;
  fileId: string;
  fileUniqueId: string;
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  durationSec?: number | null;
  width?: number | null;
  height?: number | null;
  createdById?: string | null;
  /** Bot de Kevin qui a reçu la vidéo (son `fileId` ne vaut que pour lui). */
  botId?: string | null;
};

export type LongVideoResult = { ok: true; assetId: string; created: boolean } | { ok: false; reason: string };

/** `Int` Prisma (32 bits) : une vidéo de 2 Go tout juste déborde d'un octet. */
const INT_MAX = 2_147_483_647;

function fmtGo(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1).replace(".", ",")} Go`;
}

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
}

/** Refus d'une source (pur) : trop lourde ou trop longue ; null si acceptée. */
export function sourceRefusal(input: { sizeBytes?: number | null; durationMs?: number | null }): string | null {
  if (typeof input.sizeBytes === "number" && input.sizeBytes > MONTAGE_LIMITS.maxSourceBytes)
    return `Ta vidéo fait ${fmtGo(input.sizeBytes)} : je prends 2 Go au plus. Coupe-la en deux et renvoie-moi les morceaux.`;
  if (typeof input.durationMs === "number" && input.durationMs > MONTAGE_LIMITS.maxSourceDurationMs)
    return `Ta vidéo dure ${fmtDuration(input.durationMs / 1000)} : je prends 3 h au plus. Coupe-la en deux et renvoie-moi les morceaux.`;
  return null;
}

/** Empreinte stable d'une vidéo gardée dans Telegram (le fichier n'est pas lu : `fileUniqueId` est le même partout). */
export function longVideoSha256(fileUniqueId: string): string {
  return createHash("sha256").update(`telegram:${fileUniqueId}`).digest("hex");
}

export async function createLongVideoAsset(deps: MontageDeps, input: LongVideoInput): Promise<LongVideoResult> {
  if (!input.fileId || !input.fileUniqueId) return { ok: false, reason: "Je n'ai pas trouvé le fichier de la vidéo : renvoie-la." };
  const refusal = sourceRefusal({
    sizeBytes: input.sizeBytes ?? null,
    durationMs: typeof input.durationSec === "number" ? input.durationSec * 1000 : null,
  });
  if (refusal) return { ok: false, reason: refusal };
  const ref: TelegramRef = {
    chatId: String(input.chatId),
    messageId: input.messageId,
    botId: input.botId ?? null,
    fileId: input.fileId,
    fileUniqueId: input.fileUniqueId,
    via: "kevin",
    sizeBytes: input.sizeBytes ?? null,
  };
  const sha256 = longVideoSha256(input.fileUniqueId);
  const existing = await deps.prisma.mediaAsset.findUnique({ where: { sha256 }, select: { id: true } });
  if (existing) {
    // Même fichier renvoyé : la référence suit le message le plus récent (le plus sûr de rester lisible).
    await deps.prisma.mediaAsset.update({ where: { id: existing.id }, data: { telegramRef: ref } });
    return { ok: true, assetId: existing.id, created: false };
  }
  const mimeType = input.mimeType && input.mimeType.startsWith("video/") ? input.mimeType : "video/mp4";
  const created = await deps.prisma.mediaAsset.create({
    data: {
      filename: input.fileName?.trim() || `video-${input.messageId}.mp4`,
      mimeType,
      size: Math.min(INT_MAX, Math.max(0, Math.round(input.sizeBytes ?? 0))),
      sha256,
      bytes: Buffer.alloc(0),
      width: input.width ?? null,
      height: input.height ?? null,
      duration: typeof input.durationSec === "number" ? Math.round(input.durationSec) : null,
      createdById: input.createdById ?? null,
      teamKey: MONTAGE_TEAM_KEY,
      kind: "LONG_VIDEO",
      origin: "HUMAN",
      tags: ["montage", "video-longue"],
      storage: "telegram",
      telegramRef: ref,
    },
    select: { id: true },
  });
  await agentEvent(deps, "agents.montage.source_received", { assetId: created.id, sizeBytes: input.sizeBytes ?? null, durationSec: input.durationSec ?? null });
  return { ok: true, assetId: created.id, created: true };
}

/** Champs d'un `MediaAsset` utiles au téléchargement. */
export type DownloadableAsset = {
  id: string;
  size: number;
  duration?: number | null;
  storage?: string | null;
  telegramRef?: unknown;
};

async function fileSize(path: string): Promise<number | null> {
  try {
    const s = await stat(path);
    return s.isFile() ? s.size : null;
  } catch {
    return null;
  }
}

/**
 * Copie de travail de la source vers `dest`. Déjà là (même poids) : rien n'est retéléchargé. Le téléchargement écrit
 * d'abord `<dest>.part` (repris tel quel par le compte connecté après une coupure), puis le renomme.
 */
export async function downloadSource(deps: MontagePipelineDeps, asset: DownloadableAsset, dest: string): Promise<{ path: string; sizeBytes: number; downloaded: boolean }> {
  const ref = parseTelegramRef(asset.telegramRef);
  const knownSize = ref?.sizeBytes ?? (asset.size > 0 ? asset.size : null);
  const refusal = sourceRefusal({ sizeBytes: knownSize, durationMs: typeof asset.duration === "number" ? asset.duration * 1000 : null });
  if (refusal) throw new MontageRefused(refusal);
  const already = await fileSize(dest);
  if (already !== null && already > 0 && (knownSize === null || already === knownSize)) return { path: dest, sizeBytes: already, downloaded: false };
  if (asset.storage !== "telegram" || !ref) throw new MontageRefused("Je ne retrouve plus la vidéo dans Telegram : renvoie-la-moi.");
  if (!deps.downloadTelegramFile) throw new Error("téléchargement Telegram non branché (worker)");
  await mkdir(dirname(dest), { recursive: true });
  await deps.downloadTelegramFile({ chatId: ref.chatId, messageId: ref.messageId, fileId: ref.fileId ?? null, sizeBytes: knownSize }, dest);
  const got = await fileSize(dest);
  if (got === null || got === 0) throw new Error("téléchargement de la vidéo vide");
  if (knownSize !== null && got !== knownSize) throw new Error(`téléchargement incomplet (${got} octets sur ${knownSize})`);
  return { path: dest, sizeBytes: got, downloaded: true };
}

/** Téléchargement par le bot de Kevin (API Bot, 20 Mo au plus) : `fileId` vers `dest`. */
export type BotFileDownloader = (fileId: string, dest: string) => Promise<void>;
/** Téléchargement par le compte connecté (MTProto) : le message `messageId` de la conversation `chatId`. */
export type AccountFileDownloader = (ref: { chatId: string; messageId: number; sizeBytes?: number | null }, dest: string) => Promise<void>;

/** Erreur « fichier trop lourd » de l'API Bot (`getFile` refuse au-delà de 20 Mo). */
export function isBotTooBig(err: unknown): boolean {
  const text = String((err as { description?: string })?.description ?? (err as Error)?.message ?? "");
  return /file is too big|trop lourd/i.test(text);
}

/**
 * Aiguillage (`MontageDeps.downloadTelegramFile`) : ≤ 20 Mo et `fileId` connu → bot de Kevin ; sinon (ou si le bot
 * échoue : « trop lourd », identifiant d'un ancien bot) → compte connecté de l'admin. Sans compte connecté : erreur
 * claire.
 */
export function createTelegramDownloader(impl: { bot?: BotFileDownloader | null; account?: AccountFileDownloader | null }): NonNullable<MontageDeps["downloadTelegramFile"]> {
  return async (ref, dest) => {
    const small = typeof ref.sizeBytes === "number" && ref.sizeBytes > 0 && ref.sizeBytes <= MONTAGE_LIMITS.botDownloadMaxBytes;
    if (small && ref.fileId && impl.bot) {
      try {
        await impl.bot(ref.fileId, dest);
        return;
      } catch (err) {
        // Trop lourd, ou `fileId` d'un ancien bot de Kevin : le compte connecté relit le message.
        if (!impl.account) throw err;
      }
    }
    if (!impl.account)
      throw Object.assign(new Error("fichier de plus de 20 Mo : il faut le compte Telegram connecté (Réglages → Connexions → Telegram)"), { code: "too_big" });
    await impl.account({ chatId: ref.chatId, messageId: ref.messageId, sizeBytes: ref.sizeBytes ?? null }, dest);
  };
}

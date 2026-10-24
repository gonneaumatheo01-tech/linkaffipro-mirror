/**
 * Aperçus des emojis animés de la bibliothèque (phase 12, file `custom-emoji`, tâche `fetch-previews` et passage
 * périodique `tick`). Par un de nos bots actifs (Bot API) : `getCustomEmojiStickers` par lots de 200, `getFile`, puis
 * téléchargement du fichier (≤ 512 Ko) stocké dans `CustomEmoji.previewBytes` avec son type :
 * « application/x-tgsticker » (.tgs, animation compressée), « video/webm » (.webm) ou « image/webp » (.webp). Le pack
 * (`setName`, `setTitle`), le format et l'emoji de remplacement manquants sont complétés au passage.
 * Échec → `previewError` et `previewAt` : nouvel essai au plus une fois par heure (passage périodique).
 * Une tâche traite un seul lot (200 emojis, une à deux minutes) : le reste repart en tâches d'un lot, MOINS PRIORITAIRES
 * (BullMQ sert d'abord les tâches sans priorité), pour qu'une vérification du compte (« Vérifier ») ou un import demandé
 * par l'équipe, dans la même file à un traitement à la fois, passe entre deux lots au lieu d'attendre 10 à 15 minutes.
 * Le jeton du bot n'apparaît jamais dans les journaux ni en base (adresse de téléchargement construite en mémoire).
 */
import { decrypt, isValidCustomEmojiId } from "@linkaffipro/core";
import { prisma, type Prisma } from "@linkaffipro/db";
import { ACTIVE_CHANNEL_BOT_WHERE } from "@linkaffipro/db/bot-selectors";
import { enqueue } from "@linkaffipro/queue";
import type { File as TelegramFile, Sticker, StickerSet } from "grammy/types";
import { logger } from "../logger";
import { apiForBot } from "../sending/api";
import { describeTelegramError, withTelegramRetry } from "../sending/errors";

/** Taille maximale d'un aperçu stocké. */
export const PREVIEW_MAX_BYTES = 512 * 1024;
/** `getCustomEmojiStickers` accepte au plus 200 identifiants par appel. */
export const PREVIEW_BATCH = 200;
/** Délai avant un nouvel essai après un échec (passage périodique). */
export const PREVIEW_RETRY_MS = 3600_000;
/** Aperçus traités par passage périodique (un lot ; la suite au passage suivant, 10 minutes plus tard). */
export const PREVIEW_TICK_LIMIT = PREVIEW_BATCH;
/** Aperçus pris en charge au plus par tâche explicite (import des packs du compte) : un lot traité, le reste en tâches. */
export const PREVIEW_EXPLICIT_LIMIT = 2000;
/**
 * Priorité des tâches d'aperçus enfilées par le worker (suites d'une tâche, import du compte). Dans BullMQ, une tâche
 * sans priorité passe avant toute tâche avec priorité : « Vérifier » et l'import, enfilés sans priorité, passent devant.
 */
export const PREVIEW_JOB_PRIORITY = 10;
/** Packs dont on cherche le titre par passage. */
const SET_TITLE_LIMIT = 20;

export type EmojiFormat = "tgs" | "webm" | "webp";

export const PREVIEW_MIME: Record<EmojiFormat, string> = {
  tgs: "application/x-tgsticker",
  webm: "video/webm",
  webp: "image/webp",
};

/** Format du fichier d'un emoji animé : animation compressée (.tgs), vidéo (.webm) ou image (.webp). */
export function stickerFormat(s: Pick<Sticker, "is_animated" | "is_video">): EmojiFormat {
  if (s.is_animated) return "tgs";
  if (s.is_video) return "webm";
  return "webp";
}

/**
 * Fichier à télécharger pour l'aperçu : l'emoji lui-même s'il tient dans la limite, sinon sa vignette fixe (.webp ou
 * .jpg). Null si rien ne tient (taille connue trop grande, pas de vignette).
 */
export function previewFileOf(
  s: Pick<Sticker, "file_id" | "file_size" | "is_animated" | "is_video" | "thumbnail">,
  maxBytes = PREVIEW_MAX_BYTES,
): { fileId: string; mime: string | null; thumbnail: boolean } | null {
  if (!s.file_size || s.file_size <= maxBytes)
    return { fileId: s.file_id, mime: PREVIEW_MIME[stickerFormat(s)], thumbnail: false };
  const t = s.thumbnail;
  if (t && (!t.file_size || t.file_size <= maxBytes))
    return { fileId: t.file_id, mime: null, thumbnail: true };
  return null;
}

/** Type d'une vignette d'après son chemin Telegram (.jpg / .webp). */
export function thumbnailMime(filePath: string): string {
  return /\.jpe?g$/i.test(filePath) ? "image/jpeg" : "image/webp";
}

/** Client Bot API minimal d'un bot pour les aperçus (simulé dans les tests). */
export interface PreviewBotClient {
  botId: string;
  username: string;
  getCustomEmojiStickers(ids: string[]): Promise<Sticker[]>;
  getStickerSet(name: string): Promise<StickerSet>;
  getFile(fileId: string): Promise<TelegramFile>;
  /** Télécharge le fichier (`file_path` de getFile) ; lève au-delà de `maxBytes`. */
  download(filePath: string, maxBytes: number): Promise<Uint8Array<ArrayBuffer>>;
}

export class PreviewTooLarge extends Error {
  constructor() {
    super("Aperçu trop lourd (plus de 512 Ko).");
    this.name = "PreviewTooLarge";
  }
}

/** Nos bots actifs (du plus ancien au plus récent) comme clients d'aperçus. `fetchImpl` : téléchargement (tests). */
export async function activePreviewClients(
  fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args),
): Promise<PreviewBotClient[]> {
  const bots = await prisma.bot.findMany({
    where: ACTIVE_CHANNEL_BOT_WHERE,
    orderBy: { createdAt: "asc" },
    select: { id: true, username: true, tokenEncrypted: true },
  });
  const out: PreviewBotClient[] = [];
  for (const b of bots) {
    let api: Awaited<ReturnType<typeof apiForBot>>["api"];
    try {
      api = (await apiForBot(b.id)).api;
    } catch {
      continue;
    }
    out.push({
      botId: b.id,
      username: b.username,
      getCustomEmojiStickers: (ids) => api.getCustomEmojiStickers(ids),
      getStickerSet: (name) => api.getStickerSet(name),
      getFile: (fileId) => api.getFile(fileId),
      async download(filePath, maxBytes) {
        const url = `https://api.telegram.org/file/bot${decrypt(b.tokenEncrypted)}/${filePath}`;
        let res: Response;
        try {
          res = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
        } catch {
          // Message générique : l'erreur d'origine pourrait citer l'adresse, qui contient le jeton du bot.
          throw new Error("Téléchargement impossible (réseau ou délai dépassé).");
        }
        if (!res.ok) throw new Error(`Téléchargement refusé par Telegram (${res.status}).`);
        const declared = Number(res.headers.get("content-length") ?? 0);
        if (declared > maxBytes) throw new PreviewTooLarge();
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength > maxBytes) throw new PreviewTooLarge();
        return bytes;
      },
    });
  }
  return out;
}

/**
 * Enfile les aperçus de ces emojis en tâches d'un lot (200), moins prioritaires que les autres tâches de la file.
 * Renvoie le nombre de tâches enfilées (0 si la file ne répond pas : le passage périodique les reprendra).
 */
export async function enqueuePreviewJobs(ids: readonly string[], tag: string): Promise<number> {
  let queued = 0;
  for (let i = 0; i < ids.length; i += PREVIEW_BATCH) {
    try {
      await enqueue(
        "custom-emoji",
        { type: "fetch-previews", customEmojiIds: ids.slice(i, i + PREVIEW_BATCH) },
        {
          jobId: `custom-emoji:previews:${tag}:${i / PREVIEW_BATCH}`,
          priority: PREVIEW_JOB_PRIORITY,
        },
      );
      queued++;
    } catch (err) {
      // Sans file : le passage périodique récupère les aperçus manquants.
      logger.warn({ err: String(err) }, "aperçus d'emojis animés non enfilés");
      break;
    }
  }
  return queued;
}

export type FetchPreviewsResult = {
  /** Emojis traités par cette tâche (un lot au plus). */
  requested: number;
  /** Tâches enfilées pour la suite (emojis au-delà du premier lot). */
  queued?: number;
  /** Aperçus enregistrés. */
  fetched: number;
  /** Échecs (erreur mémorisée, nouvel essai dans une heure au plus tôt). */
  failed: number;
  /** Titres de pack complétés. */
  setTitles: number;
  skipped?: "nothing" | "no_bot";
};

type Row = {
  id: string;
  customEmojiId: string;
  fallback: string;
  setName: string | null;
  setTitle: string | null;
};

function errorText(err: unknown): string {
  if (err instanceof PreviewTooLarge) return err.message;
  return describeTelegramError(err).message.slice(0, 300);
}

async function markFailed(ids: string[], error: string, now: Date): Promise<void> {
  if (ids.length === 0) return;
  await prisma.customEmoji.updateMany({
    where: { id: { in: ids } },
    data: { previewAt: now, previewError: error },
  });
}

/** Premier client qui répond pour ce lot (un bot dont le jeton est refusé laisse la place au suivant). */
async function stickersFor(
  clients: PreviewBotClient[],
  ids: string[],
  sleep?: (ms: number) => Promise<void>,
): Promise<{ client: PreviewBotClient; stickers: Sticker[] } | { error: string }> {
  let lastError = "Aucun bot n'a pu lire ces emojis.";
  for (const client of clients) {
    try {
      const stickers = await withTelegramRetry(() => client.getCustomEmojiStickers(ids), { sleep });
      return { client, stickers };
    } catch (err) {
      lastError = errorText(err);
      logger.warn(
        { bot: client.username, err: lastError },
        "aperçus d'emojis animés : lecture refusée",
      );
    }
  }
  return { error: lastError };
}

/**
 * Récupère les aperçus manquants : ceux de `customEmojiIds` (tâche enfilée après un ajout), sinon les emojis visibles
 * sans aperçu jamais essayés ou essayés il y a plus d'une heure (passage périodique). Jamais d'exception pour un échec
 * Telegram : l'erreur est mémorisée sur l'emoji (la tâche ne compte pas comme « échouée »).
 */
export async function fetchPreviews(
  opts: { customEmojiIds?: string[]; now?: Date; limit?: number } = {},
  deps: {
    clients?: PreviewBotClient[];
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<FetchPreviewsResult> {
  const now = opts.now ?? new Date();
  const explicit = opts.customEmojiIds !== undefined;
  const where: Prisma.CustomEmojiWhereInput = explicit
    ? {
        customEmojiId: { in: (opts.customEmojiIds ?? []).filter(isValidCustomEmojiId) },
        previewBytes: null,
      }
    : {
        previewBytes: null,
        hiddenAt: null,
        OR: [
          { previewAt: null },
          { previewAt: { lt: new Date(now.getTime() - PREVIEW_RETRY_MS) } },
        ],
      };
  const found: Row[] = await prisma.customEmoji.findMany({
    where,
    orderBy: { createdAt: "asc" },
    take: opts.limit ?? (explicit ? PREVIEW_EXPLICIT_LIMIT : PREVIEW_TICK_LIMIT),
    select: { id: true, customEmojiId: true, fallback: true, setName: true, setTitle: true },
  });
  // Un seul lot par tâche ; le reste en tâches moins prioritaires (voir l'en-tête).
  const rows = found.slice(0, PREVIEW_BATCH);
  const rest = found.slice(PREVIEW_BATCH).map((r) => r.customEmojiId);
  const result: FetchPreviewsResult = {
    requested: rows.length,
    fetched: 0,
    failed: 0,
    setTitles: 0,
  };
  if (rows.length === 0) return { ...result, skipped: "nothing" };
  const clients = deps.clients ?? (await activePreviewClients(deps.fetchImpl));
  if (clients.length === 0) {
    logger.warn({ count: found.length }, "aperçus d'emojis animés : aucun bot actif");
    return { ...result, skipped: "no_bot" };
  }
  if (rest.length > 0) result.queued = await enqueuePreviewJobs(rest, `next:${now.getTime()}`);

  const setsWithoutTitle = new Set<string>();
  let titleClient: PreviewBotClient | null = null;
  for (let i = 0; i < rows.length; i += PREVIEW_BATCH) {
    const batch = rows.slice(i, i + PREVIEW_BATCH);
    const got = await stickersFor(
      clients,
      batch.map((r) => r.customEmojiId),
      deps.sleep,
    );
    if ("error" in got) {
      await markFailed(
        batch.map((r) => r.id),
        `Aperçu indisponible pour le moment : ${got.error}`,
        now,
      );
      result.failed += batch.length;
      continue;
    }
    titleClient ??= got.client;
    const byId = new Map(
      got.stickers.filter((s) => s.custom_emoji_id).map((s) => [s.custom_emoji_id!, s]),
    );
    for (const row of batch) {
      const s = byId.get(row.customEmojiId);
      if (!s) {
        await markFailed(
          [row.id],
          "Emoji introuvable chez Telegram (retiré par son auteur ?).",
          now,
        );
        result.failed++;
        continue;
      }
      const format = stickerFormat(s);
      const setName = row.setName ?? s.set_name ?? null;
      if (setName && !row.setTitle) setsWithoutTitle.add(setName);
      // Format, pack et emoji de remplacement connus même si l'aperçu échoue ensuite.
      const meta: Prisma.CustomEmojiUpdateInput = {
        format,
        ...(row.setName || !s.set_name ? {} : { setName: s.set_name }),
        ...(row.fallback.trim() || !s.emoji ? {} : { fallback: s.emoji }),
      };
      const file = previewFileOf(s);
      if (!file) {
        await prisma.customEmoji.update({
          where: { id: row.id },
          data: { ...meta, previewAt: now, previewError: "Aperçu trop lourd (plus de 512 Ko)." },
        });
        result.failed++;
        continue;
      }
      try {
        const info = await withTelegramRetry(() => got.client.getFile(file.fileId), {
          sleep: deps.sleep,
        });
        if (!info.file_path) throw new Error("Fichier indisponible chez Telegram.");
        if (info.file_size && info.file_size > PREVIEW_MAX_BYTES) throw new PreviewTooLarge();
        const bytes = await got.client.download(info.file_path, PREVIEW_MAX_BYTES);
        await prisma.customEmoji.update({
          where: { id: row.id },
          data: {
            ...meta,
            previewBytes: bytes,
            previewMime: file.mime ?? thumbnailMime(info.file_path),
            previewAt: now,
            previewError: null,
          },
        });
        result.fetched++;
      } catch (err) {
        await prisma.customEmoji.update({
          where: { id: row.id },
          data: { ...meta, previewAt: now, previewError: errorText(err) },
        });
        result.failed++;
      }
    }
  }

  // Titres des packs (regroupement de la bibliothèque) : un appel par pack, sans bloquer.
  if (titleClient) {
    for (const name of [...setsWithoutTitle].slice(0, SET_TITLE_LIMIT)) {
      try {
        const set = await withTelegramRetry(() => titleClient!.getStickerSet(name), {
          sleep: deps.sleep,
        });
        const { count } = await prisma.customEmoji.updateMany({
          where: { setName: name, setTitle: null },
          data: { setTitle: set.title },
        });
        if (count > 0) result.setTitles++;
      } catch (err) {
        logger.warn({ set: name, err: errorText(err) }, "titre du pack d'emojis introuvable");
      }
    }
  }
  if (result.fetched || result.failed) logger.info(result, "aperçus d'emojis animés traités");
  return result;
}

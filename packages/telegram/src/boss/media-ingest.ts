/**
 * Phase 34 — médias d'un message transféré à Kevin rangés dans la médiathèque AVANT l'essai à blanc d'une opération du
 * site (règle 6 : le contenu reste fidèle, médias compris). Le `fileId` gardé par `boss/inputs/forwarded.ts` est propre
 * au bot qui a reçu le message : le bot du dialogue admin (`adminBot()`). Pour chaque média (10 au plus, la limite
 * d'un album Telegram) :
 * 1. déjà repris (même bot, même `fileId`) → le même `MediaAsset`, rien n'est téléchargé (idempotent) ;
 * 2. sinon `getFile` + téléchargement (fonction injectable : aucune vraie requête en test), 20 Mo au plus (limite de
 *    l'API Bot) → erreur claire ;
 * 3. rangé par `storeForwardedMedia` (empreinte, sans classement, identifiant de fichier du bot mémorisé).
 * Les messages d'erreur ne contiennent jamais l'adresse de téléchargement (elle porte le jeton du bot).
 */
import { Api } from "grammy";
import {
  storeForwardedMedia,
  type AgentsDeps,
  type ForwardedContent,
  type ForwardedMediaIngestResult,
} from "@linkaffipro/agents";
import { decrypt } from "@linkaffipro/core";
import { adminBot, type AdminBotChoice, type AdminBotDb } from "../admin-bot";

/** Limite de téléchargement de l'API Bot (`getFile`). */
export const BOSS_MEDIA_MAX_BYTES = 20 * 1024 * 1024;
/** Un album Telegram compte 10 médias au plus. */
export const BOSS_MEDIA_MAX_COUNT = 10;

type MediaKind = ForwardedContent["media"][number]["kind"];

/** Accès aux fichiers d'un bot : jeton (adresse de téléchargement) et `getFile`. */
export type BotFileApi = {
  token: string;
  getFile(fileId: string): Promise<{ file_path?: string; file_size?: number }>;
};

export type BossMediaIngestOptions = {
  /** Base lue pour choisir le bot du dialogue admin (par défaut : celle des dépendances des agents). */
  prisma?: AdminBotDb;
  /** Bot qui a reçu le message (par défaut `adminBot()`). */
  pickBot?: () => Promise<AdminBotChoice | null>;
  /** Accès aux fichiers du bot (par défaut l'API grammY avec le jeton déchiffré). */
  botFiles?: (bot: AdminBotChoice) => BotFileApi | Promise<BotFileApi>;
  /** Téléchargement (par défaut `fetch`) ; refuse au-delà de `maxBytes`. */
  download?: (url: string, maxBytes: number) => Promise<Uint8Array>;
};

export type BossMediaIngest = (deps: AgentsDeps, content: ForwardedContent) => Promise<ForwardedMediaIngestResult>;

class TooBig extends Error {}

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  pdf: "application/pdf",
};

/** Type de fichier selon la nature du média (photo → JPEG, vidéo / animation → MP4), l'extension sinon. Pur. */
export function forwardedMimeOf(kind: MediaKind, filePath: string | undefined): { mimeType: string; ext: string } {
  if (kind === "photo") return { mimeType: "image/jpeg", ext: "jpg" };
  if (kind === "video" || kind === "animation") return { mimeType: "video/mp4", ext: "mp4" };
  const base = filePath?.split("/").pop() ?? "";
  const ext = base.includes(".") ? (base.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) : "";
  const mime = EXT_MIME[ext];
  if (mime) return { mimeType: mime, ext };
  return kind === "audio" ? { mimeType: "audio/mpeg", ext: "mp3" } : { mimeType: "application/octet-stream", ext: ext || "bin" };
}

async function defaultDownload(url: string, maxBytes: number): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new Error("téléchargement impossible (réseau ou délai dépassé)");
  }
  if (!res.ok) throw new Error(`téléchargement refusé par Telegram (${res.status})`);
  if (Number(res.headers.get("content-length") ?? 0) > maxBytes) throw new TooBig("fichier trop lourd");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new TooBig("fichier trop lourd");
  return bytes;
}

function defaultBotFiles(bot: AdminBotChoice): BotFileApi {
  const token = decrypt(bot.tokenEncrypted);
  const api = new Api(token);
  return { token, getFile: (fileId) => api.getFile(fileId) };
}

/** « fichier trop lourd » de l'API Bot (`getFile` refuse au-delà de 20 Mo). */
function isTooBigError(err: unknown): boolean {
  return err instanceof TooBig || /file is too big/i.test(String((err as { description?: string })?.description ?? (err as Error)?.message ?? ""));
}

const LABEL: Record<MediaKind, string> = { photo: "photo", video: "vidéo", animation: "animation", document: "fichier", audio: "son" };

export function createBossMediaIngest(opts: BossMediaIngestOptions = {}): BossMediaIngest {
  const download = opts.download ?? defaultDownload;
  const botFiles = opts.botFiles ?? defaultBotFiles;
  return async (deps, content) => {
    const media = (content.media ?? []).filter((m) => m && typeof m.fileId === "string" && m.fileId).slice(0, BOSS_MEDIA_MAX_COUNT);
    if (media.length === 0) return { assetIds: [] };
    const bot = await (opts.pickBot ?? (() => adminBot(opts.prisma ?? (deps.prisma as unknown as AdminBotDb))))().catch(() => null);
    if (!bot) return { error: "aucun bot du dialogue admin", code: "no_bot" };
    let files: BotFileApi | null = null;
    const assetIds: string[] = [];
    for (const m of media) {
      try {
        // 1. Déjà repris : même asset, aucun téléchargement.
        const known = await deps.prisma.mediaAssetTelegramFile.findFirst({
          where: { botId: bot.id, telegramFileId: m.fileId },
          select: { assetId: true },
        });
        if (known) {
          assetIds.push(known.assetId);
          continue;
        }
        // 2. Téléchargement par le bot qui a reçu le message.
        files ??= await botFiles(bot);
        const file = await files.getFile(m.fileId);
        if (typeof file.file_size === "number" && file.file_size > BOSS_MEDIA_MAX_BYTES) throw new TooBig("fichier trop lourd");
        if (!file.file_path) throw new Error("Telegram n'a pas donné le chemin du fichier");
        const bytes = await download(`https://api.telegram.org/file/bot${files.token}/${file.file_path}`, BOSS_MEDIA_MAX_BYTES);
        if (bytes.byteLength > BOSS_MEDIA_MAX_BYTES) throw new TooBig("fichier trop lourd");
        const { mimeType, ext } = forwardedMimeOf(m.kind, file.file_path);
        // 3. Rangement (dédoublonné par empreinte).
        const stored = await storeForwardedMedia(deps, {
          bytes,
          mimeType,
          filename: `kevin-${m.kind}-${Date.now().toString(36)}-${assetIds.length + 1}.${ext}`,
          botId: bot.id,
          telegramFileId: m.fileId,
        });
        assetIds.push(stored.assetId);
      } catch (err) {
        const label = LABEL[m.kind] ?? "média";
        if (isTooBigError(err)) return { error: `${label} de plus de 20 Mo`, code: "too_big" };
        // Jamais l'adresse (elle porte le jeton) : seulement le motif.
        const reason = String((err as Error)?.message ?? "erreur").replace(/https?:\/\/\S+/g, "[adresse]").slice(0, 160);
        deps.logger?.warn({ kind: m.kind, reason }, "[boss] média du message transféré non récupéré");
        return { error: `${label} pas récupéré(e) : ${reason}`, code: "failed" };
      }
    }
    return { assetIds };
  };
}

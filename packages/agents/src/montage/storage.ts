/**
 * Phase 28, chantier D — shorts finaux gardés dans Telegram (jamais en base : ≈ 1,5 Go par semaine sinon).
 * - `storeShort` : la vidéo part par le bot de Kevin dans le canal « Médiathèque » (`Setting agents.libraryChannelId`),
 *   à défaut dans le privé de l'admin (message supprimé ensuite si le short pèse 20 Mo au plus : le bot le retrouve
 *   par son `fileId` ; au-delà le message reste, c'est par lui que le compte connecté le relit). `MediaAsset` SHORT
 *   `storage = "telegram"`, `bytes` vide, empreinte du fichier, `MediaAssetTelegramFile` du bot de Kevin,
 *   `libraryMessageId`, `telegramRef`.
 * - `resolveAssetBytes` : octets d'un média pour un AUTRE bot (le `fileId` de Kevin ne vaut que pour Kevin) : colonne
 *   `bytes` pour un média en base (`storage = "db"`, rien ne change), sinon téléchargement depuis Telegram (bot de
 *   Kevin ≤ 20 Mo, compte connecté au-delà).
 */
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { agentEvent, readSetting } from "../admin/journal";
import { LIBRARY_CHANNEL_KEY } from "../library/store";
import { MONTAGE_LIMITS, MONTAGE_TEAM_KEY, type MediaProbe } from "./contract";
import {
  parseTelegramRef,
  sha256File,
  workDirOf,
  type MontageJobRow,
  type MontagePipelineDeps,
  type ShortClipRow,
  type StoredShort,
  type TelegramRef,
} from "./runtime";

const FORMAT_LABEL: Record<string, string> = { VERTICAL_9_16: "vertical 9:16", HORIZONTAL_16_9: "horizontal 16:9", SQUARE_1_1: "carré 1:1" };

function settingId(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return v.trim();
  return null;
}

/** Bot de Kevin : injecté par le worker (`adminBot()`), sinon le Boss actif le plus récent. */
async function kevinBotId(deps: MontagePipelineDeps): Promise<string | null> {
  if (deps.montage?.kevinBotId) return deps.montage.kevinBotId();
  const bot = await deps.prisma.bot
    .findFirst({ where: { role: "ADMIN", isActive: true }, orderBy: { createdAt: "desc" }, select: { id: true } })
    .catch(() => null);
  return bot?.id ?? null;
}

function themeOf(job: MontageJobRow): string | null {
  const t = (job.instructions as { theme?: unknown } | null)?.theme;
  return typeof t === "string" && t.trim() ? t.trim().toLowerCase() : null;
}

export type StoreShortInput = {
  path: string;
  clip: ShortClipRow;
  probe: MediaProbe;
  job: MontageJobRow;
  compressed?: boolean;
};

export async function storeShort(deps: MontagePipelineDeps, input: StoreShortInput): Promise<StoredShort> {
  const { path, clip, probe, job } = input;
  const compressed = input.compressed ?? clip.compressed;
  const sizeBytes = (await stat(path)).size;
  if (sizeBytes > MONTAGE_LIMITS.telegramVideoMaxBytes) throw new Error(`short de ${Math.round(sizeBytes / 1024 / 1024)} Mo : plus de 50 Mo, Telegram le refuserait`);
  const sha256 = await sha256File(path);
  const botId = await kevinBotId(deps);
  const durationMs = probe.durationMs;

  // Déjà rangé (reprise après un plantage entre l'envoi et l'écriture du short) : même asset, rien n'est renvoyé.
  const existing = await deps.prisma.mediaAsset.findUnique({
    where: { sha256 },
    select: { id: true, telegramRef: true, libraryMessageId: true },
  });
  const existingRef = existing ? parseTelegramRef(existing.telegramRef) : null;
  if (existing && existingRef?.fileId) {
    // Version du short comprise : un short refait pendant l'envoi ne reçoit jamais l'ancien rendu.
    await deps.prisma.shortClip.updateMany({ where: { id: clip.id, redoCount: clip.redoCount ?? 0 }, data: { assetId: existing.id } });
    return {
      assetId: existing.id,
      created: false,
      fileId: existingRef.fileId,
      fileUniqueId: existingRef.fileUniqueId ?? existingRef.fileId,
      messageId: existingRef.messageId,
      chatId: existingRef.chatId,
      sizeBytes,
      durationMs,
      width: probe.width,
      height: probe.height,
      compressed,
    };
  }

  if (!deps.sendVideo) throw new Error("envoi de vidéo par le bot de Kevin non branché (worker)");
  const libraryId = settingId(await readSetting(deps, LIBRARY_CHANNEL_KEY));
  const adminId = settingId(await readSetting(deps, "admin.telegramUserId"));
  const chatId = libraryId ?? adminId;
  if (!chatId) throw new Error("ni canal « Médiathèque » ni identifiant de l'admin : impossible de garder le short dans Telegram");
  const via: TelegramRef["via"] = libraryId ? "library" : "admin";
  const seconds = Math.round(durationMs / 100) / 10;
  const caption = `Montage · short ${clip.index} · ${String(seconds).replace(".", ",")} s · ${FORMAT_LABEL[clip.format] ?? clip.format}${compressed ? " · compressé" : ""}`;
  const sent = await deps.sendVideo({ chatId, path, caption });

  const ref: TelegramRef = { chatId, messageId: sent.messageId, botId, fileId: sent.fileId, fileUniqueId: sent.fileUniqueId, via, sizeBytes };
  const theme = themeOf(job);
  const data = {
    filename: `short-${job.id.slice(-8)}-${clip.index}${clip.redoCount ? `-v${clip.redoCount + 1}` : ""}.mp4`,
    mimeType: "video/mp4",
    size: sizeBytes,
    bytes: Buffer.alloc(0),
    width: probe.width,
    height: probe.height,
    duration: Math.round(durationMs / 1000),
    createdById: job.createdById ?? null,
    teamKey: MONTAGE_TEAM_KEY,
    theme,
    kind: "SHORT" as const,
    origin: "HUMAN" as const,
    tags: ["montage", "short", ...(theme ? [`theme:${theme}`] : [])],
    sourceAssetId: job.sourceAssetId,
    resolution: `${probe.width}x${probe.height}`,
    libraryMessageId: via === "library" ? sent.messageId : null,
    storage: "telegram",
    telegramRef: ref,
  };
  const asset = existing
    ? await deps.prisma.mediaAsset.update({ where: { id: existing.id }, data, select: { id: true } })
    : await deps.prisma.mediaAsset.create({ data: { ...data, sha256 }, select: { id: true } });
  if (botId)
    await deps.prisma.mediaAssetTelegramFile.upsert({
      where: { assetId_botId: { assetId: asset.id, botId } },
      create: { assetId: asset.id, botId, telegramFileId: sent.fileId, fileUniqueId: sent.fileUniqueId },
      update: { telegramFileId: sent.fileId, fileUniqueId: sent.fileUniqueId },
    });
  await deps.prisma.shortClip.updateMany({ where: { id: clip.id, redoCount: clip.redoCount ?? 0 }, data: { assetId: asset.id } });

  // Privé de l'admin (pas de canal « Médiathèque ») : le message ne sert plus si le bot peut relire le fichier.
  if (via === "admin" && sizeBytes <= MONTAGE_LIMITS.botDownloadMaxBytes && deps.admin?.deleteMessage) {
    await deps.admin.deleteMessage(sent.messageId).catch((err: unknown) =>
      deps.logger?.warn({ err: (err as Error)?.message, assetId: asset.id }, "[montage] suppression du message de rangement impossible"),
    );
  }
  await agentEvent(deps, "agents.montage.short_stored", { jobId: job.id, clipId: clip.id, assetId: asset.id, sizeBytes, via, compressed });
  return {
    assetId: asset.id,
    created: !existing,
    fileId: sent.fileId,
    fileUniqueId: sent.fileUniqueId,
    messageId: sent.messageId,
    chatId,
    sizeBytes,
    durationMs,
    width: probe.width,
    height: probe.height,
    compressed,
  };
}

/** Champs d'un `MediaAsset` lus par `resolveAssetBytes` (les autres sont ignorés). */
export type ResolvableAsset = {
  id: string;
  storage?: string | null;
  bytes?: Uint8Array | null;
  telegramRef?: unknown;
  size?: number | null;
};

/**
 * Octets d'un média (ligne déjà lue, ou son identifiant), quel que soit l'endroit où il vit. `storage = "db"` (ou
 * absent) : la colonne `bytes` (relue si la ligne a été lue sans elle). `storage = "telegram"` : téléchargé dans un fichier temporaire puis lu et effacé.
 */
export async function resolveAssetBytes(deps: MontagePipelineDeps, input: ResolvableAsset | string): Promise<Uint8Array> {
  const asset: ResolvableAsset | null =
    typeof input === "string"
      ? await deps.prisma.mediaAsset.findUnique({ where: { id: input }, select: { id: true, storage: true, telegramRef: true, size: true } })
      : input;
  if (!asset) throw new Error("média introuvable");
  if (asset.storage !== "telegram") {
    if (asset.bytes && asset.bytes.byteLength > 0) return new Uint8Array(asset.bytes);
    const row = await deps.prisma.mediaAsset.findUnique({ where: { id: asset.id }, select: { bytes: true } });
    if (!row) throw new Error("média introuvable");
    return new Uint8Array(row.bytes);
  }
  const ref = parseTelegramRef(asset.telegramRef);
  if (!ref) throw new Error("média gardé dans Telegram sans référence");
  if (!deps.downloadTelegramFile) throw new Error("téléchargement Telegram non branché");
  const dir = join(workDirOf(deps), "_resolve");
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `${randomUUID()}.bin`);
  try {
    await deps.downloadTelegramFile(
      { chatId: ref.chatId, messageId: ref.messageId, fileId: ref.fileId ?? null, sizeBytes: ref.sizeBytes ?? asset.size ?? null },
      tmp,
    );
    return new Uint8Array(await readFile(tmp));
  } finally {
    await rm(tmp, { force: true }).catch(() => undefined);
    await rm(`${tmp}.part`, { force: true }).catch(() => undefined);
  }
}

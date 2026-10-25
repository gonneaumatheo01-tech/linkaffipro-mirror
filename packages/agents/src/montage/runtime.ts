/**
 * Phase 28, chantier D — dépendances de la chaîne de montage (au-dessus de `MontageDeps` du contrat), dossiers de
 * travail et petites règles partagées par `source.ts`, `storage.ts`, `pipeline.ts`, `cleanup.ts`.
 *
 * Dossier de travail d'un montage (disque temporaire du worker, jamais en base) :
 *   <workDir>/<jobId>/source.<ext>            copie de travail de la vidéo longue (gardée tant que le travail vit)
 *   <workDir>/<jobId>/frames/                 images de l'analyse (effacées après le plan)
 *   <workDir>/<jobId>/clips/<clipId>/         son, SRT, rendu, rendu compressé, images du contrôle (effacés après le short)
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import type { MediaAsset, MontageJob, ShortClip } from "@linkaffipro/db";
import {
  MONTAGE_LIMITS,
  type MediaProbe,
  type MontageDeps,
  type MontageInstructions,
  type MontageQueueJob,
  type PlannedClip,
  type QcReport,
  type ShortRenderSpec,
  type SubtitleSegment,
  type UncertainSegment,
} from "./contract";

export type MontageJobRow = MontageJob;
export type ShortClipRow = ShortClip;
export type MediaAssetRow = MediaAsset;

/** Référence Telegram d'un média gardé dans Telegram (`MediaAsset.telegramRef`). */
export type TelegramRef = {
  /** Conversation (chaîne d'un BigInt : identifiant de l'admin en privé, d'un groupe ou du canal « Médiathèque »). */
  chatId: string;
  messageId: number;
  /** Bot qui a reçu ou envoyé le fichier (bot de Kevin) ; son `fileId` ne vaut que pour lui. */
  botId?: string | null;
  fileId?: string | null;
  fileUniqueId?: string | null;
  /** D'où vient la copie : vidéo reçue par Kevin, canal « Médiathèque », privé de l'admin. */
  via: "kevin" | "library" | "admin";
  sizeBytes?: number | null;
};

export function parseTelegramRef(v: unknown): TelegramRef | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const chatId = typeof r.chatId === "string" || typeof r.chatId === "number" ? String(r.chatId) : null;
  const messageId = typeof r.messageId === "number" ? r.messageId : Number(r.messageId);
  if (!chatId || !Number.isInteger(messageId) || messageId <= 0) return null;
  const via = r.via === "library" || r.via === "admin" ? r.via : "kevin";
  return {
    chatId,
    messageId,
    botId: typeof r.botId === "string" ? r.botId : null,
    fileId: typeof r.fileId === "string" ? r.fileId : null,
    fileUniqueId: typeof r.fileUniqueId === "string" ? r.fileUniqueId : null,
    via,
    sizeBytes: typeof r.sizeBytes === "number" ? r.sizeBytes : null,
  };
}

/** Image extraite d'une vidéo (analyse ou contrôle), avec son instant. */
export type FrameRef = { path: string; atMs: number };

/**
 * Moteur du montage : ffmpeg (chantier B) et IA (chantier C) derrière une seule interface, pour que la chaîne se teste
 * avec un faux moteur. La réalisation par défaut est `createMontageEngine` (`engine.ts`).
 */
export type MontageEngine = {
  probeMedia(path: string): Promise<MediaProbe>;
  /** Une image toutes les `everySec` secondes, `width` px de large, dans `dir`. */
  extractFrames(input: { source: string; dir: string; everySec: number; width: number; durationMs: number }): Promise<FrameRef[]>;
  planCuts(input: { frames: FrameRef[]; probe: MediaProbe; instructions: MontageInstructions; maxShorts: number }): Promise<PlannedClip[]>;
  /** Son d'un passage de la SOURCE (WAV 16 kHz mono). */
  extractAudioSegment(input: { source: string; startMs: number; endMs: number; output: string }): Promise<void>;
  /**
   * Transcription horodatée depuis le début du passage (vitesse normale). `independent` : deuxième écoute, SANS biais
   * de vocabulaire et à une autre température (sinon les deux écoutes sont identiques et la comparaison ne prouve rien).
   */
  transcribeClip(input: { wavPath: string; durationMs: number; language: string | null; independent?: boolean }): Promise<SubtitleSegment[]>;
  /** Deux transcriptions comparées et relues : segments sûrs et passages incertains (confiance < seuil). */
  verifySubtitles(input: {
    transcripts: [SubtitleSegment[], SubtitleSegment[]];
    wavPath: string;
    threshold: number;
  }): Promise<{ segments: SubtitleSegment[]; uncertain: UncertainSegment[] }>;
  subtitlesToSrt(segments: SubtitleSegment[]): string;
  /** Réponse du client sur un passage incertain (« martingale ») appliquée au segment `index`. */
  applyClientCorrection(segments: SubtitleSegment[], index: number, choice: string, uncertain?: UncertainSegment | null): SubtitleSegment[];
  /** Rendu UNIQUE (coupe + caméra + format + vitesse + sous-titres + texte). */
  renderShort(spec: ShortRenderSpec, opts: { timeoutMs: number }): Promise<void>;
  qcShort(input: { path: string; expectedDurationMs: number; format: ShortRenderSpec["format"] }, opts: { timeoutMs: number }): Promise<QcReport>;
  /** Lisibilité des sous-titres sur 3 images du short (vision). */
  checkSubtitleReadability(input: { path: string; dir: string; segments: SubtitleSegment[]; durationMs: number }): Promise<{ ok: boolean; problems: string[] }>;
  /** Seconde (et dernière) passe depuis la SOURCE, CRF + `crfStep`. */
  compressShort(spec: ShortRenderSpec, crfStep: number, opts: { timeoutMs: number }): Promise<void>;
};

/** Crochets de Kevin (chantier E) : messages au client. Faux en test. */
export type MontageHooks = {
  /** Plan prêt : Kevin l'envoie ; rend l'identifiant du message (gardé dans `planMsgId`). */
  onPlanReady?(deps: MontagePipelineDeps, job: MontageJobRow, clips: ShortClipRow[]): Promise<{ messageId?: number | null } | void>;
  /** Passages de sous-titre incertains : Kevin pose la question ; le short attend `resolveSubtitleDoubt`. */
  onSubtitleDoubt?(deps: MontagePipelineDeps, job: MontageJobRow, clip: ShortClipRow, uncertain: UncertainSegment[]): Promise<void>;
  onQcFailed?(deps: MontagePipelineDeps, job: MontageJobRow, clip: ShortClipRow, report: QcReport): Promise<void>;
  /** Short rangé : Kevin envoie l'aperçu (vidéo par `fileId` du bot de Kevin + boutons) ; rend l'identifiant du message. */
  onPreviewReady?(deps: MontagePipelineDeps, job: MontageJobRow, clip: ShortClipRow, short: StoredShort): Promise<{ messageId?: number | null } | void>;
  /** Échec définitif (3 essais, vidéo refusée ou illisible) : phrase simple au client. `clip` absent = tout le montage. */
  onFailed?(deps: MontagePipelineDeps, job: MontageJobRow, reason: string, clip?: ShortClipRow | null): Promise<void>;
};

/** Short rangé dans Telegram (résultat de `storeShort`). */
export type StoredShort = {
  assetId: string;
  created: boolean;
  fileId: string;
  fileUniqueId: string;
  messageId: number;
  chatId: string;
  sizeBytes: number;
  durationMs: number;
  width: number;
  height: number;
  compressed: boolean;
};

export type MontageRuntime = {
  engine?: MontageEngine;
  hooks?: MontageHooks;
  /** Mise en file `agents-montage` (worker / site : BullMQ, idempotente par `jobId` ; tests : fausse). */
  enqueue?: (job: MontageQueueJob, opts?: { jobId?: string; delayMs?: number }) => Promise<void>;
  /** Dossier de travail (par défaut `MONTAGE_LIMITS.workDir`). */
  workDir?: string;
  /** Bot de Kevin (bot du dialogue admin) : son identifiant pour `MediaAssetTelegramFile`. */
  kevinBotId?: () => Promise<string | null>;
  /** Police du texte incrusté (fichier .ttf de l'image du worker). */
  fontFile?: string | null;
};

export type MontagePipelineDeps = MontageDeps & { montage?: MontageRuntime };

export function workDirOf(deps: MontagePipelineDeps): string {
  return deps.montage?.workDir ?? MONTAGE_LIMITS.workDir;
}

export function jobDir(deps: MontagePipelineDeps, jobId: string): string {
  return join(workDirOf(deps), safeName(jobId));
}

export function framesDir(deps: MontagePipelineDeps, jobId: string): string {
  return join(jobDir(deps, jobId), "frames");
}

export function clipDir(deps: MontagePipelineDeps, jobId: string, clipId: string): string {
  return join(jobDir(deps, jobId), "clips", safeName(clipId));
}

/** Copie de travail de la source (extension d'après le type de fichier). */
export function sourceCopyPath(deps: MontagePipelineDeps, jobId: string, mimeType: string | null | undefined): string {
  return join(jobDir(deps, jobId), `source.${videoExtension(mimeType)}`);
}

export function videoExtension(mimeType: string | null | undefined): string {
  if (mimeType === "video/quicktime") return "mov";
  if (mimeType === "video/webm") return "webm";
  if (mimeType === "video/x-matroska") return "mkv";
  return "mp4";
}

/** Un identifiant n'entre dans un chemin que réduit à [A-Za-z0-9_-]. */
export function safeName(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "_";
}

/** Empreinte SHA-256 d'un fichier (lu en continu, jamais entier en mémoire). */
export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export function nowOf(deps: { now?: () => Date }): Date {
  return deps.now ? deps.now() : new Date();
}

/** Travail fini : la copie de travail de la source peut partir. */
export const TERMINAL_JOB_STATUSES = ["APPROVED", "DONE", "FAILED", "CANCELLED"] as const;
export function isTerminalJob(status: string): boolean {
  return (TERMINAL_JOB_STATUSES as readonly string[]).includes(status);
}

/** Short tranché ou abandonné : plus rien à fabriquer. */
export const SETTLED_CLIP_STATUSES = ["APPROVED", "REJECTED", "CANCELLED", "QC_FAILED"] as const;

/**
 * Refus définitif (vidéo trop lourde, trop longue, illisible) : jamais réessayé, message en français simple que
 * Kevin peut répéter tel quel.
 */
export class MontageRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MontageRefused";
  }
}

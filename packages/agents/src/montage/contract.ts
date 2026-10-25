/**
 * Phase 28 — contrat FIGÉ de l'équipe Montage (`docs/prompts/30-phase-28-montage-video.md`). Types, noms et limites
 * partagés par plusieurs chantiers ; ne pas les renommer.
 *
 * Décisions (voir `docs/DECISIONS-TECH.md`, phase 28) :
 * - La vidéo longue n'entre JAMAIS en base : `MediaAsset` LONG_VIDEO avec `storage = "telegram"`, `bytes` vide et
 *   `telegramRef` (conversation + message d'origine). ≤ 20 Mo : téléchargée par le bot de Kevin (API Bot) ; au-delà : par
 *   le compte Telegram connecté de l'admin (MTProto, `withMtprotoLock`), qui lit SA conversation avec Kevin (c'est le
 *   même compte que l'admin, vérifié le 25 octobre). Copie de travail sur le disque temporaire du worker
 *   (`MONTAGE_LIMITS.workDir`), retéléchargée après un redémarrage.
 * - Les shorts finaux vivent dans Telegram (canal « Médiathèque » par le bot de Kevin) : `MediaAsset` SHORT,
 *   `storage = "telegram"`, `bytes` vide, identifiant de fichier dans `MediaAssetTelegramFile` ; jamais en base (≈ 1,5 Go
 *   par semaine sinon). `resolveAssetBytes` les retrouve pour un autre bot.
 * - Un seul encodage par short : la source est lue une fois, coupe + caméra + format + vitesse + sous-titres + texte dans
 *   UN `-filter_complex` (`libx264 -crf 18 -preset slow`, `libx265` si la source est en HEVC, AAC, images/s de la
 *   source). Seule exception : un short de plus de 50 Mo est réencodé une fois (CRF + 4) depuis la source, pas depuis le
 *   short, et Kevin le dit.
 *
 * Qui fournit quoi :
 * - Chantier B, MOTEUR FFMPEG (`montage/ffmpeg/*`, fixtures `packages/agents/fixtures/montage/`, image Docker de test) :
 *   `createFfmpegRunner`, `createFakeFfmpegRunner`, `probeMedia`, `extractFrames`, `extractAudioSegment`,
 *   `buildRenderArgs`, `renderShort`, `qcShort`, `compressShort`, `pipCrop`, `formatSize`.
 * - Chantier C, IA (`montage/{analyze,subtitles,qc-vision,instructions}.ts`) : `parseMontageInstructions` (Haiku),
 *   `planCuts` (Opus vision), `transcribeClip` (STT Venice, horodatage par segment), `verifySubtitles` (Opus),
 *   `subtitlesToSrt`, `checkSubtitleReadability` (Opus vision).
 * - Chantier D, CHAÎNE ET STOCKAGE (`montage/{pipeline,storage,source,cleanup,diag}.ts`, file `agents-montage` du worker
 *   `apps/worker/src/processors/agents-montage.ts`, `pnpm montage:diag`) : `createMontageJob`, `runMontageStep`,
 *   `downloadSource`, `storeShort`, `resolveAssetBytes`, `cleanupJob`, reprise et 3 échecs → FAILED.
 * - Chantier E, KEVIN (`montage/{reception,plan-message,preview,feedback}.ts`, `boss/catalog-montage.ts`,
 *   `orders/capabilities/montage.ts`, `orders/agents-dict.ts`, réception des vidéos dans `packages/telegram`) : réception
 *   d'une vidéo + phrase, plan envoyé et ajusté (« enlève le 3 », « le 2, 2 s plus tôt »), aperçus avec boutons
 *   `msh:<clipId>:ok|edit|no`, modifications, questions sur les sous-titres incertains, bilan, « envoie les validés dans le
 *   canal Roulette ».
 * - Chantier F, SITE ET DOCS (page Agents → Montage, opérations du site pour Kevin (phase 34), médiathèque filtrée,
 *   guide, docs).
 */
import type { AgentsDeps } from "../types";

export const MONTAGE_TEAM_KEY = "montage";
export const MONTAGE_QUEUE = "agents-montage";

export type ShortFormat = "VERTICAL_9_16" | "HORIZONTAL_16_9" | "SQUARE_1_1";
export type PipPosition = "TOP_RIGHT" | "TOP_LEFT" | "BOTTOM_RIGHT" | "BOTTOM_LEFT" | "NONE";

/** Instructions du client, telles que comprises (Haiku) puis complétées par les réglages. */
export type MontageInstructions = {
  theme: string | null;
  format: ShortFormat;
  /** Durée visée d'un short, en secondes. */
  durationTarget: number;
  pipPosition: PipPosition;
  subtitles: boolean;
  overlayText: string | null;
  /** Nombre de shorts voulu (null = l'IA décide, au plus `maxShortsPerJob`). */
  count: number | null;
  /** Vitesse (1 = normale ; 0,5 à 2). */
  speed: number | null;
  rawText: string;
};

/** Réglages (`Setting`) et valeurs par défaut. */
export const MONTAGE_SETTINGS = {
  defaultFormat: { key: "montage.default_format", value: "VERTICAL_9_16" as ShortFormat },
  defaultDuration: { key: "montage.default_duration", value: 15 },
  maxShortsPerJob: { key: "montage.max_shorts_per_job", value: 20 },
  subtitleConfidence: { key: "montage.subtitle_confidence_threshold", value: 0.95 },
  crf: { key: "montage.ffmpeg_crf", value: 18 },
  preset: { key: "montage.ffmpeg_preset", value: "slow" },
  subtitleStyle: {
    key: "montage.subtitle_style",
    value: "FontName=Open Sans,FontSize=14,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2,Shadow=1,Alignment=2,MarginV=40",
  },
  /** Plafond mensuel de l'IA de l'équipe (vision, vérification des sous-titres), en centimes ; `AgentUsage` équipe montage. */
  monthlyBudgetCents: { key: "montage.monthly_budget_cents", value: 3000 },
} as const;

/** Limites (règles 3, 6, 7 ; étapes 2, 4, 7 du prompt). */
export const MONTAGE_LIMITS = {
  /** Dossier de travail (disque temporaire du worker, pas le volume /data de 4,5 Go). */
  workDir: "/tmp/montage",
  /** API Bot : téléchargement au plus 20 Mo ; au-delà, le compte connecté de l'admin. */
  botDownloadMaxBytes: 20 * 1024 * 1024,
  /** Envoi d'une vidéo par un bot : 50 Mo. Au-delà : une seule compression CRF + 4 depuis la source. */
  telegramVideoMaxBytes: 50 * 1024 * 1024,
  compressCrfStep: 4,
  /** Une image toutes les 5 s pour l'analyse, envoyées par lots de 20, réduites à 512 px de large. */
  frameEverySec: 5,
  framesPerBatch: 20,
  frameWidth: 512,
  /** Durée d'un short : 5 à 90 s ; tolérance du contrôle qualité ±2 s. */
  minShortSec: 5,
  maxShortSec: 90,
  durationToleranceMs: 2000,
  /** Contrôle qualité : au plus 0,5 s de noir ; 1080 px au moins sur le grand côté ; pas de silence complet. */
  maxBlackSec: 0.5,
  minMainDimension: 1080,
  /** Un short : 10 minutes de calcul au plus ; un travail : 3 essais (2 reprises, attente croissante). */
  shortTimeoutMs: 10 * 60_000,
  maxAttempts: 3,
  /** Source acceptée : 2 Go au plus (limite d'envoi Telegram d'un compte sans Premium), 3 h au plus. */
  maxSourceBytes: 2 * 1024 * 1024 * 1024,
  maxSourceDurationMs: 3 * 3600_000,
} as const;

/** Métadonnées d'un fichier (ffprobe). */
export type MediaProbe = {
  durationMs: number;
  width: number;
  height: number;
  videoCodec: string | null;
  audioCodec: string | null;
  fps: number | null;
  /** Fraction exacte des images/s de la source (« 30000/1001 »), gardée telle quelle. */
  fpsRaw: string | null;
  sizeBytes: number;
  hasAudio: boolean;
};

/** Exécuteur ffmpeg / ffprobe injecté (vrai binaire, image Docker de test, ou faux pour les tests). */
export type FfmpegRunner = {
  ffmpeg(args: string[], opts?: { timeoutMs?: number; cwd?: string }): Promise<{ code: number; stderr: string }>;
  ffprobe(args: string[], opts?: { timeoutMs?: number }): Promise<{ code: number; stdout: string; stderr: string }>;
};

/** Ce que le Monteur fabrique pour un short (un seul passage ffmpeg). */
export type ShortRenderSpec = {
  source: string;
  output: string;
  startMs: number;
  endMs: number;
  format: ShortFormat;
  pipPosition: PipPosition;
  speed: number | null;
  /** SRT VÉRIFIÉ (fichier) à brûler, ou null. Horodatage relatif au début du short. */
  srtPath: string | null;
  subtitleStyle: string;
  overlayText: string | null;
  /** Police pour le texte incrusté (fichier .ttf présent dans l'image). */
  fontFile: string | null;
  crf: number;
  preset: string;
  /** Codec de la source : `hevc` → libx265, sinon libx264. */
  sourceCodec: string | null;
  /** Images/s de la source (gardées). */
  fpsRaw: string | null;
};

/** Résultat du contrôle qualité automatique d'un short. */
export type QcReport = {
  ok: boolean;
  durationMs: number;
  width: number;
  height: number;
  sizeBytes: number;
  blackSec: number;
  silent: boolean;
  clipping: boolean;
  /** Raisons d'échec en français courant (« 3,2 s de noir au début »). */
  problems: string[];
};

/** Un moment proposé par l'IA (plan de coupe). */
export type PlannedClip = {
  startMs: number;
  endMs: number;
  description: string;
  score: number;
  why: string;
};

/** Un segment de sous-titre, horodaté depuis le début du short, avec sa confiance (0 à 1). */
export type SubtitleSegment = { startMs: number; endMs: number; text: string; confidence: number };

/** Passage incertain : le client tranche (« "martingale" ou "martindale" ? »). */
export type UncertainSegment = { index: number; atMs: number; text: string; alternatives: string[] };

/** Étapes reprenables d'un travail (`MontageJob.currentStep`) et d'un short. */
export type MontageStep = "download" | "probe" | "analyze" | "plan_sent" | "cut" | "dress" | "qc" | "preview" | "done";

/** Tâches de la file `agents-montage` (une à la fois : ffmpeg est lourd). */
export type MontageQueueJob =
  | { type: "montage.analyze"; montageJobId: string }
  | { type: "montage.cut"; montageJobId: string; shortClipId: string }
  | { type: "montage.dress"; montageJobId: string; shortClipId: string }
  | { type: "montage.qc"; montageJobId: string; shortClipId: string }
  | { type: "montage.preview"; montageJobId: string; shortClipId: string };

/** Boutons d'un aperçu (Valider / Modifier / Refuser). */
export const SHORT_CALLBACK_PREFIX = "msh:";
export type ShortDecision = "ok" | "edit" | "no";

/** Dépendances supplémentaires de l'équipe (injectées ; faux en test). */
export type MontageDeps = AgentsDeps & {
  ffmpeg?: FfmpegRunner;
  /** Téléchargement d'un fichier Telegram vers un chemin (bot ≤ 20 Mo, sinon compte connecté). */
  downloadTelegramFile?: (ref: { chatId: string; messageId: number; fileId?: string | null; sizeBytes?: number | null }, dest: string) => Promise<void>;
  /** Envoi d'une vidéo par le bot de Kevin : rend l'identifiant de message et de fichier. */
  sendVideo?: (req: { chatId: string; path: string; caption: string; buttons?: Array<Array<{ text: string; callbackData: string }>> }) => Promise<{ messageId: number; fileId: string; fileUniqueId: string }>;
};

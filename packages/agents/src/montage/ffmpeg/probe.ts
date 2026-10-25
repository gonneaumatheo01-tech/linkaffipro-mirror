/**
 * Phase 28, chantier B : lecture des métadonnées d'un fichier (ffprobe JSON) et extractions (images pour l'analyse,
 * son pour la transcription). Erreurs en français courant : fichier illisible, abîmé, sans image, sans son.
 */
import { mkdir, readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import type { FfmpegRunner, MediaProbe } from "../contract";
import { MONTAGE_LIMITS } from "../contract";

/** Erreur de montage lisible par le client (Kevin la répète telle quelle). */
export class MontageMediaError extends Error {
  constructor(
    message: string,
    readonly reason: "unreadable" | "no_video" | "no_audio" | "render_failed" | "invalid_spec",
    readonly detail = "",
  ) {
    super(message);
    this.name = "MontageMediaError";
  }
}

/** Dernière ligne utile de stderr (pour le journal ; jamais montrée seule au client). */
export function stderrSummary(stderr: string, maxLen = 300): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const last = lines.slice(-3).join(" | ");
  return last.length > maxLen ? `${last.slice(0, maxLen)}…` : last;
}

/** « 30000/1001 » → 29,97 ; « 0/0 » ou illisible → null. */
export function parseFps(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const m = /^(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/.exec(raw.trim());
  if (!m) return null;
  const num = Number(m[1]);
  const den = m[2] === undefined ? 1 : Number(m[2]);
  if (!(num > 0) || !(den > 0)) return null;
  return Math.round((num / den) * 1000) / 1000;
}

type ProbeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  duration?: string;
  disposition?: { attached_pic?: number };
};
type ProbeJson = { streams?: ProbeStream[]; format?: { duration?: string; size?: string } };

/** Lecture pure de la sortie JSON de ffprobe (testée à part). `name` sert aux messages. */
export function parseProbeJson(stdout: string, name: string): MediaProbe {
  let json: ProbeJson;
  try {
    json = JSON.parse(stdout) as ProbeJson;
  } catch {
    throw new MontageMediaError(`Je n'arrive pas à lire le fichier « ${name} » : il est illisible ou abîmé.`, "unreadable", "sortie ffprobe non JSON");
  }
  const streams = json.streams ?? [];
  // Une pochette (image attachée d'un fichier audio) n'est pas une vidéo.
  const video = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const audio = streams.find((s) => s.codec_type === "audio");
  if (!video || !video.width || !video.height) {
    throw new MontageMediaError(`Le fichier « ${name} » ne contient pas d'image vidéo.`, "no_video");
  }
  const durationSec = Number.parseFloat(json.format?.duration ?? video.duration ?? "");
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new MontageMediaError(`Je n'arrive pas à lire la durée de « ${name} » : le fichier est sans doute abîmé ou incomplet.`, "unreadable", "durée absente");
  }
  // r_frame_rate = cadence de base, celle que ffmpeg garde par défaut ; avg_frame_rate en secours.
  const fpsCandidates = [video.r_frame_rate, video.avg_frame_rate];
  let fpsRaw: string | null = null;
  let fps: number | null = null;
  for (const c of fpsCandidates) {
    const v = parseFps(c);
    if (v !== null && v <= 240) {
      fpsRaw = c!.trim();
      fps = v;
      break;
    }
  }
  const size = Number.parseInt(json.format?.size ?? "", 10);
  return {
    durationMs: Math.round(durationSec * 1000),
    width: video.width,
    height: video.height,
    videoCodec: video.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    fps,
    fpsRaw,
    sizeBytes: Number.isFinite(size) && size >= 0 ? size : 0,
    hasAudio: Boolean(audio),
  };
}

export async function probeMedia(runner: FfmpegRunner, path: string, opts: { timeoutMs?: number } = {}): Promise<MediaProbe> {
  const name = basename(path);
  const r = await runner.ffprobe(["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path], { timeoutMs: opts.timeoutMs });
  if (r.code !== 0) {
    const missing = /No such file or directory/i.test(r.stderr);
    throw new MontageMediaError(
      missing ? `Le fichier « ${name} » est introuvable.` : `Je n'arrive pas à lire le fichier « ${name} » : il est illisible ou abîmé.`,
      "unreadable",
      stderrSummary(r.stderr),
    );
  }
  return parseProbeJson(r.stdout, name);
}

const sec = (ms: number) => (Math.max(0, ms) / 1000).toFixed(3);

/**
 * Une image JPEG toutes les `everySec` secondes (image n°i ≈ i × everySec), réduite à `width` px de large, dans
 * `outDir` (`frame-00001.jpg`, …). Rend les chemins dans l'ordre. Les anciennes images du dossier sont effacées avant.
 */
export async function extractFrames(
  runner: FfmpegRunner,
  src: string,
  opts: { everySec?: number; width?: number; outDir: string; timeoutMs?: number },
): Promise<string[]> {
  const everySec = opts.everySec ?? MONTAGE_LIMITS.frameEverySec;
  const width = opts.width ?? MONTAGE_LIMITS.frameWidth;
  if (!(everySec > 0)) throw new MontageMediaError("Intervalle entre deux images invalide.", "invalid_spec");
  if (!(width >= 16)) throw new MontageMediaError("Largeur d'image invalide.", "invalid_spec");
  await mkdir(opts.outDir, { recursive: true });
  for (const f of await readdir(opts.outDir)) if (/^frame-\d+\.jpg$/.test(f)) await rm(join(opts.outDir, f), { force: true });
  const even = Math.max(2, Math.round(width / 2) * 2);
  const args = [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    "-i", src,
    "-map", "0:v:0",
    "-vf", `fps=1/${everySec},scale=${even}:-2`,
    "-q:v", "4",
    join(opts.outDir, "frame-%05d.jpg"),
  ];
  // Vidéo d'une heure : décodage complet ; 30 min au plus par défaut.
  const r = await runner.ffmpeg(args, { timeoutMs: opts.timeoutMs ?? 30 * 60_000 });
  if (r.code !== 0) {
    throw new MontageMediaError(`Je n'arrive pas à extraire les images de « ${basename(src)} » : la vidéo est illisible ou abîmée.`, "unreadable", stderrSummary(r.stderr));
  }
  const files = (await readdir(opts.outDir)).filter((f) => /^frame-\d+\.jpg$/.test(f)).sort();
  return files.map((f) => join(opts.outDir, f));
}

/**
 * Son d'un passage, lu DIRECTEMENT dans la source (pas dans un short) : WAV PCM 16 bits, mono, 16 kHz (transcription).
 */
export async function extractAudioSegment(
  runner: FfmpegRunner,
  src: string,
  startMs: number,
  endMs: number,
  wav: string,
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  if (!(endMs > startMs) || startMs < 0) throw new MontageMediaError("Passage invalide : la fin doit venir après le début.", "invalid_spec");
  const args = [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    "-ss", sec(startMs), "-t", sec(endMs - startMs),
    "-i", src,
    "-map", "0:a:0", "-vn",
    "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
    "-f", "wav", wav,
  ];
  const r = await runner.ffmpeg(args, { timeoutMs: opts.timeoutMs ?? 5 * 60_000 });
  if (r.code !== 0) {
    if (/matches no streams|does not contain any stream/i.test(r.stderr)) {
      throw new MontageMediaError(`La vidéo « ${basename(src)} » n'a pas de son : pas de sous-titres possibles.`, "no_audio", stderrSummary(r.stderr));
    }
    throw new MontageMediaError(`Je n'arrive pas à extraire le son de « ${basename(src)} ».`, "unreadable", stderrSummary(r.stderr));
  }
  return wav;
}

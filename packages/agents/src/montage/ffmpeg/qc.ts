/**
 * Phase 28, chantier B : contrôle qualité automatique d'un short, sans IA (ffprobe + un passage ffmpeg d'analyse) :
 * durée ± 2 s, format attendu et 1080 px au moins sur le grand côté, image noire (`blackdetect`, plus de 0,5 s →
 * problème), son muet (`silencedetect` + `volumedetect`), son saturé (`volumedetect`), poids pour Telegram.
 * La lisibilité des sous-titres se juge sur image (chantier C, `checkSubtitleReadability`), pas ici.
 * Raisons en français courant, prêtes à être dites par Kevin.
 */
import type { FfmpegRunner, QcReport, ShortFormat } from "../contract";
import { MONTAGE_LIMITS } from "../contract";
import { MontageMediaError, probeMedia, stderrSummary } from "./probe";
import { formatSize } from "./render";

/** Seuils du passage d'analyse. */
export const QC_THRESHOLDS = {
  /** Pixel « noir » sous 10 % de luminance ; image noire si 98 % de ses pixels le sont ; segments de 0,1 s et plus. */
  blackPixel: 0.1,
  blackPicture: 0.98,
  blackMinSec: 0.1,
  /** Silence : sous -60 dB pendant au moins 0,5 s ; muet si le silence couvre 95 % du short ou si le pic reste sous -60 dB. */
  silenceDb: -60,
  silenceMinSec: 0.5,
  silentCoverage: 0.95,
  /** Saturation : pic à 0 dB et au moins 1 échantillon sur 1 000 au plafond. */
  clippingMaxDb: -0.1,
  clippingRatio: 0.001,
} as const;

export type BlackSegment = { startSec: number; endSec: number; durationSec: number };
export type SilenceSegment = { startSec: number; endSec: number | null };
export type VolumeStats = { meanDb: number | null; maxDb: number | null; samples: number | null; atZeroDb: number | null };

const n = (s: string | undefined) => (s === undefined ? NaN : Number.parseFloat(s));

/** Segments noirs lus dans stderr (`black_start:2 black_end:3 black_duration:1`). */
export function parseBlackDetect(stderr: string): BlackSegment[] {
  const out: BlackSegment[] = [];
  for (const m of stderr.matchAll(/black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)\s+black_duration:\s*([\d.]+)/g)) {
    const s = n(m[1]);
    const e = n(m[2]);
    const d = n(m[3]);
    if ([s, e, d].every(Number.isFinite)) out.push({ startSec: s, endSec: e, durationSec: d });
  }
  return out;
}

/** Silences lus dans stderr (`silence_start: 0` … `silence_end: 5 | silence_duration: 5`) ; fin absente = jusqu'au bout. */
export function parseSilenceDetect(stderr: string): SilenceSegment[] {
  const out: SilenceSegment[] = [];
  for (const m of stderr.matchAll(/silence_(start|end):\s*(-?[\d.]+)/g)) {
    const v = Math.max(0, n(m[2]));
    if (!Number.isFinite(v)) continue;
    if (m[1] === "start") out.push({ startSec: v, endSec: null });
    else {
      const open = out.findLast((s) => s.endSec === null);
      if (open) open.endSec = v;
      else out.push({ startSec: 0, endSec: v });
    }
  }
  return out;
}

/** Résumé de `volumedetect`. */
export function parseVolumeDetect(stderr: string): VolumeStats {
  const get = (re: RegExp) => {
    const m = re.exec(stderr);
    if (!m) return null;
    return m[1] === "-inf" ? -Infinity : n(m[1]);
  };
  return {
    meanDb: get(/mean_volume:\s*(-?[\d.]+|-inf)\s*dB/),
    maxDb: get(/max_volume:\s*(-?[\d.]+|-inf)\s*dB/),
    samples: get(/n_samples:\s*(\d+)/),
    atZeroDb: get(/histogram_0db:\s*(\d+)/),
  };
}

/** Nombre en français : 1 décimale au plus (« 3,2 », « 15 »). */
export function frNumber(x: number): string {
  const r = Math.round(x * 10) / 10;
  return (Number.isInteger(r) ? String(r) : r.toFixed(1)).replace(".", ",");
}

function where(seg: BlackSegment, durationSec: number): string {
  if (seg.startSec <= 0.1) return "au début";
  if (seg.endSec >= durationSec - 0.1) return "à la fin";
  return `vers ${frNumber(seg.startSec)} s`;
}

export type QcOptions = {
  durationTargetMs: number;
  format: ShortFormat;
  /** Sous-titres demandés (leur lisibilité est contrôlée sur image par le chantier C). */
  subtitles: boolean;
  /** Poids maximal (défaut : 50 Mo, envoi Telegram par un bot). */
  maxBytes?: number;
  timeoutMs?: number;
};

/** Les arguments du passage d'analyse (pur). */
export function buildQcArgs(path: string, hasAudio: boolean): string[] {
  const t = QC_THRESHOLDS;
  const args = [
    "-nostdin", "-hide_banner", "-nostats", "-loglevel", "info",
    "-i", path,
    "-map", "0:v:0",
    "-vf", `blackdetect=d=${t.blackMinSec}:pic_th=${t.blackPicture}:pix_th=${t.blackPixel}`,
  ];
  if (hasAudio) args.push("-map", "0:a:0", "-af", `silencedetect=n=${t.silenceDb}dB:d=${t.silenceMinSec},volumedetect`);
  args.push("-f", "null", "-");
  return args;
}

export async function qcShort(runner: FfmpegRunner, path: string, opts: QcOptions): Promise<QcReport> {
  const probe = await probeMedia(runner, path);
  const problems: string[] = [];
  const durationSec = probe.durationMs / 1000;

  const diff = Math.abs(probe.durationMs - opts.durationTargetMs);
  if (diff > MONTAGE_LIMITS.durationToleranceMs) {
    problems.push(
      `Le short dure ${frNumber(durationSec)} s au lieu de ${frNumber(opts.durationTargetMs / 1000)} s (écart permis : ${frNumber(MONTAGE_LIMITS.durationToleranceMs / 1000)} s).`,
    );
  }
  const expected = formatSize(opts.format);
  const main = Math.max(probe.width, probe.height);
  if (main < MONTAGE_LIMITS.minMainDimension) {
    problems.push(`Image trop petite : ${main} px sur le grand côté, il en faut au moins ${MONTAGE_LIMITS.minMainDimension}.`);
  }
  if (probe.width !== expected.width || probe.height !== expected.height) {
    problems.push(`Image de ${probe.width}x${probe.height} au lieu de ${expected.width}x${expected.height}.`);
  }

  const r = await runner.ffmpeg(buildQcArgs(path, probe.hasAudio), { timeoutMs: opts.timeoutMs ?? MONTAGE_LIMITS.shortTimeoutMs });
  if (r.code !== 0) {
    throw new MontageMediaError("Je n'arrive pas à vérifier ce short : le fichier est illisible ou abîmé.", "unreadable", stderrSummary(r.stderr));
  }
  const black = parseBlackDetect(r.stderr);
  const blackSec = Math.round(black.reduce((s, b) => s + b.durationSec, 0) * 1000) / 1000;
  if (blackSec > MONTAGE_LIMITS.maxBlackSec) {
    const longest = black.reduce((a, b) => (b.durationSec > a.durationSec ? b : a));
    const detail = black.length === 1 ? where(longest, durationSec) : `en ${black.length} fois, la plus longue ${where(longest, durationSec)}`;
    problems.push(`${frNumber(blackSec)} s d'image noire ${detail}.`);
  }

  let silent = false;
  let clipping = false;
  if (!probe.hasAudio) {
    silent = true;
    problems.push("Le short n'a pas de son.");
  } else {
    const silences = parseSilenceDetect(r.stderr);
    const silenceSec = silences.reduce((s, x) => s + Math.max(0, (x.endSec ?? durationSec) - x.startSec), 0);
    const vol = parseVolumeDetect(r.stderr);
    silent = silenceSec >= durationSec * QC_THRESHOLDS.silentCoverage || (vol.maxDb !== null && vol.maxDb <= QC_THRESHOLDS.silenceDb);
    if (silent) problems.push("Le son est muet du début à la fin.");
    clipping =
      !silent &&
      vol.maxDb !== null &&
      vol.maxDb >= QC_THRESHOLDS.clippingMaxDb &&
      vol.samples !== null &&
      vol.samples > 0 &&
      (vol.atZeroDb ?? 0) / vol.samples >= QC_THRESHOLDS.clippingRatio;
    if (clipping) problems.push("Le son sature : il est trop fort et grésille.");
  }

  const maxBytes = opts.maxBytes ?? MONTAGE_LIMITS.telegramVideoMaxBytes;
  if (probe.sizeBytes > maxBytes) {
    problems.push(`Fichier de ${frNumber(probe.sizeBytes / 1024 / 1024)} Mo : trop lourd pour Telegram (${frNumber(maxBytes / 1024 / 1024)} Mo au plus).`);
  }

  return {
    ok: problems.length === 0,
    durationMs: probe.durationMs,
    width: probe.width,
    height: probe.height,
    sizeBytes: probe.sizeBytes,
    blackSec,
    silent,
    clipping,
    problems,
  };
}

/**
 * Phase 28, chantier B : le Monteur. Un short = UN SEUL passage ffmpeg depuis la source (règle 3) :
 * coupe (`-ss` / `-t` avant `-i`) → caméra en incrustation → mise au format → sous-titres → texte → vitesse, le tout dans
 * un unique `-filter_complex`, encodé une fois (`libx264`, ou `libx265 -tag:v hvc1` si la source est en HEVC), son AAC.
 * Aucun fichier intermédiaire, jamais deux encodages à la suite ; la compression d'un short trop lourd (règle 7) refait
 * le rendu depuis la SOURCE avec un CRF plus élevé, une seule fois.
 *
 * Ordre des filtres et pourquoi :
 * - la caméra est découpée dans la source (avant la mise au format) puis posée sur l'image finale, au coin demandé ;
 * - les sous-titres sont brûlés sur l'image finale (taille lisible quel que soit le format) et AVANT le changement de
 *   vitesse : leur horodatage est celui de la source, relatif au début du short (la transcription lit le son de la
 *   source à vitesse normale, `extractAudioSegment`) ; `setpts` accélère ensuite image et sous-titres ensemble.
 *
 * Échappement : le texte du client, les chemins et le style passent par `escapeFilterValue` (deux niveaux du graphe
 * de filtres de ffmpeg : valeur d'option puis description du graphe) ; ils ne sont jamais interprétés par un shell
 * (`spawn` sans shell) et `drawtext` tourne avec `expansion=none` (aucun `%{…}` interprété).
 */
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { FfmpegRunner, MediaProbe, PipPosition, ShortFormat, ShortRenderSpec } from "../contract";
import { MONTAGE_LIMITS } from "../contract";
import { MontageMediaError, probeMedia, stderrSummary } from "./probe";

/** Taille de sortie par format (1080 px au moins sur le petit côté). */
export function formatSize(format: ShortFormat): { width: number; height: number } {
  switch (format) {
    case "VERTICAL_9_16":
      return { width: 1080, height: 1920 };
    case "HORIZONTAL_16_9":
      return { width: 1920, height: 1080 };
    case "SQUARE_1_1":
      return { width: 1080, height: 1080 };
  }
}

/** Largeur de la caméra posée sur l'image finale (paire), par format. */
export function pipWidth(format: ShortFormat): number {
  switch (format) {
    case "VERTICAL_9_16":
      return 432; // 40 % de 1080
    case "HORIZONTAL_16_9":
      return 480; // 25 % de 1920 : même taille que dans une source 1080p
    case "SQUARE_1_1":
      return 378; // 35 % de 1080
  }
}

/** Marge entre la caméra et le bord, en pixels. */
export const PIP_MARGIN_PX = 10;

export type PipPlacement = {
  position: Exclude<PipPosition, "NONE">;
  /** Filtre de découpe dans la SOURCE : le quart de largeur et de hauteur du coin nommé. */
  crop: string;
  /** Position sur l'image FINALE (même coin), marges de 10 px. */
  overlay: string;
  label: string;
};

/**
 * Caméra en incrustation. Le client se filme avec sa webcam incrustée dans un coin de son enregistrement : on découpe
 * le quart de largeur × quart de hauteur de CE coin de la source (`crop=iw/4:ih/4:x:y`) et on le replace au MÊME coin de
 * l'image finale (marges de 10 px), agrandi à `pipWidth(format)`. « Cam en haut à droite » = la caméra est filmée en haut
 * à droite et reste en haut à droite du short. `NONE` → null (pas d'incrustation).
 */
export function pipCrop(position: PipPosition): PipPlacement | null {
  const m = PIP_MARGIN_PX;
  switch (position) {
    case "NONE":
      return null;
    case "TOP_LEFT":
      return { position, crop: "crop=iw/4:ih/4:0:0", overlay: `${m}:${m}`, label: "en haut à gauche" };
    case "TOP_RIGHT":
      return { position, crop: "crop=iw/4:ih/4:iw*3/4:0", overlay: `W-w-${m}:${m}`, label: "en haut à droite" };
    case "BOTTOM_LEFT":
      return { position, crop: "crop=iw/4:ih/4:0:ih*3/4", overlay: `${m}:H-h-${m}`, label: "en bas à gauche" };
    case "BOTTOM_RIGHT":
      return { position, crop: "crop=iw/4:ih/4:iw*3/4:ih*3/4", overlay: `W-w-${m}:H-h-${m}`, label: "en bas à droite" };
  }
}

/**
 * Échappe une valeur d'option pour un graphe de filtres passé en un seul argument (`-filter_complex`), sans shell :
 * niveau 1 (valeur d'option) `\ ' :` ; niveau 2 (description du graphe) `\ ' [ ] , ;`. Règle de la documentation de
 * ffmpeg (« Notes on filtergraph escaping »). Retours chariot retirés ; les sauts de ligne restent (texte sur 2 lignes).
 */
export function escapeFilterValue(value: string): string {
  const level1 = value.replace(/\r/g, "").replace(/[\\':]/g, (c) => `\\${c}`);
  return level1.replace(/[\\'[\],;]/g, (c) => `\\${c}`);
}

/** Facteurs `atempo` (chacun entre 0,5 et 2) dont le produit vaut `speed`. */
export function atempoChain(speed: number): number[] {
  const out: number[] = [];
  let s = speed;
  while (s > 2 + 1e-9) {
    out.push(2);
    s /= 2;
  }
  while (s < 0.5 - 1e-9) {
    out.push(0.5);
    s /= 0.5;
  }
  out.push(Math.round(s * 1e6) / 1e6);
  return out;
}

/** Vitesse acceptée : 0,25 à 4 (le contrat demande 0,5 à 2 ; `atempo` en chaîne au-delà). */
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 4;
const PRESETS = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow", "placebo"];
const num = (n: number) => String(Math.round(n * 1e6) / 1e6);
const sec = (ms: number) => (ms / 1000).toFixed(3);

function isHevc(codec: string | null): boolean {
  return codec !== null && /^(hevc|h265|h\.265|hvc1|hev1)$/i.test(codec.trim());
}

function validFpsRaw(raw: string | null): string | null {
  if (!raw) return null;
  const m = /^(\d+(?:\.\d+)?)(?:\/(\d+))?$/.exec(raw.trim());
  if (!m) return null;
  const v = Number(m[1]) / (m[2] === undefined ? 1 : Number(m[2]));
  return v > 0 && v <= 240 ? raw.trim() : null;
}

function invalid(msg: string): never {
  throw new MontageMediaError(msg, "invalid_spec");
}

/** Vitesse effective (null, 1 ou presque 1 → pas de changement). */
export function effectiveSpeed(speed: number | null): number | null {
  if (speed === null || speed === undefined) return null;
  if (!Number.isFinite(speed) || speed < SPEED_MIN || speed > SPEED_MAX) invalid(`Vitesse ${speed} impossible : entre ${SPEED_MIN} et ${SPEED_MAX}.`);
  return Math.abs(speed - 1) < 1e-6 ? null : speed;
}

/** Durée attendue du short rendu (durée du passage ÷ vitesse), en ms. */
export function renderedDurationMs(spec: Pick<ShortRenderSpec, "startMs" | "endMs" | "speed">): number {
  const speed = effectiveSpeed(spec.speed) ?? 1;
  return Math.round((spec.endMs - spec.startMs) / speed);
}

/**
 * Texte que `drawtext` sait dessiner : les emojis sont retirés (drawtext n'affiche pas les emojis en couleur, il
 * dessinerait un carré vide), espaces resserrés, retours chariot retirés. Vide → pas de texte incrusté.
 */
export function drawableOverlayText(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\u{FE0F}|\u{200D}|\u{20E3}/gu, "")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l, i, all) => l || (i > 0 && i < all.length - 1))
    .join("\n")
    .trim();
}

/** Largeur moyenne d'un caractère, en fraction de la taille de police (police sans empattement, gras). */
const CHAR_WIDTH_EM = 0.58;
/** Au plus 3 lignes ; police jamais sous 32 px. */
const OVERLAY_MAX_LINES = 3;
const OVERLAY_MIN_FONT = 32;

/**
 * Texte incrusté qui tient dans 90 % de la largeur : coupé aux espaces en 3 lignes au plus, police réduite si un mot
 * (ou la dernière ligne) reste trop long. Estimation à la largeur moyenne d'un caractère (pas de mesure de police).
 */
export function fitOverlayText(text: string, width: number, baseFont: number): { lines: string[]; fontSize: number } {
  const usable = width * 0.9;
  const len = (s: string) => [...s].length;
  const maxChars = Math.max(8, Math.floor(usable / (baseFont * CHAR_WIDTH_EM)));
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let cur = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (cur && len(cur) + 1 + len(word) > maxChars) {
        lines.push(cur);
        cur = word;
      } else cur = cur ? `${cur} ${word}` : word;
    }
    if (cur) lines.push(cur);
  }
  if (lines.length > OVERLAY_MAX_LINES) {
    const head = lines.slice(0, OVERLAY_MAX_LINES - 1);
    lines.splice(0, lines.length, ...head, lines.slice(OVERLAY_MAX_LINES - 1).join(" "));
  }
  const longest = Math.max(...lines.map(len));
  const fontSize = Math.max(OVERLAY_MIN_FONT, Math.min(baseFont, Math.floor(usable / (longest * CHAR_WIDTH_EM))));
  return { lines, fontSize };
}

export type RenderArgsOptions = {
  /** La source a-t-elle du son ? (défaut : oui). Sans son : ni `atempo` ni piste audio, short muet. */
  hasAudio?: boolean;
};

/** Le graphe de filtres seul (pur), pour les tests et le diagnostic. */
export function buildFilterGraph(spec: ShortRenderSpec, opts: RenderArgsOptions = {}): { graph: string; videoLabel: string; audioLabel: string | null } {
  const { width: W, height: H } = formatSize(spec.format);
  const fmt = `scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
  const pip = pipCrop(spec.pipPosition);
  const speed = effectiveSpeed(spec.speed);
  const hasAudio = opts.hasAudio ?? true;
  const chains: string[] = [];
  let current: string;
  if (pip) {
    const camW = pipWidth(spec.format);
    chains.push(`[0:v:0]split=2[lap_bg][lap_fg]`);
    chains.push(`[lap_fg]${pip.crop},scale=${camW}:-2[lap_cam]`);
    chains.push(`[lap_bg]${fmt}[lap_base]`);
    chains.push(`[lap_base][lap_cam]overlay=${pip.overlay}:eof_action=pass[lap_pip]`);
    current = "[lap_pip]";
  } else {
    chains.push(`[0:v:0]${fmt}[lap_fmt]`);
    current = "[lap_fmt]";
  }
  const post: string[] = [];
  if (spec.srtPath) {
    post.push(`subtitles=filename=${escapeFilterValue(spec.srtPath)}:force_style=${escapeFilterValue(spec.subtitleStyle)}`);
  }
  const text = spec.overlayText ? drawableOverlayText(spec.overlayText) : "";
  if (text) {
    // Texte en haut de l'image ; sous la caméra si elle est en haut (caméra 16/9 de `pipWidth` px + marge).
    const camOnTop = pip !== null && pip.position.startsWith("TOP");
    const y = camOnTop ? PIP_MARGIN_PX + Math.round((pipWidth(spec.format) * 9) / 16) + 40 : Math.round(H * 0.06);
    const { lines, fontSize } = fitOverlayText(text, W, spec.format === "VERTICAL_9_16" ? 64 : 56);
    const font = spec.fontFile ? `fontfile=${escapeFilterValue(spec.fontFile)}` : "font=Sans";
    post.push(
      `drawtext=${font}:text=${escapeFilterValue(lines.join("\n"))}:expansion=none:fontsize=${fontSize}:fontcolor=white:borderw=3:bordercolor=black:line_spacing=8:text_align=C:x=(w-text_w)/2:y=${y}`,
    );
  }
  if (speed !== null) post.push(`setpts=PTS/${num(speed)}`);
  post.push("format=yuv420p");
  chains.push(`${current}${post.join(",")}[lap_v]`);
  let audioLabel: string | null = null;
  if (hasAudio && speed !== null) {
    chains.push(`[0:a:0]${atempoChain(speed).map((f) => `atempo=${num(f)}`).join(",")}[lap_a]`);
    audioLabel = "[lap_a]";
  }
  return { graph: chains.join(";"), videoLabel: "[lap_v]", audioLabel };
}

/**
 * Arguments complets d'un rendu (pur). Un seul `-i` (la source), un seul `-filter_complex`, une seule sortie.
 */
export function buildRenderArgs(spec: ShortRenderSpec, opts: RenderArgsOptions = {}): string[] {
  if (!spec.source || !spec.output) invalid("Source ou fichier de sortie manquant.");
  if (spec.source.startsWith("-") || spec.output.startsWith("-")) invalid("Chemin de fichier invalide.");
  if (spec.source === spec.output) invalid("Le short ne peut pas remplacer la source.");
  if (!Number.isFinite(spec.startMs) || !Number.isFinite(spec.endMs) || spec.startMs < 0) invalid("Début du passage invalide.");
  if (spec.endMs <= spec.startMs) invalid("Passage invalide : la fin doit venir après le début.");
  if (!Number.isInteger(spec.crf) || spec.crf < 0 || spec.crf > 51) invalid(`Qualité (CRF) ${spec.crf} impossible : 0 à 51.`);
  if (!PRESETS.includes(spec.preset)) invalid(`Réglage d'encodage « ${spec.preset} » inconnu.`);
  const hasAudio = opts.hasAudio ?? true;
  const { graph, videoLabel, audioLabel } = buildFilterGraph(spec, opts);
  const speed = effectiveSpeed(spec.speed);
  const hevc = isHevc(spec.sourceCodec);
  const fps = validFpsRaw(spec.fpsRaw);
  const args: string[] = [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    "-ss", sec(spec.startMs),
    "-t", sec(spec.endMs - spec.startMs),
    "-i", spec.source,
    "-filter_complex", graph,
    "-map", videoLabel,
  ];
  if (hasAudio) args.push("-map", audioLabel ?? "0:a:0");
  else args.push("-an");
  args.push("-c:v", hevc ? "libx265" : "libx264", "-crf", String(spec.crf), "-preset", spec.preset, "-pix_fmt", "yuv420p");
  if (hevc) args.push("-tag:v", "hvc1", "-x265-params", "log-level=error");
  // Images/s de la source : à vitesse normale les images de la source passent telles quelles ; vitesse changée →
  // cadence de la source imposée (sinon ×2 de vitesse = ×2 d'images par seconde).
  if (speed !== null && fps) args.push("-r", fps);
  else args.push("-fps_mode", "passthrough");
  if (hasAudio) args.push("-c:a", "aac", "-b:a", "160k");
  args.push("-avoid_negative_ts", "make_zero", "-movflags", "+faststart", spec.output);
  return args;
}

export type RenderOptions = {
  timeoutMs?: number;
  /** Connu par l'appelant ? Sinon la source est relue par ffprobe (qui vérifie aussi qu'elle est lisible). */
  hasAudio?: boolean;
};

/** Rend un short (un passage ffmpeg) et rend les métadonnées de la sortie. Sortie partielle effacée en cas d'échec. */
export async function renderShort(runner: FfmpegRunner, spec: ShortRenderSpec, opts: RenderOptions = {}): Promise<MediaProbe> {
  let hasAudio = opts.hasAudio;
  if (hasAudio === undefined) {
    const src = await probeMedia(runner, spec.source);
    if (spec.startMs >= src.durationMs) {
      invalid(`Le passage commence après la fin de la vidéo (${sec(spec.startMs)} s pour ${sec(src.durationMs)} s).`);
    }
    hasAudio = src.hasAudio;
  }
  const args = buildRenderArgs(spec, { hasAudio });
  await mkdir(dirname(spec.output), { recursive: true });
  let r: { code: number; stderr: string };
  try {
    r = await runner.ffmpeg(args, { timeoutMs: opts.timeoutMs ?? MONTAGE_LIMITS.shortTimeoutMs });
  } catch (err) {
    await rm(spec.output, { force: true }).catch(() => undefined);
    throw err;
  }
  if (r.code !== 0) {
    await rm(spec.output, { force: true }).catch(() => undefined);
    throw new MontageMediaError("Le montage de ce short a échoué.", "render_failed", stderrSummary(r.stderr));
  }
  return probeMedia(runner, spec.output);
}

export type CompressResult = {
  probe: MediaProbe;
  /** Faux : le short tenait déjà sous la limite, rien n'a été refait. */
  compressed: boolean;
  crf: number;
  /** Encore trop lourd après l'unique compression (on ne recommence pas). */
  overLimit: boolean;
};

/**
 * Short trop lourd pour Telegram (règle 7) : refait le rendu DEPUIS LA SOURCE avec `crf + compressCrfStep`, une seule
 * fois, dans un fichier à côté puis remplace le short (l'original reste intact si la compression échoue).
 */
export async function compressShort(
  runner: FfmpegRunner,
  spec: ShortRenderSpec,
  maxBytes: number = MONTAGE_LIMITS.telegramVideoMaxBytes,
  opts: RenderOptions & { current?: MediaProbe } = {},
): Promise<CompressResult> {
  const current = opts.current ?? (await probeMedia(runner, spec.output));
  if (current.sizeBytes <= maxBytes) return { probe: current, compressed: false, crf: spec.crf, overLimit: false };
  const crf = Math.min(51, spec.crf + MONTAGE_LIMITS.compressCrfStep);
  const tmpOut = spec.output.replace(/(\.[^./]+)?$/, (ext) => `.crf${crf}${ext || ".mp4"}`);
  const probe = await renderShort(runner, { ...spec, crf, output: tmpOut }, opts);
  await rename(tmpOut, spec.output);
  return { probe, compressed: true, crf, overLimit: probe.sizeBytes > maxBytes };
}

/**
 * Phase 28, chantier D — moteur réel de la chaîne : ffmpeg (chantier B, `ffmpeg/*`) et IA (chantier C) derrière
 * l'interface `MontageEngine` de `runtime.ts`. Les tests de la chaîne utilisent un faux moteur ; le worker branche
 * celui-ci avec le vrai `createFfmpegRunner`.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadLlmProvider } from "../providers/llm";
import { MONTAGE_LIMITS, type FfmpegRunner, type SubtitleSegment, type UncertainSegment } from "./contract";
import { compressShort, extractAudioSegment, extractFrames, probeMedia, qcShort, renderShort } from "./ffmpeg";
import type { MontageAiDeps } from "./ai";
import { planCuts } from "./analyze";
import { checkSubtitleReadability } from "./qc-vision";
import { applyClientCorrection, subtitlesToSrt, transcribeClip, verifySubtitles } from "./subtitles";
import type { MontageEngine, MontagePipelineDeps } from "./runtime";

/** Instants des 3 images du contrôle de lisibilité : au milieu de 3 sous-titres répartis (pur). */
export function readabilityTimes(segments: SubtitleSegment[], durationMs: number): number[] {
  const usable = segments.filter((s) => s.endMs > s.startMs && s.startMs < durationMs);
  if (usable.length === 0) return [0.25, 0.5, 0.75].map((f) => Math.round(durationMs * f));
  const picks = usable.length <= 3 ? usable : [usable[0]!, usable[Math.floor(usable.length / 2)]!, usable[usable.length - 1]!];
  return picks.map((s) => Math.round((s.startMs + Math.min(s.endMs, durationMs)) / 2));
}

/** Image d'un instant précis d'une vidéo (JPEG). */
async function frameAt(runner: FfmpegRunner, path: string, atMs: number, out: string): Promise<boolean> {
  const r = await runner.ffmpeg(
    ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-ss", (atMs / 1000).toFixed(3), "-i", path, "-frames:v", "1", "-q:v", "3", out],
    { timeoutMs: 60_000 },
  );
  return r.code === 0;
}

export function createMontageEngine(opts: { runner: FfmpegRunner; deps: MontagePipelineDeps; ai?: Partial<MontageAiDeps> }): MontageEngine {
  const { runner } = opts;
  let aiDeps: MontageAiDeps | null = null;
  const ai = async (): Promise<MontageAiDeps> => {
    if (aiDeps) return aiDeps;
    const llm = opts.ai?.llm !== undefined ? opts.ai.llm : await loadLlmProvider(opts.deps.prisma).catch(() => null);
    aiDeps = { ...opts.deps, ...opts.ai, llm } as MontageAiDeps;
    return aiDeps;
  };
  return {
    probeMedia: (path) => probeMedia(runner, path),
    async extractFrames(input) {
      const paths = await extractFrames(runner, input.source, { everySec: input.everySec, width: input.width, outDir: input.dir });
      return paths.map((path, i) => ({ path, atMs: i * input.everySec * 1000 }));
    },
    async planCuts(input) {
      return planCuts(await ai(), {
        framePaths: input.frames.map((f) => f.path),
        everySec: MONTAGE_LIMITS.frameEverySec,
        durationMs: input.probe.durationMs,
        instructions: input.instructions,
        maxShorts: input.maxShorts,
      });
    },
    async extractAudioSegment(input) {
      await extractAudioSegment(runner, input.source, input.startMs, input.endMs, input.output);
    },
    async transcribeClip(input) {
      return transcribeClip(await ai(), input.wavPath, { language: input.language ?? "fr", durationMs: input.durationMs });
    },
    async verifySubtitles(input) {
      const [first, second] = input.transcripts;
      return verifySubtitles(await ai(), { segments: first, secondPass: second, threshold: input.threshold, wavPath: input.wavPath });
    },
    subtitlesToSrt: (segments) => subtitlesToSrt(segments),
    applyClientCorrection: (segments, index, choice, uncertain) => applyClientCorrection(segments, index, choice, uncertain ?? null),
    async renderShort(spec, o) {
      await renderShort(runner, spec, { timeoutMs: o.timeoutMs });
    },
    qcShort: (input, o) =>
      // Le poids n'est pas jugé ici : au-delà de 50 Mo la chaîne compresse une fois depuis la source.
      qcShort(runner, input.path, { durationTargetMs: input.expectedDurationMs, format: input.format, subtitles: false, maxBytes: Number.MAX_SAFE_INTEGER, timeoutMs: o.timeoutMs }),
    async checkSubtitleReadability(input) {
      await mkdir(input.dir, { recursive: true });
      const paths: string[] = [];
      for (const [i, t] of readabilityTimes(input.segments, input.durationMs).entries()) {
        const out = join(input.dir, `lisibilite-${i + 1}.jpg`);
        if (await frameAt(runner, input.path, t, out)) paths.push(out);
      }
      if (paths.length === 0) return { ok: false, problems: ["images du short impossibles à extraire pour contrôler les sous-titres"] };
      return checkSubtitleReadability(await ai(), paths);
    },
    async compressShort(spec, _crfStep, o) {
      // Rendu à côté depuis la SOURCE avec CRF + 4 (une seule fois) ; `compressShort` du chantier B le fait d'office.
      // `current` : poids « au-delà de tout » pour forcer l'unique passe (la chaîne a déjà mesuré le rendu).
      const over = { durationMs: 0, width: 0, height: 0, videoCodec: null, audioCodec: null, fps: null, fpsRaw: null, sizeBytes: Number.MAX_SAFE_INTEGER, hasAudio: true };
      await compressShort(runner, spec, 0, { timeoutMs: o.timeoutMs, current: over });
    },
  };
}

export type { UncertainSegment };

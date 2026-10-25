/**
 * Phase 28, chantier B : exécuteurs ffmpeg / ffprobe (`FfmpegRunner` du contrat).
 * - `createFfmpegRunner` : vrais binaires (ou scripts Docker de test), `spawn` sans shell (aucun argument interprété),
 *   délai, processus tué au dépassement (SIGTERM puis SIGKILL 2 s après), 4 derniers Ko de stderr gardés.
 * - `createFakeFfmpegRunner` : faux exécuteur pour les tests (les autres chantiers aussi) : enregistre les arguments,
 *   rend des sorties scriptées, ne lance rien.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { FfmpegRunner, MediaProbe } from "../contract";
import { MONTAGE_LIMITS } from "../contract";

/** Taille gardée de la fin de stderr (les erreurs de ffmpeg sont à la fin). */
export const FFMPEG_STDERR_TAIL_BYTES = 4096;
const FFPROBE_DEFAULT_TIMEOUT_MS = 60_000;

/** Erreur d'exécution (binaire absent, délai dépassé), message en français courant. */
export class FfmpegRunError extends Error {
  constructor(
    message: string,
    readonly kind: "missing" | "timeout" | "spawn",
    readonly stderr = "",
  ) {
    super(message);
    this.name = "FfmpegRunError";
  }
}

/** Garde la fin d'un flux (au plus `max` octets). */
class Tail {
  private chunks: Buffer[] = [];
  private size = 0;
  constructor(private readonly max: number) {}
  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.size > this.max && this.chunks.length > 1) {
      this.size -= this.chunks.shift()!.length;
    }
    if (this.size > this.max) {
      const only = this.chunks[0]!;
      this.chunks = [only.subarray(only.length - this.max)];
      this.size = this.max;
    }
  }
  text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

type RunResult = { code: number; stdout: string; stderr: string };

function run(bin: string, args: string[], opts: { timeoutMs: number; cwd?: string; keepStdout: boolean; label: string }): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"], shell: false });
    } catch (err) {
      reject(new FfmpegRunError(`${opts.label} n'a pas pu démarrer : ${(err as Error).message}`, "spawn"));
      return;
    }
    const stderr = new Tail(FFMPEG_STDERR_TAIL_BYTES);
    const stdout: Buffer[] = [];
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 2000);
      killTimer.unref();
    }, opts.timeoutMs);
    child.stdout.on("data", (c: Buffer) => {
      if (opts.keepStdout) stdout.push(c);
    });
    child.stderr.on("data", (c: Buffer) => stderr.push(c));
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (err.code === "ENOENT") reject(new FfmpegRunError(`${opts.label} est introuvable sur cette machine (${bin}).`, "missing"));
      else reject(new FfmpegRunError(`${opts.label} n'a pas pu démarrer : ${err.message}`, "spawn"));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      const errText = stderr.text();
      if (timedOut) {
        reject(new FfmpegRunError(`${opts.label} a dépassé le temps permis (${Math.round(opts.timeoutMs / 1000)} s) et a été arrêté.`, "timeout", errText));
        return;
      }
      resolve({ code: code ?? (signal ? 128 : 1), stdout: Buffer.concat(stdout).toString("utf8"), stderr: errText });
    });
  });
}

export type FfmpegRunnerOptions = {
  ffmpegPath?: string;
  ffprobePath?: string;
  /** Délai par défaut d'un appel ffmpeg (10 min : un short). */
  defaultTimeoutMs?: number;
};

export function createFfmpegRunner(options: FfmpegRunnerOptions = {}): FfmpegRunner {
  const ffmpegPath = options.ffmpegPath ?? "ffmpeg";
  const ffprobePath = options.ffprobePath ?? "ffprobe";
  const defaultTimeoutMs = options.defaultTimeoutMs ?? MONTAGE_LIMITS.shortTimeoutMs;
  return {
    async ffmpeg(args, opts) {
      const r = await run(ffmpegPath, args, { timeoutMs: opts?.timeoutMs ?? defaultTimeoutMs, cwd: opts?.cwd, keepStdout: false, label: "ffmpeg" });
      return { code: r.code, stderr: r.stderr };
    },
    async ffprobe(args, opts) {
      return run(ffprobePath, args, { timeoutMs: opts?.timeoutMs ?? FFPROBE_DEFAULT_TIMEOUT_MS, keepStdout: true, label: "ffprobe" });
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Faux exécuteur
// ---------------------------------------------------------------------------------------------------------------

export type FakeFfmpegCall = { tool: "ffmpeg" | "ffprobe"; args: string[]; timeoutMs?: number };

type Reply<T> = Partial<T> | Array<Partial<T>> | ((args: string[], callIndex: number) => Partial<T> | Promise<Partial<T>>);

export type FakeFfmpegScript = {
  /** Réponses de ffmpeg : objet (toujours), liste (dans l'ordre, la dernière se répète) ou fonction. Défaut : code 0. */
  ffmpeg?: Reply<{ code: number; stderr: string }>;
  /** Réponses de ffprobe. Défaut : `fakeProbeJson()` (vidéo 1080x1920 de 15 s, H.264 + AAC, 30 i/s). */
  ffprobe?: Reply<{ code: number; stdout: string; stderr: string }>;
  /**
   * Vrai : quand ffmpeg réussit, crée un petit fichier au chemin de sortie (dernier argument, sauf `-`), dossiers
   * compris, pour les chaînes qui lisent, renomment ou envoient ensuite le fichier. Défaut : faux (rien n'est écrit).
   */
  writeOutputs?: boolean;
};

export type FakeFfmpegRunner = FfmpegRunner & {
  calls: FakeFfmpegCall[];
  ffmpegCalls(): string[][];
  ffprobeCalls(): string[][];
  reset(): void;
};

async function answer<T>(reply: Reply<T> | undefined, args: string[], index: number): Promise<Partial<T>> {
  if (!reply) return {};
  if (typeof reply === "function") return reply(args, index);
  if (Array.isArray(reply)) return reply.length ? reply[Math.min(index, reply.length - 1)]! : {};
  return reply;
}

export function createFakeFfmpegRunner(script: FakeFfmpegScript = {}): FakeFfmpegRunner {
  const calls: FakeFfmpegCall[] = [];
  let nFfmpeg = 0;
  let nFfprobe = 0;
  return {
    calls,
    ffmpegCalls: () => calls.filter((c) => c.tool === "ffmpeg").map((c) => c.args),
    ffprobeCalls: () => calls.filter((c) => c.tool === "ffprobe").map((c) => c.args),
    reset() {
      calls.length = 0;
      nFfmpeg = 0;
      nFfprobe = 0;
    },
    async ffmpeg(args, opts) {
      calls.push({ tool: "ffmpeg", args: [...args], timeoutMs: opts?.timeoutMs });
      const r = await answer(script.ffmpeg, args, nFfmpeg++);
      const code = r.code ?? 0;
      const out = args.at(-1);
      if (script.writeOutputs && code === 0 && out && out !== "-" && !out.includes("%")) {
        await mkdir(dirname(out), { recursive: true });
        await writeFile(out, "faux fichier ffmpeg\n");
      }
      return { code, stderr: r.stderr ?? "" };
    },
    async ffprobe(args, opts) {
      calls.push({ tool: "ffprobe", args: [...args], timeoutMs: opts?.timeoutMs });
      const r = await answer(script.ffprobe, args, nFfprobe++);
      return { code: r.code ?? 0, stdout: r.stdout ?? fakeProbeJson(), stderr: r.stderr ?? "" };
    },
  };
}

/** Sortie JSON de ffprobe (`-show_format -show_streams`) pour un faux fichier. */
export function fakeProbeJson(p: Partial<MediaProbe> = {}): string {
  const width = p.width ?? 1080;
  const height = p.height ?? 1920;
  const hasAudio = p.hasAudio ?? (p.audioCodec === undefined ? true : p.audioCodec !== null);
  const fpsRaw = p.fpsRaw ?? "30/1";
  const streams: unknown[] = [];
  // `videoCodec: null` : fichier sans image (son seul), pour tester l'erreur « pas de vidéo ».
  if (p.videoCodec !== null) {
    streams.push({ index: 0, codec_type: "video", codec_name: p.videoCodec ?? "h264", width, height, r_frame_rate: fpsRaw, avg_frame_rate: fpsRaw });
  }
  if (hasAudio) streams.push({ index: 1, codec_type: "audio", codec_name: p.audioCodec ?? "aac", sample_rate: "48000", channels: 2 });
  return JSON.stringify({
    streams,
    format: { duration: ((p.durationMs ?? 15_000) / 1000).toFixed(6), size: String(p.sizeBytes ?? 8_000_000), format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
  });
}

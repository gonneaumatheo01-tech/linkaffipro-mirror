/**
 * Extraction d'images d'une vidéo pour le Contrôle qualité des agents (phase 20) : `ffprobe` pour la durée, puis
 * `ffmpeg` pour 1 à 3 images JPEG (début, milieu, fin, à 10 %, 50 % et 90 % de la durée), réduites à 768 px de
 * large. Fichiers temporaires effacés ensuite. Toute erreur (ffmpeg absent, vidéo illisible) → null.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FrameExtractor } from "@linkaffipro/agents";
import { logger } from "../logger";

export type CommandRunner = (cmd: string, args: string[]) => Promise<{ code: number; stdout: string }>;

const execRunner: CommandRunner = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: 60_000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1) : 0;
      resolve({ code, stdout: String(stdout ?? "") });
    });
  });

/** Instants des images (pur) : milieu pour une image, sinon 10 %, 50 %, 90 % ; durée inconnue → 0 s, 1 s, 2 s. */
export function frameTimes(durationSec: number | null, count: number): number[] {
  const n = Math.max(1, Math.min(3, Math.round(count)));
  if (!durationSec || durationSec <= 0) return [0, 1, 2].slice(0, n);
  const fractions = n === 1 ? [0.5] : n === 2 ? [0.1, 0.9] : [0.1, 0.5, 0.9];
  return fractions.map((f) => Math.round(durationSec * f * 100) / 100);
}

function extensionOf(mimeType: string): string {
  if (mimeType === "video/quicktime") return "mov";
  if (mimeType === "video/webm") return "webm";
  return "mp4";
}

export function createFrameExtractor(run: CommandRunner = execRunner): FrameExtractor {
  return async (video, count) => {
    const dir = await mkdtemp(join(tmpdir(), "lap-frames-"));
    try {
      const input = join(dir, `in.${extensionOf(video.mimeType)}`);
      await writeFile(input, video.bytes);
      const probe = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", input]);
      const parsed = Number.parseFloat(probe.stdout.trim());
      const durationSec = probe.code === 0 && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
      const frames: Uint8Array[] = [];
      for (const [i, t] of frameTimes(durationSec, count).entries()) {
        const out = join(dir, `f${i}.jpg`);
        const r = await run("ffmpeg", ["-v", "error", "-y", "-ss", String(t), "-i", input, "-frames:v", "1", "-vf", "scale='min(768,iw)':-2", "-q:v", "3", out]);
        if (r.code !== 0) continue;
        const bytes = await readFile(out).catch(() => null);
        if (bytes?.length) frames.push(new Uint8Array(bytes));
      }
      return frames.length ? { frames, durationSec } : null;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "[agents] extraction d'images impossible");
      return null;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  };
}

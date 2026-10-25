/**
 * Phase 28, chantier B : ffmpeg RÉEL pour les tests (marqués `describe.skipIf(!realFfmpegAvailable())`).
 * - `MONTAGE_FFMPEG=docker` : scripts `packages/agents/scripts/ffmpeg-docker.sh` / `ffprobe-docker.sh` (image locale
 *   `lap-ffmpeg`, construite au premier appel ; le Mac n'a ni ffmpeg ni Homebrew) ;
 * - sinon un binaire `ffmpeg` + `ffprobe` trouvé dans le PATH (CI, worker) ;
 * - `MONTAGE_FFMPEG=off` : jamais (tests réels sautés).
 * Aucun réseau : tout part des fixtures `packages/agents/fixtures/montage/`.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFfmpegRunner } from "./runner";
import type { FfmpegRunner } from "../contract";

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Dossier des vidéos de test (`casino.mp4`, `black-middle.mp4`, `silent.mp4`, `sample.srt`). */
export const MONTAGE_FIXTURES_DIR = join(PACKAGE_DIR, "fixtures", "montage");
export const MONTAGE_FIXTURES = {
  casino: join(MONTAGE_FIXTURES_DIR, "casino.mp4"),
  blackMiddle: join(MONTAGE_FIXTURES_DIR, "black-middle.mp4"),
  silent: join(MONTAGE_FIXTURES_DIR, "silent.mp4"),
  srt: join(MONTAGE_FIXTURES_DIR, "sample.srt"),
} as const;

/** Polices présentes dans l'image Docker de test (et, pour Noto / FreeFont, dans l'image du worker). */
export const TEST_FONT_FILE = "/usr/share/fonts/noto/NotoSans-Bold.ttf";

const DOCKER_FFMPEG = join(PACKAGE_DIR, "scripts", "ffmpeg-docker.sh");
const DOCKER_FFPROBE = join(PACKAGE_DIR, "scripts", "ffprobe-docker.sh");

let cached: { ffmpegPath: string; ffprobePath: string } | null | undefined;

function detect(): { ffmpegPath: string; ffprobePath: string } | null {
  const mode = process.env.MONTAGE_FFMPEG?.trim().toLowerCase();
  if (mode === "off" || mode === "0" || mode === "fake") return null;
  if (mode === "docker") {
    if (!existsSync(DOCKER_FFMPEG)) return null;
    const docker = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { stdio: "ignore", timeout: 15_000 });
    return docker.status === 0 ? { ffmpegPath: DOCKER_FFMPEG, ffprobePath: DOCKER_FFPROBE } : null;
  }
  const ff = spawnSync("ffmpeg", ["-hide_banner", "-version"], { stdio: "ignore", timeout: 10_000 });
  const fp = spawnSync("ffprobe", ["-hide_banner", "-version"], { stdio: "ignore", timeout: 10_000 });
  return ff.status === 0 && fp.status === 0 ? { ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" } : null;
}

export function realFfmpegAvailable(): boolean {
  if (cached === undefined) cached = detect();
  return cached !== null;
}

/** Exécuteur réel pour les tests (lève une erreur si aucun ffmpeg réel n'est disponible). */
export function realFfmpegRunner(): FfmpegRunner {
  if (cached === undefined) cached = detect();
  if (!cached) throw new Error("Aucun ffmpeg réel : MONTAGE_FFMPEG=docker ou installer ffmpeg.");
  return createFfmpegRunner(cached);
}

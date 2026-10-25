/**
 * Tests RÉELS du moteur ffmpeg sur les fixtures (5 s). Sautés sans ffmpeg réel :
 * `MONTAGE_FFMPEG=docker npx vitest run src/montage/ffmpeg` (image Docker `lap-ffmpeg`) ou ffmpeg dans le PATH.
 * Aucun réseau. Fichiers de sortie dans /tmp, effacés à la fin.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MONTAGE_SETTINGS } from "../contract";
import type { ShortRenderSpec } from "../contract";
import { extractAudioSegment, extractFrames, MontageMediaError, probeMedia } from "./probe";
import { qcShort } from "./qc";
import { compressShort, renderShort } from "./render";
import { MONTAGE_FIXTURES, realFfmpegAvailable, realFfmpegRunner, TEST_FONT_FILE } from "./testing";

const REAL = realFfmpegAvailable();
const T = 180_000;

describe.skipIf(!REAL)("moteur ffmpeg réel (fixtures)", () => {
  let dir = "";
  const runner = REAL ? realFfmpegRunner() : (null as never);
  const spec = (p: Partial<ShortRenderSpec>): ShortRenderSpec => ({
    source: MONTAGE_FIXTURES.casino,
    output: join(dir, "short.mp4"),
    startMs: 500,
    endMs: 4500,
    format: "VERTICAL_9_16",
    pipPosition: "NONE",
    speed: null,
    srtPath: null,
    subtitleStyle: MONTAGE_SETTINGS.subtitleStyle.value,
    overlayText: null,
    fontFile: null,
    crf: 18,
    // « slow » en production ; « veryfast » ici pour garder des tests rapides (même graphe, même encodeur).
    preset: "veryfast",
    sourceCodec: "h264",
    fpsRaw: "30/1",
    ...p,
  });

  beforeAll(async () => {
    // /tmp est monté au même chemin dans le conteneur de test.
    await mkdir("/tmp/lap-montage-tests", { recursive: true });
    dir = await mkdtemp("/tmp/lap-montage-tests/run-");
  });
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("lit une fixture", async () => {
    const p = await probeMedia(runner, MONTAGE_FIXTURES.casino);
    expect(p).toMatchObject({ width: 1920, height: 1080, videoCodec: "h264", audioCodec: "aac", fpsRaw: "30/1", fps: 30, hasAudio: true });
    expect(Math.abs(p.durationMs - 5000)).toBeLessThan(100);
    expect(p.sizeBytes).toBeLessThan(1024 * 1024);
  }, T);

  it(
    "short vertical, caméra en haut à droite, sous-titres (chemin piégé) et texte (apostrophes, « : », emojis) → 1080x1920, H.264, AAC, 30 i/s, un passage",
    async () => {
      const srtDir = join(dir, "l'été: [a],b;c");
      await mkdir(srtDir, { recursive: true });
      const srtPath = join(srtDir, "sous titres.srt");
      await copyFile(MONTAGE_FIXTURES.srt, srtPath);
      const s = spec({
        pipPosition: "TOP_RIGHT",
        srtPath,
        overlayText: "C'est l'heure : x35, [jackpot] ; 100% 🎰",
        fontFile: TEST_FONT_FILE,
      });
      const out = await renderShort(runner, s, { timeoutMs: T });
      expect(out).toMatchObject({ width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac", fpsRaw: "30/1", hasAudio: true });
      expect(Math.abs(out.durationMs - 4000)).toBeLessThanOrEqual(2000);
      expect(Math.abs(out.durationMs - 4000)).toBeLessThan(200);
      const qc = await qcShort(runner, s.output, { durationTargetMs: 4000, format: "VERTICAL_9_16", subtitles: true });
      expect(qc.problems).toEqual([]);
      expect(qc.ok).toBe(true);
      // La caméra (coin haut-droit de la mire) est bien posée en haut à droite : image différente du fond noir.
      const frames = await extractFrames(runner, s.output, { everySec: 2, width: 270, outDir: join(dir, "frames") });
      expect(frames.length).toBeGreaterThanOrEqual(2);
      for (const f of frames) expect((await stat(f)).size).toBeGreaterThan(1000);
    },
    T,
  );

  it(
    "vitesse ×2 sans perdre la cadence, format carré, caméra en bas à gauche",
    async () => {
      const s = spec({ output: join(dir, "fast.mp4"), speed: 2, format: "SQUARE_1_1", pipPosition: "BOTTOM_LEFT" });
      const out = await renderShort(runner, s, { timeoutMs: T });
      expect(out).toMatchObject({ width: 1080, height: 1080, fpsRaw: "30/1", audioCodec: "aac" });
      expect(Math.abs(out.durationMs - 2000)).toBeLessThan(200);
    },
    T,
  );

  it(
    "seconde noire au milieu → détectée",
    async () => {
      const qc = await qcShort(runner, MONTAGE_FIXTURES.blackMiddle, { durationTargetMs: 5000, format: "HORIZONTAL_16_9", subtitles: false });
      expect(qc.ok).toBe(false);
      expect(qc.blackSec).toBeGreaterThan(0.8);
      expect(qc.blackSec).toBeLessThan(1.3);
      expect(qc.problems.some((p) => /d'image noire vers 2 s/.test(p))).toBe(true);
      expect(qc.silent).toBe(false);
    },
    T,
  );

  it(
    "silence complet → détecté",
    async () => {
      const qc = await qcShort(runner, MONTAGE_FIXTURES.silent, { durationTargetMs: 5000, format: "HORIZONTAL_16_9", subtitles: false });
      expect(qc).toMatchObject({ ok: false, silent: true, blackSec: 0 });
      expect(qc.problems).toEqual(["Le son est muet du début à la fin."]);
    },
    T,
  );

  it(
    "la fixture normale passe le contrôle (son 440 Hz, pas de noir, pas de saturation)",
    async () => {
      const qc = await qcShort(runner, MONTAGE_FIXTURES.casino, { durationTargetMs: 5000, format: "HORIZONTAL_16_9", subtitles: false });
      expect(qc).toMatchObject({ ok: true, silent: false, clipping: false, blackSec: 0, problems: [] });
    },
    T,
  );

  it(
    "fichier corrompu → erreur propre en français, sans plantage",
    async () => {
      const bytes = await readFile(MONTAGE_FIXTURES.casino);
      const corrupt = join(dir, "abime.mp4");
      await writeFile(corrupt, bytes.subarray(0, 4000));
      const err = await probeMedia(runner, corrupt).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MontageMediaError);
      expect((err as Error).message).toBe("Je n'arrive pas à lire le fichier « abime.mp4 » : il est illisible ou abîmé.");
      const junk = join(dir, "bruit.mp4");
      await writeFile(junk, Buffer.from("ceci n'est pas une vidéo".repeat(100)));
      await expect(renderShort(runner, spec({ source: junk, output: join(dir, "x.mp4") }))).rejects.toThrow(/illisible ou abîmé/);
    },
    T,
  );

  it(
    "son d'un passage : WAV mono 16 kHz lu dans la source",
    async () => {
      const wav = join(dir, "seg.wav");
      await extractAudioSegment(runner, MONTAGE_FIXTURES.casino, 1000, 3000, wav);
      const head = await readFile(wav);
      expect(head.subarray(0, 4).toString()).toBe("RIFF");
      expect(head.readUInt16LE(22)).toBe(1); // mono
      expect(head.readUInt32LE(24)).toBe(16000);
      expect(head.readUInt16LE(34)).toBe(16);
      // 2 s × 16 000 × 2 octets ≈ 64 000 octets (+ en-tête).
      expect(Math.abs(head.length - 64_000)).toBeLessThan(2000);
    },
    T,
  );

  it(
    "compression : rendu refait depuis la source avec CRF + 4 → plus petit",
    async () => {
      const s = spec({ output: join(dir, "big.mp4"), crf: 18 });
      const first = await renderShort(runner, s, { timeoutMs: T });
      const r = await compressShort(runner, s, first.sizeBytes - 1, { timeoutMs: T, current: first });
      expect(r.compressed).toBe(true);
      expect(r.crf).toBe(22);
      expect(r.probe.sizeBytes).toBeLessThan(first.sizeBytes);
      expect((await stat(s.output)).size).toBe(r.probe.sizeBytes);
      expect(r.probe).toMatchObject({ width: 1080, height: 1920, fpsRaw: "30/1" });
    },
    T,
  );
});

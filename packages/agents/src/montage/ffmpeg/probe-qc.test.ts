import { describe, expect, it } from "vitest";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeFfmpegRunner, createFfmpegRunner, fakeProbeJson, FfmpegRunError, FFMPEG_STDERR_TAIL_BYTES } from "./runner";
import { extractAudioSegment, extractFrames, MontageMediaError, parseFps, parseProbeJson, probeMedia } from "./probe";
import { buildQcArgs, frNumber, parseBlackDetect, parseSilenceDetect, parseVolumeDetect, qcShort } from "./qc";

describe("createFfmpegRunner (processus réel : Node joue ffmpeg)", () => {
  const node = process.execPath;
  it("rend le code de sortie et seulement les 4 derniers Ko de stderr", async () => {
    const runner = createFfmpegRunner({ ffmpegPath: node, ffprobePath: node });
    const r = await runner.ffmpeg(["-e", "process.stderr.write('A'.repeat(10000) + 'FIN'); process.exit(3)"]);
    expect(r.code).toBe(3);
    expect(r.stderr.length).toBe(FFMPEG_STDERR_TAIL_BYTES);
    expect(r.stderr.endsWith("AFIN")).toBe(true);
    const p = await runner.ffprobe(["-e", "process.stdout.write(JSON.stringify({ok:1}))"]);
    expect(p).toMatchObject({ code: 0, stdout: '{"ok":1}' });
  });
  it("tue le processus au dépassement du délai", async () => {
    const runner = createFfmpegRunner({ ffmpegPath: node });
    const t0 = Date.now();
    const err = await runner.ffmpeg(["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 300 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FfmpegRunError);
    expect((err as FfmpegRunError).kind).toBe("timeout");
    expect((err as Error).message).toMatch(/dépassé le temps permis/);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
  it("binaire absent : erreur claire", async () => {
    const runner = createFfmpegRunner({ ffmpegPath: "/nulle/part/ffmpeg-absent" });
    await expect(runner.ffmpeg(["-version"])).rejects.toMatchObject({ kind: "missing", message: expect.stringMatching(/introuvable/) });
  });
  it("aucun shell : les arguments passent tels quels", async () => {
    const runner = createFfmpegRunner({ ffprobePath: node });
    const r = await runner.ffprobe(["-e", "process.stdout.write(process.argv[1])", "$(echo pirate); `id` 'x'"]);
    expect(r.stdout).toBe("$(echo pirate); `id` 'x'");
  });
});

describe("createFakeFfmpegRunner", () => {
  it("enregistre les appels et rend les réponses dans l'ordre (la dernière se répète)", async () => {
    const runner = createFakeFfmpegRunner({ ffmpeg: [{ code: 0 }, { code: 1, stderr: "x" }] });
    expect(await runner.ffmpeg(["a"])).toEqual({ code: 0, stderr: "" });
    expect(await runner.ffmpeg(["b"])).toEqual({ code: 1, stderr: "x" });
    expect(await runner.ffmpeg(["c"])).toEqual({ code: 1, stderr: "x" });
    expect(runner.ffmpegCalls()).toEqual([["a"], ["b"], ["c"]]);
    expect(JSON.parse((await runner.ffprobe(["p"])).stdout).streams).toHaveLength(2);
    runner.reset();
    expect(runner.calls).toEqual([]);
  });
});

describe("probeMedia", () => {
  it("lit durée, taille, codecs, images/s exactes", async () => {
    const runner = createFakeFfmpegRunner({ ffprobe: { stdout: fakeProbeJson({ width: 1920, height: 1080, durationMs: 2_820_500, fpsRaw: "30000/1001", videoCodec: "hevc", sizeBytes: 1234 }) } });
    const p = await probeMedia(runner, "/tmp/x.mp4");
    expect(p).toEqual({ durationMs: 2_820_500, width: 1920, height: 1080, videoCodec: "hevc", audioCodec: "aac", fps: 29.97, fpsRaw: "30000/1001", sizeBytes: 1234, hasAudio: true });
    expect(runner.ffprobeCalls()[0]).toEqual(["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "/tmp/x.mp4"]);
  });
  it("fichier illisible / abîmé / introuvable / sans vidéo : erreurs en français", async () => {
    const bad = createFakeFfmpegRunner({ ffprobe: { code: 1, stdout: "", stderr: "/tmp/x.mp4: Invalid data found when processing input" } });
    await expect(probeMedia(bad, "/tmp/x.mp4")).rejects.toThrow("Je n'arrive pas à lire le fichier « x.mp4 » : il est illisible ou abîmé.");
    const missing = createFakeFfmpegRunner({ ffprobe: { code: 1, stderr: "/tmp/y.mp4: No such file or directory" } });
    await expect(probeMedia(missing, "/tmp/y.mp4")).rejects.toThrow("Le fichier « y.mp4 » est introuvable.");
    const noVideo = createFakeFfmpegRunner({ ffprobe: { stdout: fakeProbeJson({ videoCodec: null }) } });
    await expect(probeMedia(noVideo, "/tmp/z.m4a")).rejects.toMatchObject({ reason: "no_video", message: "Le fichier « z.m4a » ne contient pas d'image vidéo." });
  });
  it("pochette d'un fichier son = pas une vidéo ; durée absente = abîmé", () => {
    const cover = JSON.stringify({ streams: [{ codec_type: "video", codec_name: "mjpeg", width: 500, height: 500, disposition: { attached_pic: 1 } }, { codec_type: "audio", codec_name: "mp3" }], format: { duration: "10" } });
    expect(() => parseProbeJson(cover, "a.mp3")).toThrow(/pas d'image vidéo/);
    const noDur = JSON.stringify({ streams: [{ codec_type: "video", codec_name: "h264", width: 10, height: 10 }], format: {} });
    expect(() => parseProbeJson(noDur, "b.mp4")).toThrow(/durée/);
    expect(() => parseProbeJson("pas du json", "c.mp4")).toThrow(MontageMediaError);
  });
  it("parseFps", () => {
    expect(parseFps("30/1")).toBe(30);
    expect(parseFps("30000/1001")).toBe(29.97);
    expect(parseFps("0/0")).toBeNull();
    expect(parseFps("abc")).toBeNull();
    expect(parseFps("25")).toBe(25);
  });
  it("vidéo sans son", async () => {
    const runner = createFakeFfmpegRunner({ ffprobe: { stdout: fakeProbeJson({ hasAudio: false }) } });
    expect(await probeMedia(runner, "/tmp/m.mp4")).toMatchObject({ hasAudio: false, audioCodec: null });
  });
});

describe("extractFrames / extractAudioSegment (faux exécuteur)", () => {
  it("une image toutes les N s, réduite, rendues dans l'ordre ; anciennes images effacées", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lap-frames-"));
    await writeFile(join(dir, "frame-00009.jpg"), "vieille");
    await writeFile(join(dir, "autre.txt"), "garde");
    const runner = createFakeFfmpegRunner({
      ffmpeg: async () => {
        for (const n of [2, 1, 3]) await writeFile(join(dir, `frame-0000${n}.jpg`), "jpg");
        return { code: 0 };
      },
    });
    const frames = await extractFrames(runner, "/tmp/src.mp4", { everySec: 5, width: 511, outDir: dir });
    expect(frames).toEqual([1, 2, 3].map((n) => join(dir, `frame-0000${n}.jpg`)));
    const args = runner.ffmpegCalls()[0]!;
    expect(args[args.indexOf("-vf") + 1]).toBe("fps=1/5,scale=512:-2");
    expect(args.at(-1)).toBe(join(dir, "frame-%05d.jpg"));
    expect((await readdir(dir)).sort()).toEqual(["autre.txt", "frame-00001.jpg", "frame-00002.jpg", "frame-00003.jpg"]);
  });
  it("vidéo illisible : erreur claire", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lap-frames-"));
    const runner = createFakeFfmpegRunner({ ffmpeg: { code: 1, stderr: "moov atom not found" } });
    await expect(extractFrames(runner, "/tmp/src.mp4", { outDir: dir })).rejects.toThrow(/extraire les images de « src.mp4 »/);
  });
  it("son : PCM 16 bits mono 16 kHz, lu directement dans la source, coupe avant -i", async () => {
    const runner = createFakeFfmpegRunner();
    await extractAudioSegment(runner, "/tmp/src.mp4", 150_000, 165_500, "/tmp/a.wav");
    const args = runner.ffmpegCalls()[0]!;
    expect(args.slice(args.indexOf("-ss"), args.indexOf("-i") + 2)).toEqual(["-ss", "150.000", "-t", "15.500", "-i", "/tmp/src.mp4"]);
    for (const [flag, v] of [["-ac", "1"], ["-ar", "16000"], ["-c:a", "pcm_s16le"], ["-map", "0:a:0"]]) expect(args[args.indexOf(flag!) + 1]).toBe(v);
    expect(args).toContain("-vn");
    expect(args.at(-1)).toBe("/tmp/a.wav");
  });
  it("son absent : erreur « pas de son »", async () => {
    const runner = createFakeFfmpegRunner({ ffmpeg: { code: 1, stderr: "Stream map '0:a:0' matches no streams." } });
    await expect(extractAudioSegment(runner, "/tmp/src.mp4", 0, 1000, "/tmp/a.wav")).rejects.toMatchObject({ reason: "no_audio" });
    await expect(extractAudioSegment(runner, "/tmp/src.mp4", 1000, 1000, "/tmp/a.wav")).rejects.toThrow(/fin doit venir après/);
  });
});

const BLACK_LOG = `[blackdetect @ 0x7f] black_start:2 black_end:3.033 black_duration:1.033`;
const SILENCE_LOG = `[silencedetect @ 0x1] silence_start: 0\n[silencedetect @ 0x1] silence_end: 5.0 | silence_duration: 5.0`;
const VOLUME_LOG = (max: string, zero = "0", samples = "480000") =>
  `[Parsed_volumedetect_1 @ 0x2] n_samples: ${samples}\n[Parsed_volumedetect_1 @ 0x2] mean_volume: -21.0 dB\n[Parsed_volumedetect_1 @ 0x2] max_volume: ${max} dB\n[Parsed_volumedetect_1 @ 0x2] histogram_0db: ${zero}`;

describe("lecture des analyses", () => {
  it("blackdetect, silencedetect (fin absente = jusqu'au bout), volumedetect", () => {
    expect(parseBlackDetect(`${BLACK_LOG}\nautre\n[blackdetect @ 0x7f] black_start:0 black_end:0.2 black_duration:0.2`)).toEqual([
      { startSec: 2, endSec: 3.033, durationSec: 1.033 },
      { startSec: 0, endSec: 0.2, durationSec: 0.2 },
    ]);
    expect(parseSilenceDetect(SILENCE_LOG)).toEqual([{ startSec: 0, endSec: 5 }]);
    expect(parseSilenceDetect("silence_start: 3.5")).toEqual([{ startSec: 3.5, endSec: null }]);
    expect(parseSilenceDetect("silence_start: -0.02\nsilence_end: 1")).toEqual([{ startSec: 0, endSec: 1 }]);
    expect(parseVolumeDetect(VOLUME_LOG("-18.1", "12"))).toEqual({ meanDb: -21, maxDb: -18.1, samples: 480000, atZeroDb: 12 });
    expect(parseVolumeDetect("max_volume: -inf dB").maxDb).toBe(-Infinity);
  });
  it("nombres à la française", () => {
    expect(frNumber(3.24)).toBe("3,2");
    expect(frNumber(15)).toBe("15");
    expect(frNumber(0.999)).toBe("1");
  });
  it("arguments : analyse image + son en un passage, sortie nulle", () => {
    const a = buildQcArgs("/tmp/s.mp4", true);
    expect(a[a.indexOf("-vf") + 1]).toBe("blackdetect=d=0.1:pic_th=0.98:pix_th=0.1");
    expect(a[a.indexOf("-af") + 1]).toBe("silencedetect=n=-60dB:d=0.5,volumedetect");
    expect(a.slice(-3)).toEqual(["-f", "null", "-"]);
    expect(buildQcArgs("/tmp/s.mp4", false)).not.toContain("-af");
  });
});

describe("qcShort (faux exécuteur)", () => {
  const qc = (probe: Parameters<typeof fakeProbeJson>[0], stderr: string, target = 15_000) =>
    qcShort(createFakeFfmpegRunner({ ffprobe: { stdout: fakeProbeJson(probe) }, ffmpeg: { code: 0, stderr } }), "/tmp/s.mp4", {
      durationTargetMs: target,
      format: "VERTICAL_9_16",
      subtitles: true,
    });

  it("short conforme : ok", async () => {
    const r = await qc({ durationMs: 15_400, sizeBytes: 9_000_000 }, VOLUME_LOG("-18.1"));
    expect(r).toEqual({ ok: true, durationMs: 15_400, width: 1080, height: 1920, sizeBytes: 9_000_000, blackSec: 0, silent: false, clipping: false, problems: [] });
  });
  it("durée hors tolérance, image trop petite et mauvais format", async () => {
    const r = await qc({ durationMs: 12_300, width: 540, height: 960 }, VOLUME_LOG("-18"));
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual([
      "Le short dure 12,3 s au lieu de 15 s (écart permis : 2 s).",
      "Image trop petite : 960 px sur le grand côté, il en faut au moins 1080.",
      "Image de 540x960 au lieu de 1080x1920.",
    ]);
  });
  it("plus de 0,5 s de noir → problème ; moins → toléré", async () => {
    const r = await qc({}, `${BLACK_LOG}\n${VOLUME_LOG("-18")}`);
    expect(r.blackSec).toBe(1.033);
    expect(r.problems).toEqual(["1 s d'image noire vers 2 s."]);
    const ok = await qc({}, `[blackdetect @ 0] black_start:0 black_end:0.4 black_duration:0.4\n${VOLUME_LOG("-18")}`);
    expect(ok.ok).toBe(true);
    const start = await qc({}, `[blackdetect @ 0] black_start:0 black_end:3.2 black_duration:3.2\n${VOLUME_LOG("-18")}`);
    expect(start.problems).toEqual(["3,2 s d'image noire au début."]);
  });
  it("silence complet, absence de son, saturation, poids", async () => {
    expect((await qc({ durationMs: 5000 }, `${SILENCE_LOG}\n${VOLUME_LOG("-91")}`, 5000)).problems).toEqual(["Le son est muet du début à la fin."]);
    const none = await qc({ hasAudio: false }, "");
    expect(none).toMatchObject({ silent: true, problems: ["Le short n'a pas de son."] });
    const clip = await qc({}, VOLUME_LOG("0.0", "4000"));
    expect(clip).toMatchObject({ clipping: true, problems: ["Le son sature : il est trop fort et grésille."] });
    expect((await qc({}, VOLUME_LOG("0.0", "3"))).clipping).toBe(false);
    const heavy = await qc({ sizeBytes: 63 * 1024 * 1024 }, VOLUME_LOG("-18"));
    expect(heavy.problems).toEqual(["Fichier de 63 Mo : trop lourd pour Telegram (50 Mo au plus)."]);
  });
  it("short illisible : erreur claire", async () => {
    const runner = createFakeFfmpegRunner({ ffprobe: { stdout: fakeProbeJson() }, ffmpeg: { code: 1, stderr: "Invalid data" } });
    await expect(qcShort(runner, "/tmp/s.mp4", { durationTargetMs: 15_000, format: "VERTICAL_9_16", subtitles: false })).rejects.toThrow(/vérifier ce short/);
  });
});

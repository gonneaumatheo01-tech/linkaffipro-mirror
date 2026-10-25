import { describe, expect, it } from "vitest";
import { createTestKit } from "../human/test-kit";
import type { FfmpegRunner } from "./contract";
import { formatMontageDiag, parseEncoders, parseFilters, runMontageDiag } from "./diag";

const ENCODERS = ` V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC (codec h264)
 V....D libx265              libx265 H.265 / HEVC (codec hevc)
 A....D aac                  AAC (Advanced Audio Coding)`;
const FILTERS = ` T.C drawtext          V->V       Draw text on top of video frames using libfreetype library.
 TSC overlay           VV->V      Overlay a video source on top of the input.
 ..C scale             V->V       Scale the input video size and/or convert the image format.
 ... pad               V->V       Pad the input video.
 ... subtitles         V->V       Render text subtitles onto input video using the libass library.
 ... blackdetect       V->V       Detect video intervals that are (almost) black.`;

function runner(over: { encoders?: string; filters?: string; ffmpegCode?: number } = {}): FfmpegRunner {
  return {
    ffmpeg: async () => ({ code: over.ffmpegCode ?? 0, stderr: "" }),
    ffprobe: async (args) => {
      if (args.includes("-version")) return { code: 0, stdout: "ffprobe version 7.1.1 Copyright", stderr: "" };
      if (args.includes("-encoders")) return { code: 0, stdout: over.encoders ?? ENCODERS, stderr: "" };
      return { code: 0, stdout: over.filters ?? FILTERS, stderr: "" };
    },
  };
}

describe("diagnostic du montage", () => {
  it("lit les codecs et les filtres de ffmpeg", () => {
    expect([...parseEncoders(ENCODERS)]).toEqual(["libx264", "libx265", "aac"]);
    expect([...parseFilters(FILTERS)]).toEqual(["drawtext", "overlay", "scale", "pad", "subtitles", "blackdetect"]);
  });

  it("tout est prêt → ok, tableau en français", async () => {
    const kit = createTestKit();
    await kit.prisma.montageJob.create({ data: { status: "FAILED", error: "ffmpeg : mémoire épuisée", currentStep: "dress", shortCount: 3, sourceAssetId: "s", instructions: {} } as never });
    const r = await runMontageDiag({
      ffmpeg: runner(),
      workDir: "/tmp/montage",
      prisma: kit.prisma,
      freeBytes: async () => 10 * 1024 ** 3,
      queueCounts: async () => ({ waiting: 2, active: 1, delayed: 0, failed: 0 }),
    });
    expect(r.ok).toBe(true);
    const text = formatMontageDiag(r);
    expect(text).toMatch(/version 7\.1\.1/);
    expect(text).toMatch(/filtre drawtext\s+présent/);
    expect(text).toMatch(/2 en attente, 1 en cours/);
    expect(text).toMatch(/FAILED \(dress\).*mémoire épuisée/);
    expect(text).toMatch(/Montage prêt/);
  });

  it("filtre absent, disque plein ou ffmpeg muet → pas prêt (code 1)", async () => {
    const noSubs = await runMontageDiag({ ffmpeg: runner({ filters: FILTERS.replace(/subtitles/, "xx") }), freeBytes: async () => 10 * 1024 ** 3 });
    expect(noSubs.ok).toBe(false);
    expect(formatMontageDiag(noSubs)).toMatch(/KO\s+filtre subtitles\s+absent/);
    const full = await runMontageDiag({ ffmpeg: runner(), freeBytes: async () => 100 * 1024 ** 2 });
    expect(full.ok).toBe(false);
    const dead = await runMontageDiag({ ffmpeg: runner({ ffmpegCode: 127 }), freeBytes: async () => 10 * 1024 ** 3 });
    expect(dead.ok).toBe(false);
    // H.265 facultatif.
    const noHevc = await runMontageDiag({ ffmpeg: runner({ encoders: ENCODERS.split("\n").filter((l) => !l.includes("libx265")).join("\n") }), freeBytes: async () => 10 * 1024 ** 3 });
    expect(noHevc.ok).toBe(true);
  });
});

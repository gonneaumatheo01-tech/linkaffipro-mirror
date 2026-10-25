/** Phase 28, chantier B : moteur ffmpeg de l'équipe Montage (sans IA, sans Prisma). */
export {
  createFfmpegRunner,
  createFakeFfmpegRunner,
  fakeProbeJson,
  FfmpegRunError,
  FFMPEG_STDERR_TAIL_BYTES,
  type FfmpegRunnerOptions,
  type FakeFfmpegScript,
  type FakeFfmpegRunner,
  type FakeFfmpegCall,
} from "./runner";
export { probeMedia, parseProbeJson, parseFps, extractFrames, extractAudioSegment, stderrSummary, MontageMediaError } from "./probe";
export {
  buildRenderArgs,
  buildFilterGraph,
  renderShort,
  compressShort,
  pipCrop,
  pipWidth,
  formatSize,
  escapeFilterValue,
  drawableOverlayText,
  fitOverlayText,
  atempoChain,
  effectiveSpeed,
  renderedDurationMs,
  PIP_MARGIN_PX,
  SPEED_MIN,
  SPEED_MAX,
  type PipPlacement,
  type RenderArgsOptions,
  type RenderOptions,
  type CompressResult,
} from "./render";
export { qcShort, buildQcArgs, parseBlackDetect, parseSilenceDetect, parseVolumeDetect, QC_THRESHOLDS, type QcOptions, type BlackSegment, type SilenceSegment, type VolumeStats } from "./qc";
export { realFfmpegAvailable, realFfmpegRunner, MONTAGE_FIXTURES, MONTAGE_FIXTURES_DIR, TEST_FONT_FILE } from "./testing";

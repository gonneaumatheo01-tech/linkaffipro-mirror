/** Phase 28 — équipe Montage. Chaque chantier ajoute ses lignes ici (le contrat est exporté par `src/index.ts`). */

// Chantier C : IA du montage (instructions, plan de coupe, sous-titres, lisibilité).
export {
  MontageAiError,
  assertMontageBudget,
  montageBudgetCap,
  montageMonthSpent,
  type MontageAiDeps,
  type MontageAiErrorCode,
  type SttClient,
  type SttRequest,
} from "./ai";
export {
  parseMontageInstructions,
  parseMontageInstructionsDetailed,
  parseMontageRules,
  INSTRUCTIONS_MODEL,
  MONTAGE_THEMES,
  type AmbiguousField,
  type MontageRuleResult,
  type MontageInstructionDefaults,
} from "./instructions";
export { planCuts, mergeCutCandidates, parseCutCandidates, sourceSpanMs, CUT_PLAN_MODEL, type PlanCutsInput, type RawCandidate } from "./analyze";
export {
  transcribeClip,
  verifySubtitles,
  subtitlesToSrt,
  applyClientCorrection,
  parseSttResponse,
  createVeniceStt,
  loadVeniceSttKey,
  wrapSubtitleLines,
  srtTime,
  wordDiff,
  MONTAGE_STT_PROMPT,
  DEDUCED_CONFIDENCE,
  SUBTITLE_VERIFY_MODEL,
  type TranscribedSegment,
  type TranscribeClipOptions,
  type VerifySubtitlesInput,
  type VerifySubtitlesResult,
} from "./subtitles";
export { checkSubtitleReadability, parseReadability, READABILITY_MODEL, type ReadabilityResult } from "./qc-vision";
export { createFakeMontageLlm, createFakeStt, createFakeMontagePrisma, fakeMontageAiDeps } from "./ai-fakes";

// Chantier D : chaîne, stockage, ménage, diagnostic (file `agents-montage` du worker).
export {
  createMontageJob,
  runMontageStep,
  editPlan,
  approvePlan,
  resolveSubtitleDoubt,
  redoClip,
  parseClipChangeText,
  cancelJob,
  setClipDecision,
  refreshJobStatus,
  resumeStalledMontage,
  montageTaskId,
  clampCut,
  clipOutputMs,
  keepPlanned,
  scaleSegments,
  type CreateMontageJobInput,
  type MontagePlanEdit,
  type MontageClipChange,
  type PlanEditResult,
  type MontageStepResult,
} from "./pipeline";
export {
  createLongVideoAsset,
  downloadSource,
  createTelegramDownloader,
  sourceRefusal,
  longVideoSha256,
  isBotTooBig,
  type LongVideoInput,
  type LongVideoResult,
  type DownloadableAsset,
  type BotFileDownloader,
  type AccountFileDownloader,
} from "./source";
export { storeShort, resolveAssetBytes, type StoreShortInput, type ResolvableAsset } from "./storage";
export { cleanupClip, cleanupJob, sweepMontageWorkDir, ORPHAN_MAX_AGE_MS } from "./cleanup";
export { runMontageDiag, formatMontageDiag, parseEncoders, parseFilters, DIAG_CODECS, DIAG_FILTERS, MIN_FREE_BYTES, type MontageDiagRow, type MontageDiagDeps } from "./diag";
export { createMontageEngine, readabilityTimes } from "./engine";
export {
  MontageRefused,
  parseTelegramRef,
  workDirOf,
  jobDir,
  clipDir,
  framesDir,
  sourceCopyPath,
  isTerminalJob,
  TERMINAL_JOB_STATUSES,
  SETTLED_CLIP_STATUSES,
  type TelegramRef,
  type FrameRef,
  type MontageEngine,
  type MontageHooks,
  type MontageRuntime,
  type MontagePipelineDeps,
  type StoredShort,
  type MontageJobRow,
  type ShortClipRow,
} from "./runtime";

// Chantier E : Kevin et le montage (réception des vidéos, plan, aperçus, retours, crochets de la chaîne, vues).
export {
  receiveMontageVideo,
  montageVideoQuestion,
  launchMontage,
  montageFromPhrase,
  handleVideoChoice,
  montageIntentOf,
  looksLikeMontageInstructions,
  videoRefusalOf,
  RECEPTION_VARIANTS,
  MONTAGE_VIDEO_CHOICE_PREFIX,
  MONTAGE_VIDEO_MIMES,
  type VideoMessage,
  type ReceiveVideoInput,
  type ReceiveVideoResult,
  type MontageIntent,
} from "./reception";
export { planMessages, parsePlanReply, answerPlan, PLAN_VARIANTS, clockOf, durationLabel, resolutionLabel, formatLabel, sizeLabel, type PlanClip, type PlanReply } from "./plan-message";
export { previewCaption, previewButtons, subtitleDoubtText, subtitleDoubtButtons, qcFailedText, failedText, friendlyReason, PREVIEW_VARIANTS, SUBTITLE_CALLBACK_PREFIX, QC_CALLBACK_PREFIX } from "./preview";
export {
  decideShort,
  changeShort,
  answerPreviews,
  answerSubtitle,
  parseClipChange,
  parsePreviewReply,
  parseDestination,
  sendApprovedShorts,
  keepShorts,
  isMontageCallbackData,
  handleMontageCallback,
  FEEDBACK_VARIANTS,
  type MontageCallbackResult,
  type DecideResult,
} from "./feedback";
export { createKevinMontageHooks, montageKevinHooks } from "./hooks";
export { montageStatus, montageView, montageAgentCard, MONTAGE_AGENT_KEYS, VIEW_VARIANTS as MONTAGE_VIEW_VARIANTS } from "./kevin-view";
export { montagePort, type KevinMontageDeps, type MontageKevinPort, type PlanEdit, type ClipChange } from "./kevin-port";
export { readMontageAwait, readMontageState, type MontageAwait, type ReceivedVideo } from "./kevin-state";

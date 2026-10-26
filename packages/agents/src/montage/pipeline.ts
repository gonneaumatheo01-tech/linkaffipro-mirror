/**
 * Phase 28, chantier D — chaîne du montage (file `agents-montage`, une tâche à la fois : ffmpeg est lourd).
 *
 *   createMontageJob ─► montage.analyze : copie de travail (téléchargée si absente) → ffprobe → une image / 5 s →
 *                       plan de coupe (IA) → `ShortClip` PLANNED → PLAN_SENT → `onPlanReady` (Kevin envoie le plan)
 *   approvePlan (Kevin, après l'accord du client, avec ses retouches) ─► une tâche montage.cut par short
 *   montage.cut     : sous-titres (son pris dans la SOURCE → 2 transcriptions → vérification) ; un doute →
 *                     `subtitlesPending` + `onSubtitleDoubt`, le short attend `resolveSubtitleDoubt`
 *   montage.dress   : rendu UNIQUE (coupe + caméra + format + vitesse + sous-titres + texte, un seul encodage)
 *   montage.qc      : contrôle automatique + lisibilité des sous-titres ; échec → QC_FAILED + `onQcFailed` ;
 *                     > 50 Mo → une seule compression depuis la source ; puis rangement dans Telegram (`storeShort`)
 *   montage.preview : `onPreviewReady` (Kevin envoie l'aperçu et ses boutons) → PREVIEW_SENT
 *   redoClip / cancelJob / setClipDecision / resolveSubtitleDoubt : appelés par Kevin (chantier E) et le site.
 *
 * Reprise (règle 6) : chaque étape relit la base et repart de ce qui existe ; un short rangé (`assetId`) n'est jamais
 * refait sauf REDO ; 3 essais par tâche (2 reprises, attente croissante, BullMQ), puis échec définitif annoncé par
 * Kevin (`onFailed`). Analyse en échec → tout le montage FAILED ; un short en échec → ce short seul (QC_FAILED), les
 * autres continuent. Une vidéo refusée (trop lourde, trop longue, illisible) n'est jamais réessayée.
 */
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Prisma } from "@linkaffipro/db";
import { agentEvent, readSetting } from "../admin/journal";
import {
  MONTAGE_LIMITS,
  MONTAGE_SETTINGS,
  type MontageInstructions,
  type MontageQueueJob,
  type MontageStep,
  type PipPosition,
  type PlannedClip,
  type QcReport,
  type ShortFormat,
  type ShortRenderSpec,
  type SubtitleSegment,
  type UncertainSegment,
} from "./contract";
import { cleanupClip, cleanupJob } from "./cleanup";
import { gateShortPreview } from "../qa-gates/shorts";
import {
  clipDir,
  framesDir,
  isTerminalJob,
  MontageRefused,
  nowOf,
  SETTLED_CLIP_STATUSES,
  sourceCopyPath,
  type MontageEngine,
  type MontageJobRow,
  type MontagePipelineDeps,
  type ShortClipRow,
} from "./runtime";
import { downloadSource, sourceRefusal } from "./source";
import { storeShort } from "./storage";

export type MontageStepResult =
  | { ok: true; step: MontageQueueJob["type"]; outcome: string }
  | { ok: false; step: MontageQueueJob["type"]; outcome: "failed" | "skipped"; reason: string };

// ---------------------------------------------------------------------------------------------------------------------
// Réglages et petits outils

async function settingNumber(deps: MontagePipelineDeps, key: string, fallback: number): Promise<number> {
  const v = await readSetting(deps, key).catch(() => undefined);
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

async function settingString(deps: MontagePipelineDeps, key: string, fallback: string): Promise<string> {
  const v = await readSetting(deps, key).catch(() => undefined);
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function engineOf(deps: MontagePipelineDeps): MontageEngine {
  const engine = deps.montage?.engine;
  if (!engine) throw new Error("moteur de montage non branché (worker)");
  return engine;
}

async function enqueue(deps: MontagePipelineDeps, job: MontageQueueJob, opts: { jobId?: string; delayMs?: number } = {}): Promise<void> {
  if (!deps.montage?.enqueue) throw new Error("file agents-montage non branchée");
  await deps.montage.enqueue(job, opts);
}

/** Identifiant de tâche stable (idempotent) : une étape d'un short d'une version donnée n'est jamais en file deux fois. */
export function montageTaskId(job: MontageQueueJob, redoCount = 0): string {
  if (job.type === "montage.analyze") return `montage-${job.montageJobId}-analyze`;
  return `montage-${job.shortClipId}-${job.type.slice("montage.".length)}-v${redoCount ?? 0}`;
}

async function enqueueClipStep(deps: MontagePipelineDeps, type: Exclude<MontageQueueJob["type"], "montage.analyze">, clip: Pick<ShortClipRow, "id" | "montageJobId" | "redoCount">): Promise<void> {
  const job = { type, montageJobId: clip.montageJobId, shortClipId: clip.id } as MontageQueueJob;
  await enqueue(deps, job, { jobId: montageTaskId(job, clip.redoCount) });
}

function instructionsOf(job: Pick<MontageJobRow, "instructions">): MontageInstructions {
  const i = (job.instructions ?? {}) as Partial<MontageInstructions>;
  return {
    theme: typeof i.theme === "string" ? i.theme : null,
    format: (i.format as ShortFormat) ?? MONTAGE_SETTINGS.defaultFormat.value,
    durationTarget: typeof i.durationTarget === "number" ? i.durationTarget : MONTAGE_SETTINGS.defaultDuration.value,
    pipPosition: (i.pipPosition as PipPosition) ?? "NONE",
    subtitles: i.subtitles !== false,
    overlayText: typeof i.overlayText === "string" && i.overlayText.trim() ? i.overlayText : null,
    count: typeof i.count === "number" ? i.count : null,
    speed: typeof i.speed === "number" ? i.speed : null,
    rawText: typeof i.rawText === "string" ? i.rawText : "",
  };
}

type SourceMeta = { durationMs: number; width: number; height: number; videoCodec: string | null; fpsRaw: string | null; sizeBytes: number };

function sourceMetaOf(job: Pick<MontageJobRow, "sourceMeta">): SourceMeta | null {
  const m = job.sourceMeta as Partial<SourceMeta> | null;
  return m && typeof m.durationMs === "number" ? (m as SourceMeta) : null;
}

/** Durée du short une fois la vitesse appliquée. */
export function clipOutputMs(clip: Pick<ShortClipRow, "startMs" | "endMs" | "speed">): number {
  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
  return Math.round((clip.endMs - clip.startMs) / speed);
}

/** Coupe ramenée dans la vidéo et dans les bornes 5 à 90 s (durée du short, vitesse comprise). Pure. */
export function clampCut(cut: { startMs: number; endMs: number }, sourceMs: number, speed: number | null): { startMs: number; endMs: number } {
  const s = speed && speed > 0 ? speed : 1;
  const minSpan = MONTAGE_LIMITS.minShortSec * 1000 * s;
  const maxSpan = MONTAGE_LIMITS.maxShortSec * 1000 * s;
  let start = Math.max(0, Math.round(cut.startMs));
  let end = Math.round(cut.endMs);
  if (sourceMs > 0) end = Math.min(end, sourceMs);
  if (end - start > maxSpan) end = start + maxSpan;
  if (end - start < minSpan) {
    end = start + minSpan;
    if (sourceMs > 0 && end > sourceMs) {
      end = sourceMs;
      start = Math.max(0, end - minSpan);
    }
  }
  return { startMs: start, endMs: end };
}

async function loadJob(deps: MontagePipelineDeps, id: string): Promise<MontageJobRow | null> {
  return (await deps.prisma.montageJob.findUnique({ where: { id } })) as MontageJobRow | null;
}

async function loadClip(deps: MontagePipelineDeps, id: string): Promise<ShortClipRow | null> {
  return (await deps.prisma.shortClip.findUnique({ where: { id } })) as ShortClipRow | null;
}

async function setStep(deps: MontagePipelineDeps, jobId: string, step: MontageStep, data: Record<string, unknown> = {}): Promise<void> {
  await deps.prisma.montageJob.update({ where: { id: jobId }, data: { currentStep: step, ...data } });
}

/** Statut du travail = étape en cours d'un de ses shorts (le plan doit être lancé ; jamais un travail fini). */
async function markJobWorking(deps: MontagePipelineDeps, job: MontageJobRow, status: "CUTTING" | "DRESSING" | "QC", step: MontageStep): Promise<void> {
  if (!["CUTTING", "DRESSING", "QC", "PREVIEW"].includes(job.status)) return setStep(deps, job.id, step);
  await deps.prisma.montageJob.update({ where: { id: job.id }, data: { status, currentStep: step } });
}

/** Copie de travail de la source : téléchargée si absente (redémarrage du worker, disque nettoyé). */
async function ensureSourceCopy(deps: MontagePipelineDeps, job: MontageJobRow): Promise<string> {
  const asset = await deps.prisma.mediaAsset.findUnique({
    where: { id: job.sourceAssetId },
    select: { id: true, size: true, duration: true, storage: true, telegramRef: true, mimeType: true },
  });
  if (!asset) throw new MontageRefused("Je ne retrouve plus ta vidéo : renvoie-la-moi.");
  const dest = sourceCopyPath(deps, job.id, asset.mimeType);
  const present = await stat(dest).then((s) => s.size > 0).catch(() => false);
  if (present) return dest;
  await setStep(deps, job.id, "download");
  await downloadSource(deps, asset, dest);
  return dest;
}

/** Fichiers d'une VERSION d'un short (un short refait ne reprend jamais le rendu de la version d'avant). */
function renderName(clip: Pick<ShortClipRow, "redoCount">, kind: "render" | "compressed"): string {
  return `${kind}-v${clip.redoCount ?? 0}.mp4`;
}

/** Le short est toujours dans la version de cette tâche (pas refait entre-temps) : sa ligne fraîche, sinon null. */
async function sameVersion(deps: MontagePipelineDeps, clip: Pick<ShortClipRow, "id" | "redoCount">): Promise<ShortClipRow | null> {
  const fresh = await loadClip(deps, clip.id);
  if (!fresh || (fresh.redoCount ?? 0) !== (clip.redoCount ?? 0) || fresh.status === "CANCELLED" || fresh.status === "REJECTED") return null;
  return fresh;
}

async function stillActive(deps: MontagePipelineDeps, jobId: string, clipId?: string): Promise<boolean> {
  const job = await deps.prisma.montageJob.findUnique({ where: { id: jobId }, select: { status: true } });
  if (!job || isTerminalJob(job.status)) return false;
  if (!clipId) return true;
  const clip = await deps.prisma.shortClip.findUnique({ where: { id: clipId }, select: { status: true } });
  return !!clip && clip.status !== "CANCELLED" && clip.status !== "REJECTED";
}

// ---------------------------------------------------------------------------------------------------------------------
// Création et plan

export type CreateMontageJobInput = {
  sourceAssetId: string;
  instructions: MontageInstructions;
  chatId?: string | number | bigint | null;
  instructionsMsgId?: number | bigint | null;
  createdById?: string | null;
  universe?: string;
};

export async function createMontageJob(deps: MontagePipelineDeps, input: CreateMontageJobInput): Promise<{ id: string; jobId: string }> {
  const asset = await deps.prisma.mediaAsset.findUnique({ where: { id: input.sourceAssetId }, select: { id: true, kind: true, size: true, duration: true } });
  if (!asset || asset.kind !== "LONG_VIDEO") throw new MontageRefused("Je ne retrouve pas la vidéo à monter : renvoie-la-moi.");
  const refusal = sourceRefusal({ sizeBytes: asset.size, durationMs: typeof asset.duration === "number" ? asset.duration * 1000 : null });
  if (refusal) throw new MontageRefused(refusal);
  const created = await deps.prisma.montageJob.create({
    data: {
      sourceAssetId: input.sourceAssetId,
      instructions: JSON.parse(JSON.stringify(input.instructions)),
      instructionsMsgId: input.instructionsMsgId != null ? BigInt(input.instructionsMsgId) : null,
      chatId: input.chatId != null ? String(input.chatId) : null,
      createdById: input.createdById ?? null,
      ...(input.universe ? { universe: input.universe } : {}),
      status: "PENDING",
    },
    select: { id: true },
  });
  await enqueue(deps, { type: "montage.analyze", montageJobId: created.id }, { jobId: montageTaskId({ type: "montage.analyze", montageJobId: created.id }) });
  await agentEvent(deps, "agents.montage.job_created", { jobId: created.id, sourceAssetId: input.sourceAssetId });
  return { id: created.id, jobId: created.id };
}

async function runAnalyze(deps: MontagePipelineDeps, jobId: string): Promise<MontageStepResult> {
  let job = await loadJob(deps, jobId);
  if (!job) return { ok: false, step: "montage.analyze", outcome: "skipped", reason: "travail introuvable" };
  if (job.status !== "PENDING" && job.status !== "ANALYZING")
    return { ok: false, step: "montage.analyze", outcome: "skipped", reason: `déjà ${job.status}` };
  const engine = engineOf(deps);
  await deps.prisma.montageJob.update({ where: { id: jobId }, data: { status: "ANALYZING", error: null } });
  const instructions = instructionsOf(job);

  let clips = (await deps.prisma.shortClip.findMany({ where: { montageJobId: jobId }, orderBy: { index: "asc" } })) as ShortClipRow[];
  if (clips.length === 0) {
    const source = await ensureSourceCopy(deps, job);
    await setStep(deps, jobId, "probe");
    let probe;
    try {
      probe = await engine.probeMedia(source);
    } catch (err) {
      throw new MontageRefused(`Ta vidéo est illisible (${String((err as Error)?.message ?? "fichier abîmé").slice(0, 120)}) : renvoie-la-moi.`);
    }
    const refusal = sourceRefusal({ durationMs: probe.durationMs });
    if (refusal) throw new MontageRefused(refusal);
    if (!probe.durationMs || probe.durationMs < MONTAGE_LIMITS.minShortSec * 1000)
      throw new MontageRefused("Ta vidéo est trop courte pour en tirer des shorts (5 s au moins).");
    const meta: SourceMeta = { durationMs: probe.durationMs, width: probe.width, height: probe.height, videoCodec: probe.videoCodec, fpsRaw: probe.fpsRaw, sizeBytes: probe.sizeBytes };
    await setStep(deps, jobId, "analyze", { sourceMeta: meta });
    const dir = framesDir(deps, jobId);
    await mkdir(dir, { recursive: true });
    const frames = await engine.extractFrames({ source, dir, everySec: MONTAGE_LIMITS.frameEverySec, width: MONTAGE_LIMITS.frameWidth, durationMs: probe.durationMs });
    const maxShorts = Math.max(1, Math.round(await settingNumber(deps, MONTAGE_SETTINGS.maxShortsPerJob.key, MONTAGE_SETTINGS.maxShortsPerJob.value)));
    const planned = await engine.planCuts({ frames, probe, instructions, maxShorts });
    const kept = keepPlanned(planned, probe.durationMs, instructions, maxShorts);
    if (kept.length === 0) throw new MontageRefused("Je n'ai trouvé aucun moment à couper dans ta vidéo.");
    if (!(await stillActive(deps, jobId))) {
      // Annulé pendant l'analyse : la copie de la source et les images faites entre-temps partent tout de suite.
      await cleanupJob(deps, jobId, { final: true });
      return { ok: false, step: "montage.analyze", outcome: "skipped", reason: "montage annulé" };
    }
    // Une ligne par moment (index unique par travail : une reprise ne double rien).
    for (const [i, p] of kept.entries()) {
      await deps.prisma.shortClip.create({
        data: {
          montageJobId: jobId,
          index: i + 1,
          startMs: p.startMs,
          endMs: p.endMs,
          durationMs: clipOutputMs({ startMs: p.startMs, endMs: p.endMs, speed: instructions.speed }),
          description: p.description.slice(0, 300),
          score: Math.max(1, Math.min(10, Math.round(p.score))),
          format: instructions.format,
          pipPosition: instructions.pipPosition,
          speed: instructions.speed,
          subtitles: instructions.subtitles,
          overlayText: instructions.overlayText,
          status: "PLANNED",
        },
      });
    }
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    clips = (await deps.prisma.shortClip.findMany({ where: { montageJobId: jobId }, orderBy: { index: "asc" } })) as ShortClipRow[];
  }

  job = (await loadJob(deps, jobId))!;
  // Plan envoyé avant d'être marqué : un plantage entre les deux le renvoie (jamais un plan perdu).
  let planMsgId = job.planMsgId;
  if (!planMsgId && deps.montage?.hooks?.onPlanReady) {
    const sent = await deps.montage.hooks.onPlanReady(deps, job, clips);
    if (sent && typeof sent.messageId === "number") planMsgId = BigInt(sent.messageId);
  }
  await deps.prisma.montageJob.update({ where: { id: jobId }, data: { status: "PLAN_SENT", currentStep: "plan_sent", planMsgId, attempts: 0 } });
  await agentEvent(deps, "agents.montage.plan_ready", { jobId, clips: clips.length });
  return { ok: true, step: "montage.analyze", outcome: `plan de ${clips.length} shorts` };
}

/** Moments gardés (pur) : coupes ramenées dans la vidéo, sans doublon, au plus `count` ou `maxShorts`. */
export function keepPlanned(planned: PlannedClip[], sourceMs: number, instructions: MontageInstructions, maxShorts: number): PlannedClip[] {
  const limit = Math.max(1, Math.min(maxShorts, instructions.count ?? maxShorts));
  const out: PlannedClip[] = [];
  for (const p of planned) {
    if (!Number.isFinite(p.startMs) || !Number.isFinite(p.endMs) || p.endMs <= p.startMs) continue;
    const c = clampCut(p, sourceMs, instructions.speed);
    if (out.some((o) => Math.abs(o.startMs - c.startMs) < 1000 && Math.abs(o.endMs - c.endMs) < 1000)) continue;
    out.push({ ...p, ...c });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Retouche du plan par le client, telle que Kevin la comprend (même forme que `PlanEdit` de `kevin-port.ts`) :
 * « enlève le 3 », « garde que les 5 meilleurs », « le 2, commence 2 s plus tôt », « 10 secondes au lieu de 15 ».
 * `index` null = tous les moments.
 */
export type MontagePlanEdit =
  | { kind: "remove"; index: number }
  | { kind: "keepBest"; count: number }
  | { kind: "shift"; index: number | null; startDeltaMs?: number; endDeltaMs?: number }
  | { kind: "duration"; index: number | null; seconds: number };

export type PlanEditResult = { ok: true; kept: number; removed: number[]; problems: string[] } | { ok: false; reason: string };

/** Applique des retouches au plan (sans le lancer) : travail encore au plan (PLAN_SENT). */
export async function editPlan(deps: MontagePipelineDeps, jobId: string, edits: readonly MontagePlanEdit[]): Promise<PlanEditResult> {
  const job = await loadJob(deps, jobId);
  if (!job) return { ok: false, reason: "Je ne retrouve pas ce montage." };
  if (job.status !== "PLAN_SENT") return { ok: false, reason: "Le plan de ce montage est déjà lancé." };
  const sourceMs = sourceMetaOf(job)?.durationMs ?? 0;
  const clips = (await deps.prisma.shortClip.findMany({ where: { montageJobId: jobId }, orderBy: { index: "asc" } })) as ShortClipRow[];
  const problems: string[] = [];
  const removed: number[] = [];
  const live = () => clips.filter((c) => c.status !== "CANCELLED");
  const cancel = async (clip: ShortClipRow) => {
    await deps.prisma.shortClip.update({ where: { id: clip.id }, data: { status: "CANCELLED" } });
    clip.status = "CANCELLED";
    removed.push(clip.index);
  };
  const targets = (index: number | null): ShortClipRow[] => {
    if (index === null) return live();
    const clip = live().find((c) => c.index === index);
    if (!clip) problems.push(`Il n'y a pas de short ${index} dans le plan.`);
    return clip ? [clip] : [];
  };
  for (const e of edits) {
    if (e.kind === "remove") {
      for (const c of targets(e.index)) await cancel(c);
    } else if (e.kind === "keepBest") {
      const n = Math.max(1, Math.round(e.count));
      const ranked = [...live()].sort((x, y) => (y.score ?? 0) - (x.score ?? 0) || x.index - y.index);
      for (const c of ranked.slice(n)) await cancel(c);
    } else {
      for (const clip of targets(e.index)) {
        const cut = applyTiming(
          clip,
          e.kind === "shift" ? { startDeltaMs: e.startDeltaMs, endDeltaMs: e.endDeltaMs } : { durationSec: e.seconds },
          sourceMs,
        );
        await deps.prisma.shortClip.update({ where: { id: clip.id }, data: { ...cut, durationMs: clipOutputMs({ ...cut, speed: clip.speed }) } });
        Object.assign(clip, cut);
      }
    }
  }
  return { ok: true, kept: live().length, removed, problems };
}

type Timing = { startDeltaMs?: number; endDeltaMs?: number; durationSec?: number };

function applyTiming(clip: Pick<ShortClipRow, "startMs" | "endMs" | "speed">, e: Timing, sourceMs: number): { startMs: number; endMs: number } {
  let start = clip.startMs + (e.startDeltaMs ?? 0);
  let end = clip.endMs + (e.endDeltaMs ?? 0);
  if (typeof e.durationSec === "number" && e.durationSec > 0) end = start + Math.round(e.durationSec * 1000 * (clip.speed && clip.speed > 0 ? clip.speed : 1));
  if (start < 0) {
    end -= start;
    start = 0;
  }
  return clampCut({ startMs: start, endMs: end }, sourceMs, clip.speed);
}

/**
 * Accord du client sur le plan (« ok », « ok sauf le 3 ») : retouches appliquées, puis une tâche montage.cut par short
 * gardé. Rejoué (double « ok ») : rien n'est relancé.
 */
export async function approvePlan(deps: MontagePipelineDeps, jobId: string, edits: readonly MontagePlanEdit[] = [], _actor?: unknown): Promise<PlanEditResult> {
  const edited = await editPlan(deps, jobId, edits);
  if (!edited.ok) return edited;
  if (edited.kept === 0) {
    await cancelJob(deps, jobId);
    return { ok: false, reason: "Plus aucun short dans le plan : j'arrête ce montage." };
  }
  const claimed = await deps.prisma.montageJob.updateMany({
    where: { id: jobId, status: "PLAN_SENT" },
    data: { status: "CUTTING", currentStep: "cut", planApprovedAt: nowOf(deps) },
  });
  if (claimed.count === 0) return { ok: false, reason: "Le plan de ce montage est déjà lancé." };
  const clips = (await deps.prisma.shortClip.findMany({ where: { montageJobId: jobId, status: "PLANNED" }, orderBy: { index: "asc" } })) as ShortClipRow[];
  for (const c of clips) await enqueueClipStep(deps, "montage.cut", c);
  await agentEvent(deps, "agents.montage.plan_approved", { jobId, clips: clips.length, removed: edited.removed });
  return edited;
}

// ---------------------------------------------------------------------------------------------------------------------
// Short : sous-titres, rendu, contrôle, rangement, aperçu

type ClipCtx = { job: MontageJobRow; clip: ShortClipRow };

async function loadClipCtx(deps: MontagePipelineDeps, jobId: string, clipId: string): Promise<ClipCtx | string> {
  const job = await loadJob(deps, jobId);
  if (!job) return "travail introuvable";
  // Tâche restée en file après la fin du montage (annulé pendant un rendu) : ce qu'elle a laissé sur le disque part.
  if (isTerminalJob(job.status)) {
    await cleanupJob(deps, jobId, { final: true });
    return `montage ${job.status}`;
  }
  const clip = await loadClip(deps, clipId);
  if (!clip || clip.montageJobId !== jobId) return "short introuvable";
  if ((SETTLED_CLIP_STATUSES as readonly string[]).includes(clip.status)) {
    await cleanupClip(deps, jobId, clipId);
    return `short ${clip.status}`;
  }
  if (clip.status === "PREVIEW_SENT") return "aperçu déjà envoyé";
  return { job, clip };
}

async function renderSpec(deps: MontagePipelineDeps, ctx: ClipCtx, source: string, output: string, srtPath: string | null): Promise<ShortRenderSpec> {
  const meta = sourceMetaOf(ctx.job);
  return {
    source,
    output,
    startMs: ctx.clip.startMs,
    endMs: ctx.clip.endMs,
    format: ctx.clip.format as ShortFormat,
    pipPosition: ctx.clip.pipPosition as PipPosition,
    speed: ctx.clip.speed ?? null,
    srtPath,
    subtitleStyle: await settingString(deps, MONTAGE_SETTINGS.subtitleStyle.key, MONTAGE_SETTINGS.subtitleStyle.value),
    overlayText: ctx.clip.overlayText ?? null,
    fontFile: deps.montage?.fontFile ?? null,
    crf: Math.round(await settingNumber(deps, MONTAGE_SETTINGS.crf.key, MONTAGE_SETTINGS.crf.value)),
    preset: await settingString(deps, MONTAGE_SETTINGS.preset.key, MONTAGE_SETTINGS.preset.value),
    sourceCodec: meta?.videoCodec ?? null,
    fpsRaw: meta?.fpsRaw ?? null,
  };
}

/** Segments horodatés depuis le début du passage → horodatage du short (vitesse appliquée). Pur. */
export function scaleSegments(segments: SubtitleSegment[], speed: number | null): SubtitleSegment[] {
  const s = speed && speed > 0 ? speed : 1;
  if (s === 1) return segments;
  return segments.map((x) => ({ ...x, startMs: Math.round(x.startMs / s), endMs: Math.round(x.endMs / s) }));
}

type PendingSubtitles = { segments: SubtitleSegment[]; uncertain: UncertainSegment[] };

function pendingOf(v: unknown): PendingSubtitles | null {
  const p = v as Partial<PendingSubtitles> | null;
  return p && Array.isArray(p.segments) && Array.isArray(p.uncertain) ? (p as PendingSubtitles) : null;
}

async function runCut(deps: MontagePipelineDeps, jobId: string, clipId: string): Promise<MontageStepResult> {
  const ctx = await loadClipCtx(deps, jobId, clipId);
  if (typeof ctx === "string") return { ok: false, step: "montage.cut", outcome: "skipped", reason: ctx };
  const { job, clip } = ctx;
  // Short déjà rangé (reprise) : jamais refait, on reprend à l'aperçu.
  if (clip.assetId) {
    await enqueueClipStep(deps, "montage.preview", clip);
    return { ok: true, step: "montage.cut", outcome: "déjà fabriqué" };
  }
  await deps.prisma.shortClip.update({ where: { id: clip.id }, data: { status: "CUTTING" } });
  await markJobWorking(deps, job, "CUTTING", "cut");
  // SRT vérifié = texte écrit, même vide (passage sans parole : rien à sous-titrer, jamais une boucle cut ↔ dress).
  if (clip.subtitles && clip.subtitlesSrt === null) {
    if (pendingOf(clip.subtitlesPending)) return { ok: true, step: "montage.cut", outcome: "attend la réponse du client sur les sous-titres" };
    const engine = engineOf(deps);
    const source = await ensureSourceCopy(deps, job);
    const dir = clipDir(deps, jobId, clip.id);
    await mkdir(dir, { recursive: true });
    const wav = join(dir, "audio.wav");
    await engine.extractAudioSegment({ source, startMs: clip.startMs, endMs: clip.endMs, output: wav });
    const durationMs = clip.endMs - clip.startMs;
    const language = (await readSetting(deps, "montage.language").catch(() => null)) as string | null;
    const first = await engine.transcribeClip({ wavPath: wav, durationMs, language: typeof language === "string" ? language : null });
    // Deux écoutes INDÉPENDANTES (la seconde sans biais) : un mot deviné par le biais est contredit, jamais confirmé.
    const second = await engine.transcribeClip({ wavPath: wav, durationMs, language: typeof language === "string" ? language : null, independent: true });
    const threshold = await settingNumber(deps, MONTAGE_SETTINGS.subtitleConfidence.key, MONTAGE_SETTINGS.subtitleConfidence.value);
    const verified = await engine.verifySubtitles({ transcripts: [first, second], wavPath: wav, threshold });
    await rm(wav, { force: true }).catch(() => undefined);
    const segments = scaleSegments(verified.segments, clip.speed);
    if (!(await stillActive(deps, jobId, clip.id))) return { ok: false, step: "montage.cut", outcome: "skipped", reason: "short abandonné" };
    if (verified.uncertain.length > 0) {
      const uncertain = verified.uncertain.map((u) => ({ ...u, atMs: Math.round(u.atMs / (clip.speed && clip.speed > 0 ? clip.speed : 1)) }));
      const pending: PendingSubtitles = { segments, uncertain };
      const updated = (await deps.prisma.shortClip.update({ where: { id: clip.id }, data: { subtitlesPending: JSON.parse(JSON.stringify(pending)) } })) as ShortClipRow;
      await deps.montage?.hooks?.onSubtitleDoubt?.(deps, job, updated, uncertain);
      await agentEvent(deps, "agents.montage.subtitle_doubt", { jobId, clipId: clip.id, count: uncertain.length });
      return { ok: true, step: "montage.cut", outcome: "attend la réponse du client sur les sous-titres" };
    }
    await deps.prisma.shortClip.update({ where: { id: clip.id }, data: { subtitlesSrt: engine.subtitlesToSrt(segments), subtitlesPending: Prisma.DbNull } });
  }
  await enqueueClipStep(deps, "montage.dress", clip);
  return { ok: true, step: "montage.cut", outcome: clip.subtitles ? "sous-titres vérifiés" : "sans sous-titres" };
}

/**
 * Réponse du client sur des passages incertains (« c'est martingale ») : `answers` par numéro de segment. Tous
 * tranchés → SRT écrit et le short repart au rendu ; sinon il attend encore les autres.
 */
export async function resolveSubtitleDoubt(
  deps: MontagePipelineDeps,
  clipId: string,
  answer: { index: number; text: string } | Array<{ index: number; text: string }>,
  _actor?: unknown,
): Promise<{ ok: true; done: boolean; remaining: UncertainSegment[] } | { ok: false; reason: string }> {
  const clip = await loadClip(deps, clipId);
  if (!clip) return { ok: false, reason: "Je ne retrouve pas ce short." };
  const pending = pendingOf(clip.subtitlesPending);
  if (!pending) return { ok: false, reason: "Je n'attends rien sur les sous-titres de ce short." };
  const answers = Array.isArray(answer) ? answer : [answer];
  const engine = engineOf(deps);
  let segments = pending.segments.map((s) => ({ ...s }));
  const answered = new Set<number>();
  for (const a of answers) {
    const text = a.text.trim();
    if (!segments[a.index] || !text) continue;
    const uncertain = pending.uncertain.find((u) => u.index === a.index) ?? null;
    segments = engine.applyClientCorrection(segments, a.index, text, uncertain);
    segments[a.index] = { ...segments[a.index]!, confidence: 1 };
    answered.add(a.index);
  }
  const remaining = pending.uncertain.filter((u) => !answered.has(u.index));
  if (remaining.length > 0) {
    await deps.prisma.shortClip.update({ where: { id: clip.id }, data: { subtitlesPending: JSON.parse(JSON.stringify({ segments, uncertain: remaining })) } });
    return { ok: true, done: false, remaining };
  }
  const srt = engine.subtitlesToSrt(segments);
  await deps.prisma.shortClip.update({ where: { id: clip.id }, data: { subtitlesSrt: srt, subtitlesPending: Prisma.DbNull } });
  await enqueueClipStep(deps, "montage.dress", clip);
  await agentEvent(deps, "agents.montage.subtitle_resolved", { clipId });
  return { ok: true, done: true, remaining: [] };
}

async function runDress(deps: MontagePipelineDeps, jobId: string, clipId: string): Promise<MontageStepResult> {
  const ctx = await loadClipCtx(deps, jobId, clipId);
  if (typeof ctx === "string") return { ok: false, step: "montage.dress", outcome: "skipped", reason: ctx };
  const { job, clip } = ctx;
  if (clip.assetId) {
    await enqueueClipStep(deps, "montage.preview", clip);
    return { ok: true, step: "montage.dress", outcome: "déjà fabriqué" };
  }
  // Jamais de sous-titre approximatif : sans SRT vérifié, retour aux sous-titres (SRT vide = aucune parole, vérifié).
  if (clip.subtitles && clip.subtitlesSrt === null) {
    if (!pendingOf(clip.subtitlesPending)) await enqueueClipStep(deps, "montage.cut", clip);
    return { ok: true, step: "montage.dress", outcome: "sous-titres pas encore vérifiés" };
  }
  await deps.prisma.shortClip.update({ where: { id: clip.id }, data: { status: "DRESSING" } });
  await markJobWorking(deps, job, "DRESSING", "dress");
  const source = await ensureSourceCopy(deps, job);
  const dir = clipDir(deps, jobId, clip.id);
  await mkdir(dir, { recursive: true });
  let srtPath: string | null = null;
  if (clip.subtitles && clip.subtitlesSrt) {
    srtPath = join(dir, "subs.srt");
    await writeFile(srtPath, clip.subtitlesSrt, "utf8");
  }
  const output = join(dir, renderName(clip, "render"));
  await rm(output, { force: true }).catch(() => undefined);
  await engineOf(deps).renderShort(await renderSpec(deps, ctx, source, output, srtPath), { timeoutMs: MONTAGE_LIMITS.shortTimeoutMs });
  if (srtPath) await rm(srtPath, { force: true }).catch(() => undefined);
  await enqueueClipStep(deps, "montage.qc", clip);
  return { ok: true, step: "montage.dress", outcome: "rendu fait" };
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then((s) => s.isFile() && s.size > 0).catch(() => false);
}

function segmentsFromSrt(srt: string | null): SubtitleSegment[] {
  if (!srt) return [];
  const out: SubtitleSegment[] = [];
  const toMs = (t: string) => {
    const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(t);
    return m ? ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]!.padEnd(3, "0").slice(0, 3)) : 0;
  };
  for (const block of srt.replace(/\r/g, "").split(/\n\n+/)) {
    const lines = block.trim().split("\n");
    const timing = lines.find((l) => l.includes("-->"));
    if (!timing) continue;
    const [a, b] = timing.split("-->");
    const text = lines.slice(lines.indexOf(timing) + 1).join(" ").trim();
    if (text) out.push({ startMs: toMs(a ?? ""), endMs: toMs(b ?? ""), text, confidence: 1 });
  }
  return out;
}

async function failClipQc(deps: MontagePipelineDeps, ctx: ClipCtx, report: QcReport): Promise<void> {
  const updated = (await deps.prisma.shortClip.update({
    where: { id: ctx.clip.id },
    data: { status: "QC_FAILED", qc: JSON.parse(JSON.stringify(report)) },
  })) as ShortClipRow;
  await cleanupClip(deps, ctx.job.id, ctx.clip.id);
  await deps.montage?.hooks?.onQcFailed?.(deps, ctx.job, updated, report);
  await agentEvent(deps, "agents.montage.qc_failed", { jobId: ctx.job.id, clipId: ctx.clip.id, problems: report.problems });
  await refreshJobStatus(deps, ctx.job.id);
}

async function runQc(deps: MontagePipelineDeps, jobId: string, clipId: string): Promise<MontageStepResult> {
  const ctx = await loadClipCtx(deps, jobId, clipId);
  if (typeof ctx === "string") return { ok: false, step: "montage.qc", outcome: "skipped", reason: ctx };
  const { job, clip } = ctx;
  if (clip.assetId) {
    await enqueueClipStep(deps, "montage.preview", clip);
    return { ok: true, step: "montage.qc", outcome: "déjà rangé" };
  }
  const engine = engineOf(deps);
  const dir = clipDir(deps, jobId, clip.id);
  const render = join(dir, renderName(clip, "render"));
  const compressedPath = join(dir, renderName(clip, "compressed"));
  // Compression déjà faite (reprise) : le fichier compressé fait foi.
  let final = clip.compressed && (await exists(compressedPath)) ? compressedPath : render;
  if (!(await exists(final))) {
    // Rendu perdu (redémarrage, disque nettoyé) : on le refait, la compression aussi si besoin.
    if (clip.compressed) await deps.prisma.shortClip.update({ where: { id: clip.id }, data: { compressed: false } });
    await enqueueClipStep(deps, "montage.dress", clip);
    return { ok: true, step: "montage.qc", outcome: "rendu à refaire" };
  }
  await deps.prisma.shortClip.update({ where: { id: clip.id }, data: { status: "QC" } });
  await markJobWorking(deps, job, "QC", "qc");
  const expectedDurationMs = clipOutputMs(clip);
  let report = await engine.qcShort({ path: final, expectedDurationMs, format: clip.format as ShortFormat }, { timeoutMs: MONTAGE_LIMITS.shortTimeoutMs });
  // Le poids n'est pas un échec : il déclenche la compression (une seule fois).
  const weightOnly = (r: QcReport) => r.problems.filter((p) => !/\bmo\b|poids|lourd/i.test(p));
  const problems = weightOnly(report);
  if (problems.length === 0 && clip.subtitles && clip.subtitlesSrt) {
    const read = await engine.checkSubtitleReadability({ path: final, dir, segments: segmentsFromSrt(clip.subtitlesSrt), durationMs: expectedDurationMs });
    if (!read.ok) problems.push(...(read.problems.length ? read.problems : ["sous-titres difficiles à lire"]));
  }
  if (problems.length > 0) {
    await failClipQc(deps, ctx, { ...report, ok: false, problems });
    return { ok: true, step: "montage.qc", outcome: "contrôle qualité raté" };
  }
  let compressed = clip.compressed;
  if (report.sizeBytes > MONTAGE_LIMITS.telegramVideoMaxBytes) {
    if (compressed) {
      await failClipQc(deps, ctx, { ...report, ok: false, problems: [`${Math.round(report.sizeBytes / 1024 / 1024)} Mo même compressé : plus que les 50 Mo de Telegram`] });
      return { ok: true, step: "montage.qc", outcome: "trop lourd même compressé" };
    }
    // Seconde et dernière passe, depuis la SOURCE (jamais depuis le short).
    const source = await ensureSourceCopy(deps, job);
    let srtPath: string | null = null;
    if (clip.subtitles && clip.subtitlesSrt) {
      srtPath = join(dir, "subs.srt");
      await writeFile(srtPath, clip.subtitlesSrt, "utf8");
    }
    await engine.compressShort(await renderSpec(deps, ctx, source, compressedPath, srtPath), MONTAGE_LIMITS.compressCrfStep, { timeoutMs: MONTAGE_LIMITS.shortTimeoutMs });
    if (srtPath) await rm(srtPath, { force: true }).catch(() => undefined);
    // Short refait pendant la compression : rien n'est écrit sur la nouvelle version.
    if (!(await sameVersion(deps, clip))) return { ok: false, step: "montage.qc", outcome: "skipped", reason: "short refait entre-temps" };
    await deps.prisma.shortClip.update({ where: { id: clip.id }, data: { compressed: true } });
    compressed = true;
    await rm(render, { force: true }).catch(() => undefined);
    final = compressedPath;
    report = await engine.qcShort({ path: final, expectedDurationMs, format: clip.format as ShortFormat }, { timeoutMs: MONTAGE_LIMITS.shortTimeoutMs });
    const after = weightOnly(report);
    if (after.length > 0 || report.sizeBytes > MONTAGE_LIMITS.telegramVideoMaxBytes) {
      await failClipQc(deps, ctx, {
        ...report,
        ok: false,
        problems: after.length ? after : [`${Math.round(report.sizeBytes / 1024 / 1024)} Mo même compressé : plus que les 50 Mo de Telegram`],
      });
      return { ok: true, step: "montage.qc", outcome: "contrôle qualité raté après compression" };
    }
  }
  if (!(await stillActive(deps, jobId, clip.id))) return { ok: false, step: "montage.qc", outcome: "skipped", reason: "short abandonné" };
  const probe = await engine.probeMedia(final);
  // Short refait pendant le contrôle : l'ancien rendu n'est jamais rangé pour la nouvelle version.
  const fresh = await sameVersion(deps, clip);
  if (!fresh) return { ok: false, step: "montage.qc", outcome: "skipped", reason: "short refait entre-temps" };
  await setStep(deps, jobId, "preview");
  await storeShort(deps, { path: final, clip: fresh, probe, job, compressed });
  await deps.prisma.shortClip.updateMany({
    where: { id: clip.id, redoCount: clip.redoCount ?? 0 },
    data: { qc: JSON.parse(JSON.stringify({ ...report, ok: true, problems: [] })), durationMs: probe.durationMs },
  });
  await cleanupClip(deps, jobId, clip.id);
  await enqueueClipStep(deps, "montage.preview", clip);
  return { ok: true, step: "montage.qc", outcome: compressed ? "contrôle passé, compressé, rangé" : "contrôle passé, rangé" };
}

async function runPreview(deps: MontagePipelineDeps, jobId: string, clipId: string): Promise<MontageStepResult> {
  const ctx = await loadClipCtx(deps, jobId, clipId);
  if (typeof ctx === "string") return { ok: false, step: "montage.preview", outcome: "skipped", reason: ctx };
  const { job, clip } = ctx;
  if (!clip.assetId) {
    await enqueueClipStep(deps, "montage.qc", clip);
    return { ok: true, step: "montage.preview", outcome: "short pas encore rangé" };
  }
  const asset = await deps.prisma.mediaAsset.findUnique({ where: { id: clip.assetId }, select: { id: true, size: true, width: true, height: true, telegramRef: true } });
  const ref = (asset?.telegramRef ?? {}) as { fileId?: string; fileUniqueId?: string; messageId?: number; chatId?: string };
  const hook = deps.montage?.hooks?.onPreviewReady;
  if (!hook) return { ok: false, step: "montage.preview", outcome: "skipped", reason: "aperçu non branché" };
  // Phase 30 : dernier verrou du QA Global avant tout aperçu (jamais montré ni publié sans approbation).
  const qa = await gateShortPreview(deps, { clip, asset, theme: instructionsOf(job).theme }, {
    redo: async (note, resetSubtitles) => {
      const r = await redoClip(deps, clip.id, { note });
      if (r.ok && resetSubtitles) await deps.prisma.shortClip.updateMany({ where: { id: clip.id, redoCount: r.clip.redoCount }, data: { subtitlesSrt: null, subtitlesPending: Prisma.DbNull } as never });
    },
    retryLater: async (delayMs) => {
      const task = { type: "montage.preview", montageJobId: clip.montageJobId, shortClipId: clip.id } as MontageQueueJob;
      await enqueue(deps, task, { jobId: `${montageTaskId(task, clip.redoCount)}-qa${nowOf(deps).getTime()}`, delayMs });
    },
    markFailed: async (problems, qaInfo) => {
      const base = (clip.qc && typeof clip.qc === "object" ? clip.qc : {}) as Record<string, unknown>;
      await deps.prisma.shortClip.updateMany({
        where: { id: clip.id, redoCount: clip.redoCount ?? 0 },
        data: { status: "QC_FAILED", qc: JSON.parse(JSON.stringify({ ...base, ok: false, problems, qa: qaInfo })) },
      });
      await refreshJobStatus(deps, jobId);
    },
  });
  if (!qa.go) return { ok: true, step: "montage.preview", outcome: qa.outcome };
  const sent = await hook(deps, job, clip, {
    assetId: clip.assetId,
    created: false,
    fileId: ref.fileId ?? "",
    fileUniqueId: ref.fileUniqueId ?? "",
    messageId: ref.messageId ?? 0,
    chatId: ref.chatId ?? "",
    sizeBytes: asset?.size ?? 0,
    durationMs: clip.durationMs,
    width: asset?.width ?? 0,
    height: asset?.height ?? 0,
    compressed: clip.compressed,
  });
  // Short refait pendant l'envoi de l'aperçu : la nouvelle version ne passe pas pour « aperçu envoyé ».
  const marked = await deps.prisma.shortClip.updateMany({
    where: { id: clip.id, redoCount: clip.redoCount ?? 0, assetId: clip.assetId },
    data: { status: "PREVIEW_SENT", previewMsgId: sent && typeof sent.messageId === "number" ? BigInt(sent.messageId) : null },
  });
  if (marked.count === 0) return { ok: false, step: "montage.preview", outcome: "skipped", reason: "short refait entre-temps" };
  await agentEvent(deps, "agents.montage.preview_sent", { jobId, clipId: clip.id, assetId: clip.assetId });
  await refreshJobStatus(deps, jobId);
  return { ok: true, step: "montage.preview", outcome: "aperçu envoyé" };
}

// ---------------------------------------------------------------------------------------------------------------------
// Statut du travail, décisions, refabrication, annulation

/**
 * Statut du travail d'après ses shorts : tous tranchés (validés, refusés, abandonnés, ratés) → DONE (et ménage) ;
 * tous en aperçu au moins → PREVIEW ; sinon CUTTING. `shortCount` = shorts rangés.
 */
export async function refreshJobStatus(deps: MontagePipelineDeps, jobId: string): Promise<string | null> {
  const job = await loadJob(deps, jobId);
  if (!job) return null;
  const clips = (await deps.prisma.shortClip.findMany({ where: { montageJobId: jobId } })) as ShortClipRow[];
  const shortCount = clips.filter((c) => c.assetId).length;
  if (isTerminalJob(job.status) || !job.planApprovedAt) {
    if (shortCount !== job.shortCount) await deps.prisma.montageJob.update({ where: { id: jobId }, data: { shortCount } });
    return job.status;
  }
  const live = clips.filter((c) => c.status !== "CANCELLED");
  const settled = live.every((c) => (SETTLED_CLIP_STATUSES as readonly string[]).includes(c.status));
  const previewed = live.every((c) => c.status === "PREVIEW_SENT" || (SETTLED_CLIP_STATUSES as readonly string[]).includes(c.status));
  const status = settled ? "DONE" : previewed ? "PREVIEW" : "CUTTING";
  await deps.prisma.montageJob.update({
    where: { id: jobId },
    data: { status, shortCount, ...(settled ? { completedAt: nowOf(deps), currentStep: "done" } : {}) },
  });
  if (settled) {
    await finishJobFiles(deps, jobId);
    await agentEvent(deps, "agents.montage.job_done", { jobId, shorts: shortCount, approved: live.filter((c) => c.status === "APPROVED").length });
  }
  return status;
}

/**
 * Travail fini : ses fichiers de travail partent. Hors du worker (webhook de Kevin, site : dernier ✅, « annule ») le
 * disque n'est pas le bon (autre service) : le ménage est confié au worker par une tâche `montage.cleanup` (qui efface
 * tout de suite les dossiers des travaux finis), sinon la copie de la source (jusqu'à 2 Go) resterait jusqu'au ménage
 * quotidien.
 */
async function finishJobFiles(deps: MontagePipelineDeps, jobId: string): Promise<void> {
  await cleanupJob(deps, jobId, { final: true });
  if (deps.montage?.workDir || !deps.montage?.enqueue) return;
  await deps.montage
    .enqueue({ type: "montage.cleanup" } as unknown as MontageQueueJob, { jobId: `montage-${jobId}-cleanup` })
    .catch((err: unknown) => deps.logger?.warn({ err: (err as Error)?.message, jobId }, "[montage] ménage du travail non mis en file"));
}

/** Décision du client sur un aperçu (Valider / Refuser) ; « Modifier » passe par `redoClip`. */
export async function setClipDecision(
  deps: MontagePipelineDeps,
  clipId: string,
  decision: "APPROVED" | "REJECTED",
  feedback?: string | null,
): Promise<{ ok: true; jobStatus: string | null } | { ok: false; reason: string }> {
  const clip = await loadClip(deps, clipId);
  if (!clip) return { ok: false, reason: "Je ne retrouve pas ce short." };
  if (decision === "APPROVED" && !clip.assetId) return { ok: false, reason: "Ce short n'est pas encore prêt." };
  if (clip.status === "CANCELLED") return { ok: false, reason: "Ce short a été retiré du montage." };
  await deps.prisma.shortClip.update({ where: { id: clipId }, data: { status: decision, ...(feedback ? { clientFeedback: feedback.slice(0, 500) } : {}) } });
  await agentEvent(deps, decision === "APPROVED" ? "agents.montage.short_approved" : "agents.montage.short_rejected", { clipId, jobId: clip.montageJobId });
  return { ok: true, jobStatus: await refreshJobStatus(deps, clip.montageJobId) };
}

/**
 * Retouche d'un short déjà fabriqué (« le 5, raccourcis de 2 secondes », « change la cam », « ajoute un texte ») ; même
 * forme que `ClipChange` de `kevin-port.ts`. `note` : la phrase du client (gardée dans `clientFeedback`).
 */
export type MontageClipChange = {
  startDeltaMs?: number;
  endDeltaMs?: number;
  durationSec?: number;
  format?: ShortFormat;
  pipPosition?: PipPosition;
  /** null = retirer le texte. */
  overlayText?: string | null;
  subtitles?: boolean;
  speed?: number | null;
  note?: string | null;
};

const PIP_WORDS: Array<[RegExp, PipPosition]> = [
  [/en haut à droite|haut droite/i, "TOP_RIGHT"],
  [/en haut à gauche|haut gauche/i, "TOP_LEFT"],
  [/en bas à droite|bas droite/i, "BOTTOM_RIGHT"],
  [/en bas à gauche|bas gauche/i, "BOTTOM_LEFT"],
  [/sans (la )?cam|enl[eè]ve la cam|retire la cam/i, "NONE"],
];

/**
 * Phrase libre (site : champ « Quoi changer ? ») → retouche (pur, règles simples) ; `null` si rien n'est compris.
 * Kevin, lui, passe la forme structurée qu'il a déjà comprise.
 */
export function parseClipChangeText(text: string): MontageClipChange | null {
  const t = text.trim();
  if (!t) return null;
  const out: MontageClipChange = { note: t.slice(0, 500) };
  const num = (v: string | undefined) => Number(String(v ?? "").replace(",", "."));
  let m = /raccourci\w*\s+(?:de\s+)?(\d+(?:[.,]\d+)?)\s*(?:s\b|sec)/i.exec(t);
  if (m) out.endDeltaMs = -Math.round(num(m[1]) * 1000);
  m = /(?:rallonge|allonge|prolonge)\w*\s+(?:de\s+)?(\d+(?:[.,]\d+)?)\s*(?:s\b|sec)/i.exec(t);
  if (m) out.endDeltaMs = Math.round(num(m[1]) * 1000);
  m = /(?:commence|démarre|début)\w*\s+(\d+(?:[.,]\d+)?)\s*(?:s\b|sec\w*)\s+plus\s+(tôt|tard)/i.exec(t);
  if (m) out.startDeltaMs = Math.round(num(m[1]) * 1000) * (m[2]!.toLowerCase() === "tôt" ? -1 : 1);
  m = /(?:en|à|fais(?:-le)?)\s+(\d+(?:[.,]\d+)?)\s*(?:s\b|sec\w*)(?!\s+plus)/i.exec(t) ?? /(\d+(?:[.,]\d+)?)\s*(?:s\b|sec\w*)\s+au lieu de/i.exec(t);
  if (m && out.endDeltaMs === undefined) out.durationSec = num(m[1]);
  for (const [re, pos] of PIP_WORDS) if (re.test(t)) {
    out.pipPosition = pos;
    break;
  }
  if (/sans sous-?titres?|enl[eè]ve les sous-?titres?/i.test(t)) out.subtitles = false;
  else if (/(?:avec|ajoute|mets?)\s+(?:des\s+|les\s+)?sous-?titres?/i.test(t)) out.subtitles = true;
  if (/\bvertical/i.test(t)) out.format = "VERTICAL_9_16";
  else if (/\bhorizontal/i.test(t)) out.format = "HORIZONTAL_16_9";
  else if (/\bcarré/i.test(t)) out.format = "SQUARE_1_1";
  m = /(?:texte|écris|marque)\s*[:«"“]\s*([^»"”]+)[»"”]?/i.exec(t);
  if (m) out.overlayText = m[1]!.trim();
  else if (/(?:enl[eè]ve|retire|sans)\s+(?:le\s+)?texte/i.test(t)) out.overlayText = null;
  m = /(?:vitesse|accél[eè]re|x)\s*(\d(?:[.,]\d+)?)/i.exec(t);
  if (m && num(m[1]) > 0) out.speed = num(m[1]);
  return Object.keys(out).length > 1 ? out : null;
}

export async function redoClip(
  deps: MontagePipelineDeps,
  clipId: string,
  input: MontageClipChange | string,
  _actor?: unknown,
): Promise<{ ok: true; clip: ShortClipRow } | { ok: false; reason: string }> {
  const change = typeof input === "string" ? parseClipChangeText(input) : input;
  if (!change) return { ok: false, reason: "Je n'ai pas compris quoi changer : dis-moi par exemple « raccourcis de 2 secondes » ou « cam en bas à gauche »." };
  const clip = await loadClip(deps, clipId);
  if (!clip) return { ok: false, reason: "Je ne retrouve pas ce short." };
  if (clip.status === "CANCELLED") return { ok: false, reason: "Ce short a été retiré du montage." };
  const job = await loadJob(deps, clip.montageJobId);
  if (!job || job.status === "FAILED" || job.status === "CANCELLED") return { ok: false, reason: "Ce montage est arrêté : renvoie-moi la vidéo pour en refaire un." };
  if (!job.planApprovedAt) return { ok: false, reason: "Le plan n'est pas encore lancé : dis-moi plutôt ce qu'il faut changer au plan." };
  const speed = change.speed !== undefined ? (change.speed && change.speed > 0 ? Math.min(2, Math.max(0.5, change.speed)) : null) : clip.speed;
  const timing = applyTiming({ ...clip, speed }, change, sourceMetaOf(job)?.durationMs ?? 0);
  const timingChanged = timing.startMs !== clip.startMs || timing.endMs !== clip.endMs || speed !== clip.speed;
  const subtitles = change.subtitles ?? clip.subtitles;
  const data = {
    ...timing,
    speed,
    durationMs: clipOutputMs({ ...timing, speed }),
    format: change.format ?? clip.format,
    pipPosition: change.pipPosition ?? clip.pipPosition,
    overlayText: change.overlayText !== undefined ? (change.overlayText?.trim() ? change.overlayText.trim().slice(0, 120) : null) : clip.overlayText,
    subtitles,
    // Nouveau passage ou nouvelle vitesse : les sous-titres se refont (jamais un SRT décalé).
    ...(timingChanged || !subtitles ? { subtitlesSrt: null, subtitlesPending: Prisma.DbNull } : {}),
    status: "REDO" as const,
    redoCount: (clip.redoCount ?? 0) + 1,
    assetId: null,
    previewMsgId: null,
    compressed: false,
    qc: Prisma.DbNull,
    ...(change.note ? { clientFeedback: change.note.slice(0, 500) } : {}),
  };
  const updated = (await deps.prisma.shortClip.update({ where: { id: clip.id }, data: data as never })) as ShortClipRow;
  await cleanupClip(deps, job.id, clip.id);
  if (job.status !== "CUTTING") await deps.prisma.montageJob.update({ where: { id: job.id }, data: { status: "CUTTING", completedAt: null, currentStep: "cut" } });
  await enqueueClipStep(deps, "montage.cut", updated);
  await agentEvent(deps, "agents.montage.short_redo", { jobId: job.id, clipId, redo: updated.redoCount });
  return { ok: true, clip: updated };
}

/** Arrêt d'un montage (« annule le montage ») : shorts non tranchés abandonnés, fichiers de travail effacés. */
export async function cancelJob(deps: MontagePipelineDeps, jobId: string, _actor?: unknown): Promise<{ ok: true; cancelledClips: number } | { ok: false; reason: string }> {
  const job = await loadJob(deps, jobId);
  if (!job) return { ok: false, reason: "Je ne retrouve pas ce montage." };
  if (isTerminalJob(job.status)) return { ok: false, reason: "Ce montage est déjà terminé." };
  await deps.prisma.montageJob.update({ where: { id: jobId }, data: { status: "CANCELLED", completedAt: nowOf(deps), currentStep: "done" } });
  const r = await deps.prisma.shortClip.updateMany({
    where: { montageJobId: jobId, status: { notIn: ["APPROVED", "REJECTED", "CANCELLED"] } },
    data: { status: "CANCELLED" },
  });
  await finishJobFiles(deps, jobId);
  await agentEvent(deps, "agents.montage.job_cancelled", { jobId, clips: r.count });
  return { ok: true, cancelledClips: r.count };
}

// ---------------------------------------------------------------------------------------------------------------------
// Entrée de la file et échecs

function reasonOf(err: unknown): string {
  return String((err as Error)?.message ?? err ?? "erreur").replace(/https?:\/\/\S+/g, "[adresse]").slice(0, 300);
}

async function failJob(deps: MontagePipelineDeps, jobId: string, reason: string): Promise<void> {
  const job = await loadJob(deps, jobId);
  if (!job || isTerminalJob(job.status)) return;
  const failed = (await deps.prisma.montageJob.update({ where: { id: jobId }, data: { status: "FAILED", error: reason, completedAt: nowOf(deps) } })) as MontageJobRow;
  await deps.prisma.shortClip.updateMany({ where: { montageJobId: jobId, status: { notIn: ["APPROVED", "REJECTED", "CANCELLED", "PREVIEW_SENT"] } }, data: { status: "CANCELLED" } });
  await cleanupJob(deps, jobId, { final: true });
  await agentEvent(deps, "agents.montage.job_failed", { jobId, reason });
  await deps.montage?.hooks?.onFailed?.(deps, failed, reason, null);
}

async function failClip(deps: MontagePipelineDeps, jobId: string, clipId: string, reason: string): Promise<void> {
  const job = await loadJob(deps, jobId);
  const clip = await loadClip(deps, clipId);
  if (!job || !clip || isTerminalJob(job.status) || (SETTLED_CLIP_STATUSES as readonly string[]).includes(clip.status)) return;
  const report: QcReport = { ok: false, durationMs: 0, width: 0, height: 0, sizeBytes: 0, blackSec: 0, silent: false, clipping: false, problems: [`fabrication impossible : ${reason}`] };
  const updated = (await deps.prisma.shortClip.update({ where: { id: clipId }, data: { status: "QC_FAILED", qc: JSON.parse(JSON.stringify(report)) } })) as ShortClipRow;
  await deps.prisma.montageJob.update({ where: { id: jobId }, data: { error: `short ${clip.index} : ${reason}` } });
  await cleanupClip(deps, jobId, clipId);
  await agentEvent(deps, "agents.montage.short_failed", { jobId, clipId, reason });
  await deps.montage?.hooks?.onFailed?.(deps, job, reason, updated);
  await refreshJobStatus(deps, jobId);
}

/**
 * Une tâche de la file `agents-montage`. `attempt` : essai en cours (1 à 3, BullMQ `attemptsMade + 1`). Erreur avant le
 * dernier essai : relancée (BullMQ réessaie avec une attente croissante) ; au dernier, ou pour un refus : échec
 * définitif annoncé par Kevin, la tâche se termine sans erreur.
 */
export async function runMontageStep(deps: MontagePipelineDeps, job: MontageQueueJob, opts: { attempt?: number } = {}): Promise<MontageStepResult> {
  try {
    switch (job.type) {
      case "montage.analyze":
        return await runAnalyze(deps, job.montageJobId);
      case "montage.cut":
        return await runCut(deps, job.montageJobId, job.shortClipId);
      case "montage.dress":
        return await runDress(deps, job.montageJobId, job.shortClipId);
      case "montage.qc":
        return await runQc(deps, job.montageJobId, job.shortClipId);
      case "montage.preview":
        return await runPreview(deps, job.montageJobId, job.shortClipId);
    }
  } catch (err) {
    const reason = reasonOf(err);
    const attempt = opts.attempt ?? 1;
    const definitive = err instanceof MontageRefused || attempt >= MONTAGE_LIMITS.maxAttempts;
    deps.logger?.warn({ type: job.type, montageJobId: job.montageJobId, attempt, reason }, "[montage] étape en échec");
    if (!definitive) {
      await deps.prisma.montageJob.update({ where: { id: job.montageJobId }, data: { error: reason, attempts: { increment: 1 } } }).catch(() => undefined);
      throw err;
    }
    if (job.type === "montage.analyze" || err instanceof MontageRefused) await failJob(deps, job.montageJobId, reason);
    else await failClip(deps, job.montageJobId, job.shortClipId, reason);
    return { ok: false, step: job.type, outcome: "failed", reason };
  }
  return { ok: false, step: (job as MontageQueueJob).type, outcome: "skipped", reason: "type inconnu" };
}

/**
 * Filet (toutes les 15 minutes) : remet en file ce qui n'avance plus depuis 30 min (tâche perdue après un redémarrage
 * de Redis) ; les identifiants de tâche stables empêchent tout doublon d'une tâche encore en file.
 */
export async function resumeStalledMontage(deps: MontagePipelineDeps, opts: { idleMs?: number } = {}): Promise<{ requeued: number }> {
  const before = new Date(nowOf(deps).getTime() - (opts.idleMs ?? 30 * 60_000));
  let requeued = 0;
  const jobs = (await deps.prisma.montageJob.findMany({ where: { status: { in: ["PENDING", "ANALYZING", "CUTTING", "DRESSING", "QC", "PREVIEW"] }, updatedAt: { lt: before } } })) as MontageJobRow[];
  for (const job of jobs) {
    if (job.status === "PENDING" || job.status === "ANALYZING") {
      await enqueue(deps, { type: "montage.analyze", montageJobId: job.id }, { jobId: montageTaskId({ type: "montage.analyze", montageJobId: job.id }) });
      requeued++;
      continue;
    }
    const clips = (await deps.prisma.shortClip.findMany({ where: { montageJobId: job.id, status: { in: ["PLANNED", "REDO", "CUTTING", "DRESSING", "QC"] }, updatedAt: { lt: before } } })) as ShortClipRow[];
    for (const c of clips) {
      if (pendingOf(c.subtitlesPending)) continue;
      const step = c.assetId ? "montage.preview" : c.status === "QC" ? "montage.qc" : c.status === "DRESSING" ? "montage.dress" : "montage.cut";
      await enqueueClipStep(deps, step, c);
      requeued++;
    }
  }
  return { requeued };
}

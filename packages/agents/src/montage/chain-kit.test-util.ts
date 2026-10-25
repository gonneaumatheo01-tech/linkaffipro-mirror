/**
 * Outils des tests de la chaîne du montage (chantier D) : base en mémoire (`createTestKit`), faux moteur (ffmpeg + IA
 * simulés, fichiers réels dans un dossier temporaire), faux Telegram (téléchargement, envoi de vidéo), file simulée et
 * crochets de Kevin enregistrés. Aucun réseau, aucun binaire. Jamais importé par le code de production.
 */
import { mkdtemp, readdir, rm, stat, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { vi } from "vitest";
import { createTestKit } from "../human/test-kit";
import type { MediaProbe, MontageInstructions, MontageQueueJob, PlannedClip, QcReport, ShortRenderSpec, SubtitleSegment, UncertainSegment } from "./contract";
import type { MontageEngine, MontageHooks, MontagePipelineDeps } from "./runtime";
import { runMontageStep } from "./pipeline";

export const INSTRUCTIONS: MontageInstructions = {
  theme: "roulette",
  format: "VERTICAL_9_16",
  durationTarget: 15,
  pipPosition: "TOP_RIGHT",
  subtitles: false,
  overlayText: null,
  count: null,
  speed: null,
  rawText: "découpe ça en shorts de 15 secondes, cam en haut à droite",
};

export type FakeEngineOptions = {
  sourceDurationMs?: number;
  plan?: PlannedClip[];
  /** Poids « annoncé » d'un rendu (le fichier réel reste petit) : sert au seuil de 50 Mo. */
  renderSize?: (spec: ShortRenderSpec, call: number) => number;
  compressSize?: number;
  uncertain?: UncertainSegment[];
  qcProblems?: (path: string) => string[];
  readable?: boolean;
  /** Erreurs à lever : méthode → nombre d'échecs avant de réussir (Infinity = toujours). */
  failures?: Partial<Record<keyof MontageEngine, number>>;
};

const MB = 1024 * 1024;

export function createFakeEngine(opts: FakeEngineOptions = {}) {
  const sourceDurationMs = opts.sourceDurationMs ?? 60_000;
  const sizes = new Map<string, number>();
  const durations = new Map<string, number>();
  const failures = { ...(opts.failures ?? {}) } as Record<string, number>;
  const renders: ShortRenderSpec[] = [];
  const compressions: Array<{ spec: ShortRenderSpec; crfStep: number }> = [];
  const srtSeen: string[] = [];
  const calls: Record<string, number> = {};
  const maybeFail = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
    if ((failures[name] ?? 0) > 0) {
      failures[name] = failures[name]! - 1;
      throw new Error(`${name} : panne simulée`);
    }
  };
  const segments: SubtitleSegment[] = [
    { startMs: 0, endMs: 2000, text: "Rien ne va plus", confidence: 0.99 },
    { startMs: 2000, endMs: 4000, text: "la martindale marche", confidence: 0.6 },
  ];
  const engine: MontageEngine = {
    async probeMedia(path) {
      maybeFail("probeMedia");
      const s = await stat(path);
      const isSource = /source\.\w+$/.test(path);
      const probe: MediaProbe = {
        durationMs: isSource ? sourceDurationMs : (durations.get(path) ?? 15_000),
        width: 1080,
        height: isSource ? 1080 : 1920,
        videoCodec: "h264",
        audioCodec: "aac",
        fps: 30,
        fpsRaw: "30/1",
        sizeBytes: sizes.get(path) ?? s.size,
        hasAudio: true,
      };
      if (isSource) probe.width = 1920;
      return probe;
    },
    async extractFrames(input) {
      maybeFail("extractFrames");
      await mkdir(input.dir, { recursive: true });
      const out = [];
      for (let i = 0; i < 4; i++) {
        const path = join(input.dir, `frame-${i + 1}.jpg`);
        await writeFile(path, "jpg");
        out.push({ path, atMs: i * input.everySec * 1000 });
      }
      return out;
    },
    async planCuts() {
      maybeFail("planCuts");
      return (
        opts.plan ?? [
          { startMs: 2000, endMs: 17_000, description: "Gros gain à la roulette", score: 9, why: "gain" },
          { startMs: 20_000, endMs: 35_000, description: "Série de mises", score: 8, why: "suspense" },
          { startMs: 40_000, endMs: 55_000, description: "Réaction", score: 6, why: "réaction" },
        ]
      );
    },
    async extractAudioSegment(input) {
      maybeFail("extractAudioSegment");
      await mkdir(dirname(input.output), { recursive: true });
      await writeFile(input.output, "RIFF....WAVE");
    },
    async transcribeClip() {
      maybeFail("transcribeClip");
      return segments.map((s) => ({ ...s }));
    },
    async verifySubtitles(input) {
      maybeFail("verifySubtitles");
      return { segments: input.transcripts[0], uncertain: opts.uncertain ?? [] };
    },
    subtitlesToSrt(segs) {
      return segs.map((s, i) => `${i + 1}\n00:00:0${Math.floor(s.startMs / 1000)},000 --> 00:00:0${Math.floor(s.endMs / 1000)},000\n${s.text}`).join("\n\n");
    },
    applyClientCorrection(segs, index, choice, uncertain) {
      const out = segs.map((s) => ({ ...s }));
      const current = uncertain?.alternatives[0];
      out[index] = { ...out[index]!, text: current && out[index]!.text.includes(current) ? out[index]!.text.replace(current, choice) : choice };
      return out;
    },
    async renderShort(spec) {
      maybeFail("renderShort");
      renders.push(spec);
      if (spec.srtPath) srtSeen.push(await readFile(spec.srtPath, "utf8"));
      await mkdir(dirname(spec.output), { recursive: true });
      await writeFile(spec.output, `short ${spec.startMs}-${spec.endMs} ${spec.pipPosition} ${spec.overlayText ?? ""} ${renders.length}`);
      sizes.set(spec.output, opts.renderSize?.(spec, renders.length) ?? 8 * MB);
      durations.set(spec.output, Math.round((spec.endMs - spec.startMs) / (spec.speed ?? 1)));
    },
    async qcShort(input) {
      maybeFail("qcShort");
      const problems = opts.qcProblems?.(input.path) ?? [];
      const report: QcReport = {
        ok: problems.length === 0,
        durationMs: durations.get(input.path) ?? input.expectedDurationMs,
        width: 1080,
        height: 1920,
        sizeBytes: sizes.get(input.path) ?? (await stat(input.path)).size,
        blackSec: 0,
        silent: false,
        clipping: false,
        problems,
      };
      return report;
    },
    async checkSubtitleReadability(input) {
      maybeFail("checkSubtitleReadability");
      await mkdir(input.dir, { recursive: true });
      for (let i = 1; i <= 3; i++) await writeFile(join(input.dir, `lisibilite-${i}.jpg`), "jpg");
      return opts.readable === false ? { ok: false, problems: ["texte trop petit"] } : { ok: true, problems: [] };
    },
    async compressShort(spec, crfStep) {
      maybeFail("compressShort");
      compressions.push({ spec, crfStep });
      await writeFile(spec.output, `compressed ${spec.startMs}-${spec.endMs} ${compressions.length}`);
      sizes.set(spec.output, opts.compressSize ?? 30 * MB);
      durations.set(spec.output, Math.round((spec.endMs - spec.startMs) / (spec.speed ?? 1)));
    },
  };
  return { engine, renders, compressions, srtSeen, calls, segments };
}

export type ChainKitOptions = FakeEngineOptions & { library?: boolean; sourceBytes?: number };

export async function createChainKit(opts: ChainKitOptions = {}) {
  const kit = createTestKit();
  const workDir = await mkdtemp(join(tmpdir(), "lap-montage-test-"));
  const fake = createFakeEngine(opts);
  const queue: Array<{ job: MontageQueueJob; jobId?: string }> = [];
  const downloads: Array<{ ref: { chatId: string; messageId: number; fileId?: string | null; sizeBytes?: number | null }; dest: string }> = [];
  const sentVideos: Array<{ chatId: string; path: string; caption: string }> = [];
  const hookCalls = { plan: 0, doubt: 0, qcFailed: 0, preview: 0, failed: [] as Array<{ reason: string; clipId: string | null }> };
  let msg = 5000;
  const hooks: MontageHooks = {
    onPlanReady: vi.fn(async () => {
      hookCalls.plan++;
      return { messageId: ++msg };
    }),
    onSubtitleDoubt: vi.fn(async () => {
      hookCalls.doubt++;
    }),
    onQcFailed: vi.fn(async () => {
      hookCalls.qcFailed++;
    }),
    onPreviewReady: vi.fn(async () => {
      hookCalls.preview++;
      return { messageId: ++msg };
    }),
    onFailed: vi.fn(async (_d, _j, reason, clip) => {
      hookCalls.failed.push({ reason, clipId: clip?.id ?? null });
    }),
  };
  // Valeurs par défaut des colonnes du montage (le faux client ne connaît pas le schéma).
  const shortModel = kit.prisma._model("shortClip");
  const createShort = shortModel.create.bind(shortModel);
  shortModel.create = (args: { data: Record<string, unknown> }) =>
    createShort({
      data: {
        assetId: null,
        subtitlesSrt: null,
        subtitlesPending: null,
        qc: null,
        compressed: false,
        previewMsgId: null,
        clientFeedback: null,
        redoCount: 0,
        speed: null,
        overlayText: null,
        ...args.data,
      },
    });
  const jobModel = kit.prisma._model("montageJob");
  const createJob = jobModel.create.bind(jobModel);
  jobModel.create = (args: { data: Record<string, unknown> }) =>
    createJob({ data: { teamKey: "montage", universe: "casino", currentStep: null, error: null, attempts: 0, sourceMeta: null, planMsgId: null, planApprovedAt: null, shortCount: 0, completedAt: null, ...args.data } });
  const assetModel = kit.prisma._model("mediaAsset");
  const createAsset = assetModel.create.bind(assetModel);
  assetModel.create = (args: { data: Record<string, unknown> }) =>
    createAsset({ data: { storage: "db", telegramRef: null, libraryMessageId: null, size: 0, sourceAssetId: null, ...args.data } });

  if (opts.library !== false) await kit.prisma.setting.create({ data: { key: "agents.libraryChannelId", value: "-1009999" } });
  let fileSeq = 0;
  const deps: MontagePipelineDeps = {
    ...kit.deps,
    downloadTelegramFile: vi.fn(async (ref, dest) => {
      downloads.push({ ref, dest });
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, Buffer.alloc(ref.sizeBytes && ref.sizeBytes < 4096 ? ref.sizeBytes : opts.sourceBytes ?? 2048, 1));
    }),
    sendVideo: vi.fn(async (req) => {
      sentVideos.push(req);
      fileSeq++;
      return { messageId: 9000 + fileSeq, fileId: `kevin-file-${fileSeq}`, fileUniqueId: `uniq-${fileSeq}` };
    }),
    montage: {
      engine: fake.engine,
      hooks,
      workDir,
      kevinBotId: async () => "bot-kevin",
      enqueue: vi.fn(async (job, o) => {
        // File idempotente : une tâche du même identifiant encore en attente n'est pas doublée.
        if (o?.jobId && queue.some((q) => q.jobId === o.jobId)) return;
        queue.push({ job, jobId: o?.jobId });
      }),
    },
  };

  /** Fait tourner la file jusqu'à vide (`attempt` 1 ; une erreur remonte au test). */
  async function drain(max = 200): Promise<void> {
    for (let i = 0; i < max && queue.length; i++) {
      const next = queue.shift()!;
      await runMontageStep(deps, next.job, { attempt: 1 });
    }
  }

  /** Comme BullMQ : jusqu'à 3 essais par tâche, l'erreur des 2 premiers est avalée (reprise). */
  async function drainWithRetries(max = 200): Promise<number> {
    let errors = 0;
    for (let i = 0; i < max && queue.length; i++) {
      const next = queue.shift()!;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await runMontageStep(deps, next.job, { attempt });
          break;
        } catch {
          errors++;
        }
      }
    }
    return errors;
  }

  async function filesIn(dir = workDir): Promise<string[]> {
    const out: string[] = [];
    const walk = async (d: string) => {
      for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
        const p = join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else out.push(p.slice(workDir.length + 1));
      }
    };
    await walk(dir);
    return out.sort();
  }

  async function sourceAsset(over: Record<string, unknown> = {}) {
    return kit.prisma.mediaAsset.create({
      data: {
        filename: "live.mp4",
        mimeType: "video/mp4",
        size: 2048,
        sha256: `src-${Math.random()}`,
        bytes: Buffer.alloc(0),
        duration: 60,
        kind: "LONG_VIDEO",
        storage: "telegram",
        telegramRef: { chatId: "4242", messageId: 77, fileId: "kevin-src", fileUniqueId: "src-uniq", via: "kevin", sizeBytes: 2048 },
        ...over,
      } as never,
    });
  }

  return {
    ...kit,
    deps,
    fake,
    queue,
    downloads,
    sentVideos,
    hookCalls,
    hooks,
    workDir,
    drain,
    drainWithRetries,
    filesIn,
    sourceAsset,
    clips: (jobId: string) => kit.tables("shortClip").filter((c) => c.montageJobId === jobId).sort((a, b) => Number(a.index) - Number(b.index)),
    job: (jobId: string) => kit.tables("montageJob").find((j) => j.id === jobId)!,
    async dispose() {
      await rm(workDir, { recursive: true, force: true });
    },
  };
}

import { mkdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MONTAGE_LIMITS } from "./contract";
import { createChainKit, INSTRUCTIONS } from "./chain-kit.test-util";
import { sweepMontageWorkDir } from "./cleanup";
import {
  approvePlan,
  cancelJob,
  clampCut,
  createMontageJob,
  keepPlanned,
  parseClipChangeText,
  redoClip,
  resolveSubtitleDoubt,
  resumeStalledMontage,
  runMontageStep,
  setClipDecision,
} from "./pipeline";
import { createLongVideoAsset } from "./source";

type Kit = Awaited<ReturnType<typeof createChainKit>>;
let kits: Kit[] = [];
async function kitOf(opts: Parameters<typeof createChainKit>[0] = {}): Promise<Kit> {
  const k = await createChainKit(opts);
  kits.push(k);
  return k;
}
afterEach(async () => {
  for (const k of kits) await k.dispose();
  kits = [];
});

const MB = 1024 * 1024;

async function startJob(k: Kit, instructions = INSTRUCTIONS) {
  const src = await createLongVideoAsset(k.deps, {
    chatId: "4242",
    messageId: 77,
    fileId: "kevin-src",
    fileUniqueId: `src-${Math.random()}`,
    fileName: "live.mp4",
    mimeType: "video/mp4",
    sizeBytes: 2048,
    durationSec: 60,
    width: 1920,
    height: 1080,
    createdById: null,
  });
  if (!src.ok) throw new Error(src.reason);
  const { jobId } = await createMontageJob(k.deps, { sourceAssetId: src.assetId, instructions, chatId: "4242", instructionsMsgId: 78, createdById: null });
  return { jobId, assetId: src.assetId };
}

describe("chaîne du montage", () => {
  it("de bout en bout : analyse → plan → accord → shorts → contrôle → rangement → aperçu → validation", async () => {
    const k = await kitOf();
    const { jobId, assetId } = await startJob(k);
    const source = k.tables("mediaAsset").find((a) => a.id === assetId)!;
    expect(source).toMatchObject({ kind: "LONG_VIDEO", storage: "telegram" });
    expect((source.bytes as Buffer).byteLength).toBe(0);

    await k.drain();
    expect(k.job(jobId)).toMatchObject({ status: "PLAN_SENT", currentStep: "plan_sent" });
    expect(k.hookCalls.plan).toBe(1);
    expect(k.clips(jobId).map((c) => c.status)).toEqual(["PLANNED", "PLANNED", "PLANNED"]);
    expect(k.downloads).toHaveLength(1);
    expect(k.downloads[0]!.ref).toMatchObject({ chatId: "4242", messageId: 77, fileId: "kevin-src" });
    // Images de l'analyse effacées dès le plan ; seule la copie de travail de la source reste.
    expect(await k.filesIn()).toEqual([`${jobId}/source.mp4`]);

    const r = await approvePlan(k.deps, jobId, [{ kind: "remove", index: 3 }, { kind: "shift", index: 2, startDeltaMs: -2000 }]);
    expect(r).toMatchObject({ ok: true, kept: 2, removed: [3] });
    await k.drain();

    const clips = k.clips(jobId);
    expect(clips.map((c) => c.status)).toEqual(["PREVIEW_SENT", "PREVIEW_SENT", "CANCELLED"]);
    expect(clips[1]!.startMs).toBe(18_000);
    expect(k.fake.renders).toHaveLength(2);
    // Un seul passage depuis la SOURCE (jamais depuis un short), réglages de qualité du contrat.
    for (const spec of k.fake.renders) {
      expect(spec.source).toMatch(/source\.mp4$/);
      expect(spec).toMatchObject({ crf: 18, preset: "slow", pipPosition: "TOP_RIGHT", format: "VERTICAL_9_16", sourceCodec: "h264", fpsRaw: "30/1" });
    }
    const shorts = k.tables("mediaAsset").filter((a) => a.kind === "SHORT");
    expect(shorts).toHaveLength(2);
    for (const s of shorts) {
      expect(s).toMatchObject({ storage: "telegram", teamKey: "montage", theme: "roulette", sourceAssetId: assetId });
      expect((s.bytes as Buffer).byteLength).toBe(0);
      expect(s.libraryMessageId).toBeGreaterThan(9000);
      expect(s.telegramRef).toMatchObject({ chatId: "-1009999", via: "library", botId: "bot-kevin" });
      expect(String(s.sha256)).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(k.tables("mediaAssetTelegramFile").filter((f) => f.botId === "bot-kevin")).toHaveLength(2);
    expect(k.sentVideos.every((v) => v.chatId === "-1009999")).toBe(true);
    expect(k.hookCalls.preview).toBe(2);
    expect(k.job(jobId)).toMatchObject({ status: "PREVIEW", shortCount: 2 });
    // Fichiers temporaires effacés après chaque short ; la source reste tant que le travail vit.
    expect(await k.filesIn()).toEqual([`${jobId}/source.mp4`]);

    await setClipDecision(k.deps, String(clips[0]!.id), "APPROVED");
    expect(k.job(jobId).status).toBe("PREVIEW");
    await setClipDecision(k.deps, String(clips[1]!.id), "REJECTED", "bof");
    expect(k.job(jobId)).toMatchObject({ status: "DONE", currentStep: "done" });
    expect(await k.filesIn()).toEqual([]);
  });

  it("reprise après un plantage à chaque étape : rien n'est refait deux fois", async () => {
    const k = await kitOf({ failures: { planCuts: 1, renderShort: 1, qcShort: 1 } });
    const { jobId } = await startJob(k);
    // Analyse : 1re tentative en échec, la reprise repart de la copie déjà téléchargée.
    const first = k.queue.shift()!;
    await expect(runMontageStep(k.deps, first.job, { attempt: 1 })).rejects.toThrow(/panne simulée/);
    expect(k.job(jobId)).toMatchObject({ status: "ANALYZING", attempts: 1 });
    await runMontageStep(k.deps, first.job, { attempt: 2 });
    expect(k.downloads).toHaveLength(1);
    expect(k.job(jobId).status).toBe("PLAN_SENT");
    await approvePlan(k.deps, jobId);
    const errors = await k.drainWithRetries();
    expect(errors).toBe(2);
    expect(k.clips(jobId).every((c) => c.status === "PREVIEW_SENT")).toBe(true);
    const renders = k.fake.renders.length;
    const sent = k.sentVideos.length;
    expect(sent).toBe(3);
    // Tâches rejouées (redémarrage, tâche en double) : un short rangé n'est jamais refait.
    for (const c of k.clips(jobId)) {
      for (const type of ["montage.cut", "montage.dress", "montage.qc", "montage.preview"] as const)
        await runMontageStep(k.deps, { type, montageJobId: jobId, shortClipId: String(c.id) });
    }
    await k.drain();
    expect(k.fake.renders.length).toBe(renders);
    expect(k.sentVideos.length).toBe(sent);
    expect(k.hookCalls.preview).toBe(3);
  });

  it("plantage entre le rangement et l'aperçu : la reprise envoie l'aperçu sans refaire le short", async () => {
    const k = await kitOf();
    const { jobId } = await startJob(k);
    await k.drain();
    await approvePlan(k.deps, jobId, [{ kind: "keepBest", count: 1 }]);
    expect(k.clips(jobId).map((c) => c.status)).toEqual(["PLANNED", "CANCELLED", "CANCELLED"]);
    const enqueue = k.deps.montage!.enqueue!;
    let broke = false;
    k.deps.montage!.enqueue = async (job, o) => {
      if (job.type === "montage.preview" && !broke) {
        broke = true;
        throw new Error("Redis coupé");
      }
      return enqueue(job, o);
    };
    await expect(k.drain()).rejects.toThrow(/Redis/);
    const clip = k.clips(jobId)[0]!;
    expect(clip.assetId).toBeTruthy();
    // La même tâche est rejouée : le short existe déjà, seul l'aperçu part.
    await runMontageStep(k.deps, { type: "montage.qc", montageJobId: jobId, shortClipId: String(clip.id) }, { attempt: 2 });
    await k.drain();
    expect(k.fake.renders).toHaveLength(1);
    expect(k.sentVideos).toHaveLength(1);
    expect(k.clips(jobId)[0]!.status).toBe("PREVIEW_SENT");
  });

  it("3 échecs de l'analyse → montage FAILED, Kevin prévient une fois, fichiers effacés", async () => {
    const k = await kitOf({ failures: { planCuts: Infinity } });
    const { jobId } = await startJob(k);
    const errors = await k.drainWithRetries();
    expect(errors).toBe(2);
    expect(k.job(jobId)).toMatchObject({ status: "FAILED" });
    expect(String(k.job(jobId).error)).toMatch(/panne simulée/);
    expect(k.hookCalls.failed).toEqual([{ reason: expect.stringMatching(/panne/), clipId: null }]);
    expect(await k.filesIn()).toEqual([]);
  });

  it("3 échecs d'un short → ce short seul en échec, les autres continuent", async () => {
    const k = await kitOf({ plan: [{ startMs: 0, endMs: 15_000, description: "a", score: 9, why: "" }, { startMs: 20_000, endMs: 35_000, description: "b", score: 8, why: "" }] });
    const { jobId } = await startJob(k);
    await k.drain();
    await approvePlan(k.deps, jobId);
    let n = 0;
    const real = k.fake.engine.renderShort;
    k.deps.montage!.engine = {
      ...k.fake.engine,
      renderShort: async (spec, o) => {
        if (spec.startMs === 0) {
          n++;
          throw new Error("ffmpeg : mémoire épuisée");
        }
        return real(spec, o);
      },
    };
    await k.drainWithRetries();
    expect(n).toBe(3);
    const [a, b] = k.clips(jobId);
    expect(a).toMatchObject({ status: "QC_FAILED" });
    expect(b).toMatchObject({ status: "PREVIEW_SENT" });
    expect(k.hookCalls.failed).toEqual([{ reason: expect.stringMatching(/mémoire/), clipId: a!.id }]);
    expect(k.job(jobId).status).toBe("PREVIEW");
  });

  it("plus de 50 Mo → une seule compression, depuis la source, et Kevin le sait", async () => {
    const k = await kitOf({ plan: [{ startMs: 0, endMs: 15_000, description: "a", score: 9, why: "" }], renderSize: () => 62 * MB });
    const { jobId } = await startJob(k);
    await k.drain();
    await approvePlan(k.deps, jobId);
    await k.drain();
    expect(k.fake.compressions).toHaveLength(1);
    expect(k.fake.compressions[0]!.spec.source).toMatch(/source\.mp4$/);
    expect(k.fake.compressions[0]!.spec.crf).toBe(18);
    expect(k.fake.compressions[0]!.crfStep).toBe(MONTAGE_LIMITS.compressCrfStep);
    const clip = k.clips(jobId)[0]!;
    expect(clip).toMatchObject({ status: "PREVIEW_SENT", compressed: true });
    const preview = (k.hooks.onPreviewReady as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![3] as { compressed: boolean };
    expect(preview.compressed).toBe(true);
    expect(k.sentVideos[0]!.caption).toMatch(/compressé/);
  });

  it("encore trop lourd après la compression → contrôle raté, jamais une deuxième compression", async () => {
    const k = await kitOf({ plan: [{ startMs: 0, endMs: 15_000, description: "a", score: 9, why: "" }], renderSize: () => 90 * MB, compressSize: 55 * MB });
    const { jobId } = await startJob(k);
    await k.drain();
    await approvePlan(k.deps, jobId);
    await k.drain();
    expect(k.fake.compressions).toHaveLength(1);
    expect(k.clips(jobId)[0]).toMatchObject({ status: "QC_FAILED" });
    expect(k.hookCalls.qcFailed).toBe(1);
    expect(k.sentVideos).toHaveLength(0);
    expect(k.job(jobId).status).toBe("DONE");
  });

  it("contrôle qualité raté (noir) → QC_FAILED, Kevin prévient, rien n'est rangé", async () => {
    const k = await kitOf({ plan: [{ startMs: 0, endMs: 15_000, description: "a", score: 9, why: "" }], qcProblems: () => ["1,2 s de noir au début"] });
    const { jobId } = await startJob(k);
    await k.drain();
    await approvePlan(k.deps, jobId);
    await k.drain();
    expect(k.clips(jobId)[0]).toMatchObject({ status: "QC_FAILED" });
    expect((k.clips(jobId)[0]!.qc as { problems: string[] }).problems).toEqual(["1,2 s de noir au début"]);
    expect(k.sentVideos).toHaveLength(0);
    expect(await k.filesIn()).toEqual([]);
  });

  it("doute sur un sous-titre → le short attend, puis repart après la réponse du client", async () => {
    const k = await kitOf({
      plan: [{ startMs: 0, endMs: 15_000, description: "a", score: 9, why: "" }],
      uncertain: [{ index: 1, atMs: 2000, text: "la martindale marche", alternatives: ["martindale", "martingale"] }],
    });
    const { jobId } = await startJob(k, { ...INSTRUCTIONS, subtitles: true });
    await k.drain();
    await approvePlan(k.deps, jobId);
    await k.drain();
    const clip = k.clips(jobId)[0]!;
    expect(k.hookCalls.doubt).toBe(1);
    expect(clip.subtitlesSrt).toBeNull();
    expect(clip.subtitlesPending).toBeTruthy();
    expect(k.fake.renders).toHaveLength(0);
    // Le son vient de la SOURCE, jamais d'un short.
    expect(k.fake.calls.extractAudioSegment).toBe(1);
    expect(k.fake.calls.transcribeClip).toBe(2);
    // Une tâche rejouée pendant l'attente ne relance rien.
    await runMontageStep(k.deps, { type: "montage.dress", montageJobId: jobId, shortClipId: String(clip.id) });
    await runMontageStep(k.deps, { type: "montage.cut", montageJobId: jobId, shortClipId: String(clip.id) });
    expect(k.fake.calls.transcribeClip).toBe(2);
    expect(k.fake.renders).toHaveLength(0);

    const r = await resolveSubtitleDoubt(k.deps, String(clip.id), { index: 1, text: "martingale" });
    expect(r).toMatchObject({ ok: true, done: true });
    await k.drain();
    expect(k.fake.renders).toHaveLength(1);
    expect(k.fake.srtSeen[0]).toContain("la martingale marche");
    expect(k.clips(jobId)[0]).toMatchObject({ status: "PREVIEW_SENT" });
    expect(Array.isArray((k.clips(jobId)[0]!.subtitlesPending as { segments?: unknown } | null)?.segments)).toBe(false);
    // Lisibilité contrôlée, images effacées.
    expect(k.fake.calls.checkSubtitleReadability).toBe(1);
    expect(await k.filesIn()).toEqual([`${jobId}/source.mp4`]);
  });

  it("REDO : « le 1, raccourcis de 2 secondes » → refait ce short seul, nouvel aperçu", async () => {
    const k = await kitOf({ plan: [{ startMs: 0, endMs: 15_000, description: "a", score: 9, why: "" }, { startMs: 20_000, endMs: 35_000, description: "b", score: 8, why: "" }] });
    const { jobId } = await startJob(k);
    await k.drain();
    await approvePlan(k.deps, jobId);
    await k.drain();
    const before = { ...k.clips(jobId)[0]! };
    const r = await redoClip(k.deps, String(before.id), "raccourcis de 2 secondes et cam en bas à gauche");
    expect(r.ok).toBe(true);
    expect(k.clips(jobId)[0]).toMatchObject({ status: "REDO", redoCount: 1, assetId: null, endMs: 13_000, pipPosition: "BOTTOM_LEFT" });
    expect(k.job(jobId).status).toBe("CUTTING");
    await k.drain();
    expect(k.fake.renders).toHaveLength(3);
    expect(k.fake.renders[2]).toMatchObject({ startMs: 0, endMs: 13_000, pipPosition: "BOTTOM_LEFT" });
    const after = k.clips(jobId)[0]!;
    expect(after.status).toBe("PREVIEW_SENT");
    expect(after.assetId).not.toBe(before.assetId);
    expect(after.clientFeedback).toMatch(/raccourcis/);
    expect(k.hookCalls.preview).toBe(3);
    // Kevin passe la forme structurée.
    const again = await redoClip(k.deps, String(after.id), { overlayText: "GROS GAIN", note: "ajoute un texte" });
    expect(again.ok).toBe(true);
    await k.drain();
    expect(k.fake.renders.at(-1)).toMatchObject({ overlayText: "GROS GAIN", endMs: 13_000 });
    expect(await redoClip(k.deps, String(after.id), "euh")).toMatchObject({ ok: false });
  });

  it("annulation : plus rien ne se fabrique, fichiers effacés", async () => {
    const k = await kitOf();
    const { jobId } = await startJob(k);
    await k.drain();
    await approvePlan(k.deps, jobId);
    expect(k.queue).toHaveLength(3);
    const r = await cancelJob(k.deps, jobId);
    expect(r).toMatchObject({ ok: true, cancelledClips: 3 });
    await k.drain();
    expect(k.fake.renders).toHaveLength(0);
    expect(k.job(jobId).status).toBe("CANCELLED");
    expect(k.clips(jobId).every((c) => c.status === "CANCELLED")).toBe(true);
    expect(await k.filesIn()).toEqual([]);
    expect(await cancelJob(k.deps, jobId)).toMatchObject({ ok: false });
    expect(await redoClip(k.deps, String(k.clips(jobId)[0]!.id), { endDeltaMs: -1000 })).toMatchObject({ ok: false });
  });

  it("vidéo illisible ou trop longue → refus clair au premier essai, sans reprise", async () => {
    const k = await kitOf({ sourceDurationMs: 4 * 3600_000 });
    const { jobId } = await startJob(k);
    const next = k.queue.shift()!;
    const r = await runMontageStep(k.deps, next.job, { attempt: 1 });
    expect(r).toMatchObject({ ok: false, outcome: "failed" });
    expect(k.job(jobId).status).toBe("FAILED");
    expect(k.hookCalls.failed[0]!.reason).toMatch(/3 h au plus/);
    const k2 = await kitOf({ failures: { probeMedia: Infinity } });
    const j2 = await startJob(k2);
    const r2 = await runMontageStep(k2.deps, k2.queue.shift()!.job, { attempt: 1 });
    expect(r2.ok).toBe(false);
    expect(k2.job(j2.jobId).status).toBe("FAILED");
    expect(String(k2.job(j2.jobId).error)).toMatch(/illisible/);
  });

  it("le filet remet en file ce qui n'avance plus (tâche perdue), sans doublon", async () => {
    const k = await kitOf();
    const { jobId } = await startJob(k);
    k.queue.length = 0; // Redis vidé : la tâche d'analyse est perdue.
    k.job(jobId).updatedAt = new Date(k.deps.now!().getTime() - 31 * 60_000);
    expect((await resumeStalledMontage(k.deps)).requeued).toBe(1);
    await resumeStalledMontage(k.deps);
    expect(k.queue).toHaveLength(1);
    await k.drain();
    expect(k.job(jobId).status).toBe("PLAN_SENT");
  });
});

describe("ménage", () => {
  it("dossiers orphelins de plus de 24 h et travaux finis supprimés, travail en cours gardé", async () => {
    const k = await kitOf();
    const { jobId } = await startJob(k);
    await k.drain();
    const orphan = join(k.workDir, "travail-disparu");
    await mkdir(join(orphan, "clips", "x"), { recursive: true });
    await writeFile(join(orphan, "clips", "x", "render.mp4"), "x");
    const old = new Date(k.deps.now!().getTime() - 25 * 3600_000);
    await utimes(orphan, old, old);
    const fresh = join(k.workDir, "travail-recent");
    await mkdir(fresh, { recursive: true });
    await mkdir(join(k.workDir, jobId, "frames"), { recursive: true });
    await writeFile(join(k.workDir, jobId, "frames", "frame-1.jpg"), "x");
    const r = await sweepMontageWorkDir(k.deps);
    expect(r.removed).toContain(orphan);
    expect(r.removed).toContain(join(k.workDir, jobId, "frames"));
    const files = await k.filesIn();
    expect(files).toContain(`${jobId}/source.mp4`);
    expect(files.some((f) => f.startsWith("travail-disparu"))).toBe(false);
    await cancelJob(k.deps, jobId);
    await mkdir(join(k.workDir, jobId), { recursive: true });
    await sweepMontageWorkDir(k.deps);
    expect((await k.filesIn()).some((f) => f.startsWith(jobId))).toBe(false);
  });
});

describe("règles pures", () => {
  it("coupe ramenée dans la vidéo et les bornes 5 à 90 s", () => {
    expect(clampCut({ startMs: -500, endMs: 10_000 }, 60_000, null)).toEqual({ startMs: 0, endMs: 10_000 });
    expect(clampCut({ startMs: 58_000, endMs: 70_000 }, 60_000, null)).toEqual({ startMs: 55_000, endMs: 60_000 });
    expect(clampCut({ startMs: 0, endMs: 200_000 }, 600_000, null)).toEqual({ startMs: 0, endMs: 90_000 });
    expect(clampCut({ startMs: 0, endMs: 200_000 }, 600_000, 2)).toEqual({ startMs: 0, endMs: 180_000 });
  });

  it("plan gardé : doublons écartés, nombre demandé respecté", () => {
    const p = (s: number) => ({ startMs: s, endMs: s + 15_000, description: "", score: 5, why: "" });
    expect(keepPlanned([p(0), p(500), p(30_000), p(60_000)], 120_000, { ...INSTRUCTIONS, count: 2 }, 20)).toHaveLength(2);
    expect(keepPlanned([p(0), p(500), p(30_000)], 120_000, INSTRUCTIONS, 20).map((x) => x.startMs)).toEqual([0, 30_000]);
  });

  it("phrase libre → retouche", () => {
    expect(parseClipChangeText("raccourcis de 2 secondes")).toMatchObject({ endDeltaMs: -2000 });
    expect(parseClipChangeText("commence 3 s plus tôt")).toMatchObject({ startDeltaMs: -3000 });
    expect(parseClipChangeText("10 secondes au lieu de 15")).toMatchObject({ durationSec: 10 });
    expect(parseClipChangeText("cam en haut à gauche, sans sous-titres")).toMatchObject({ pipPosition: "TOP_LEFT", subtitles: false });
    expect(parseClipChangeText("ajoute le texte « GROS GAIN »")).toMatchObject({ overlayText: "GROS GAIN" });
    expect(parseClipChangeText("bof")).toBeNull();
  });
});

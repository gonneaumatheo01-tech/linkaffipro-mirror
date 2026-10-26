/**
 * Phase 28 — équipe Montage de bout en bout, sur base réelle (`linkaffipro_test`), sans réseau :
 * - Kevin (bot `role ADMIN`) reçoit les updates simulées par SES vrais handlers grammY (`createBot` + `handleUpdate` :
 *   réception des vidéos `boss-montage.ts`, chemin rapide du dialogue admin, boutons `msh:` / `mst:`), faux Telegram ;
 * - la VRAIE chaîne (`runMontageStep`) tourne par le VRAI processeur `agents-montage` exécuté en processus, avec une
 *   file simulée qui rejoue les essais comme BullMQ (3 au plus) ;
 * - moteur : le vrai `createMontageEngine` sur un exécuteur ffmpeg SCRIPTÉ (par défaut), ou sur le VRAI ffmpeg de
 *   l'image Docker `lap-ffmpeg` quand `MONTAGE_FFMPEG=docker` (les deux scénarios tournent alors) ;
 * - IA : fausse IA du montage (plan de coupe, relecture des sous-titres, lisibilité) et fausse transcription ;
 * - téléchargement Telegram simulé : copie de la fixture `packages/agents/fixtures/montage/casino.mp4` (ou d'une
 *   version longue fabriquée depuis elle par le vrai ffmpeg) ; rangement des shorts simulé (canal « Médiathèque »).
 *
 * Scénario : vidéo + « Kevin, découpe ça en shorts de 15 secondes, cam en haut, sous-titres » → LONG_VIDEO gardée dans
 * Telegram + MontageJob → analyse → plan → « ok lance » → shorts (un seul passage ffmpeg chacun) → sous-titres (deux
 * écoutes identiques ; un doute → question → réponse → short repris) → contrôle → rangement → aperçu `msh:` → ✅ ;
 * plantage au milieu (le short rangé n'est pas refait) ; « le 2, 10 secondes au lieu de 15 » → refait ; ❌ → REJECTED ;
 * « envoie les validés dans le canal Test » → posts des seuls shorts validés ; un short non validé ne part jamais ;
 * un autre travail annulé → CANCELLED ; aucun fichier temporaire restant ; aucun octet de vidéo en base.
 */
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Job } from "bullmq";
import type { Update } from "grammy/types";
import type { Bot as GrammyBot } from "grammy";
import { encrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import {
  createMontageEngine,
  fakeProbeJson,
  MONTAGE_FIXTURES,
  montageKevinHooks,
  realFfmpegAvailable,
  realFfmpegRunner,
  type AdminButton,
  type AgentsDeps,
  type FfmpegRunner,
  type LlmProvider,
  type MontagePipelineDeps,
  type MontageQueueJob,
  type SiteOpsClient,
} from "@linkaffipro/agents";
import { createBot, prismaTelegramDeps, type TelegramDeps } from "@linkaffipro/telegram";
import type { AgentsMontageJob } from "@linkaffipro/queue";
import { processAgentsMontage } from "../../src/processors/agents-montage";
import { processScheduler } from "../../src/processors/scheduler";
import { processTelegramSend } from "../../src/processors/telegram-send";
import { apiForBot } from "../../src/sending/api";
import { setSendableBytesDeps } from "../../src/montage/media-bytes";
import { approveAllQa, createBotAndChannel, fakeJob, installFakeTelegram, resetDb, type TelegramCall } from "./helpers";

const ADMIN = 78_484;
const KEVIN_TG = 5550;
const KEVIN_TOKEN = `${KEVIN_TG}:KEVIN-TOKEN-${"k".repeat(30)}`;
const LIBRARY_CHAT = "-1009999";
const PHRASE = "Kevin, découpe ça en shorts de 15 secondes, cam en haut, sous-titres";
const SOURCE_MS = 60_000;
/** Plan de coupe rendu par la fausse IA (vidéo d'une minute). */
const PLAN = [
  { start_seconds: 2, end_seconds: 17, description: "Gros gain à la roulette", score: 9, why: "gain" },
  { start_seconds: 20, end_seconds: 35, description: "Série de mises sur le rouge", score: 8, why: "suspense" },
  { start_seconds: 40, end_seconds: 55, description: "Réaction au jackpot", score: 7, why: "réaction" },
];

// ------------------------------------------------------------------------------------------------ outils communs

/** Sortie de l'analyse ffmpeg (blackdetect, silencedetect, volumedetect) d'un short sans défaut. */
const QC_STDERR = "[Parsed_volumedetect_0] n_samples: 1440000\n[Parsed_volumedetect_0] mean_volume: -20.0 dB\n[Parsed_volumedetect_0] max_volume: -3.0 dB\n[Parsed_volumedetect_0] histogram_3db: 12\n";

/**
 * Exécuteur ffmpeg SCRIPTÉ (aucun binaire) : enregistre les arguments ; écrit les fichiers attendus (images de
 * l'analyse, son, rendu, images du contrôle) ; ffprobe rend une source d'une minute et la durée réelle de chaque rendu
 * (`-t` ÷ vitesse) avec le poids réel du fichier.
 */
function scriptedRunner(): FfmpegRunner {
  const durations = new Map<string, number>();
  return {
    async ffmpeg(args) {
      const out = args.at(-1)!;
      if (args.includes("-filter_complex")) {
        const t = Number(args[args.indexOf("-t") + 1]);
        const graph = args[args.indexOf("-filter_complex") + 1]!;
        const speed = Number(/setpts=PTS\/([\d.]+)/.exec(graph)?.[1] ?? 1);
        await mkdir(dirname(out), { recursive: true });
        await writeFile(out, `rendu ${args.join(" ")}`);
        durations.set(out, Math.round((t * 1000) / speed));
        return { code: 0, stderr: "" };
      }
      if (/frame-%05d\.jpg$/.test(out)) {
        for (let i = 1; i <= SOURCE_MS / 5000; i++) await writeFile(join(dirname(out), `frame-${String(i).padStart(5, "0")}.jpg`), `image ${i}`);
        return { code: 0, stderr: "" };
      }
      if (args.includes("pcm_s16le") || args.includes("-frames:v")) {
        await mkdir(dirname(out), { recursive: true });
        await writeFile(out, Buffer.alloc(2048, 3));
        return { code: 0, stderr: "" };
      }
      if (out === "-") return { code: 0, stderr: QC_STDERR };
      return { code: 0, stderr: "" };
    },
    async ffprobe(args) {
      const path = args.at(-1)!;
      const size = await stat(path).then((s) => s.size).catch(() => -1);
      if (size < 0) return { code: 1, stdout: "", stderr: `${path}: No such file or directory` };
      if (/source\.\w+$/.test(path)) return { code: 0, stdout: fakeProbeJson({ durationMs: SOURCE_MS, width: 1920, height: 1080, sizeBytes: size }), stderr: "" };
      return { code: 0, stdout: fakeProbeJson({ durationMs: durations.get(path) ?? 15_000, sizeBytes: size }), stderr: "" };
    },
  };
}

/** Vrai ffmpeg (image Docker) avec les arguments enregistrés. */
function recordingRunner(inner: FfmpegRunner, calls: string[][]): FfmpegRunner {
  return {
    ffmpeg: (args, o) => (calls.push([...args]), inner.ffmpeg(args, o)),
    ffprobe: (args, o) => inner.ffprobe(args, o),
  };
}

type Sent = { chat: string; text: string; buttons: AdminButton[][]; assetId?: string; messageId: number };

function flatButtons(b: AdminButton[][] | undefined): string[] {
  return (b ?? []).flat().map((x) => x.callbackData);
}

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string) => {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out.push(p.slice(dir.length + 1));
    }
  };
  await walk(dir);
  return out.sort();
}

// ------------------------------------------------------------------------------------------------ scénario

function montageScenario(mode: "scripted" | "docker") {
  const real = mode === "docker";
  /** Début du scénario (posé au début de `beforeAll` : les deux scénarios partagent la base). */
  let started = new Date();
  const ffCalls: string[][] = [];
  const queue: Array<{ job: MontageQueueJob | AgentsMontageJob; jobId?: string }> = [];
  const stepErrors: string[] = [];
  const adminOut: Sent[] = [];
  const orchestratorJobs: unknown[] = [];
  const siteOpsCalls: Array<{ op: string; input: Record<string, unknown> }> = [];
  const downloads: Array<{ fileId: string | null; dest: string }> = [];
  const stored: Array<{ chatId: string; caption: string; fileId: string }> = [];
  const storedBytes = new Map<string, Buffer>();
  const sttCalls: Array<{ path: string; biased: boolean }> = [];
  const ids = { kevin: "", channelBot: "", testChannel: "", user: "" };
  let kevin: GrammyBot;
  let kevinCalls: TelegramCall[] = [];
  let channelCalls: TelegramCall[] = [];
  let workDir = "";
  let sourcePath: string = MONTAGE_FIXTURES.casino;
  let nextAdminMsg = 8000;
  let failStoreOnce: string | null = null;
  let doubtClipId: string | null = null;
  let lastRead = "";
  let uid = 1;
  let mid = 100;

  // ---- fausse IA du montage
  const llm: LlmProvider = {
    async complete(req) {
      const sys = req.system ?? "";
      if (sys.includes('{"shorts"')) return { text: JSON.stringify({ shorts: PLAN }), costCents: 0 };
      if (sys.includes('{"segments"')) {
        const segments = [...req.user.matchAll(/#(\d+) \[[^\]]*\][^\n]*\nA : ([^\n]*)/g)].map((m) => ({ index: Number(m[1]), text: m[2], uncertain: false, reason: "" }));
        return { text: JSON.stringify({ segments }), costCents: 0 };
      }
      if (sys.includes('{"ok":boolean')) return { text: JSON.stringify({ ok: true, problems: [] }), costCents: 0 };
      throw new Error(`appel d'IA inattendu : ${sys.slice(0, 80)}`);
    },
  };
  /** Deux écoutes identiques ; pour le short « en doute », la seconde entend « martindale ». */
  const stt = {
    async transcribe(req: { prompt: string | null }) {
      const biased = req.prompt !== null;
      sttCalls.push({ path: lastRead, biased });
      if (doubtClipId && lastRead.includes(doubtClipId))
        return { text: "", duration: 3, segments: [{ start: 0, end: 3, text: biased ? "la martingale ça marche" : "la martindale ça marche" }] };
      return {
        text: "",
        duration: 4,
        segments: [
          { start: 0, end: 2, text: "Rien ne va plus" },
          { start: 2, end: 4, text: "Gros gain sur le rouge" },
        ],
      };
    },
  };

  // ---- faux messager admin (crochets de Kevin dans le worker : plan, doutes, aperçus)
  const admin = {
    async send(html: string, opts: { buttons?: AdminButton[][] } = {}) {
      const messageId = nextAdminMsg++;
      adminOut.push({ chat: String(ADMIN), text: html, buttons: opts.buttons ?? [], messageId });
      return { messageId };
    },
    async sendTo(chatId: bigint, html: string, opts: { buttons?: AdminButton[][] } = {}) {
      const messageId = nextAdminMsg++;
      adminOut.push({ chat: chatId.toString(), text: html, buttons: opts.buttons ?? [], messageId });
      return { messageId };
    },
    async sendStoredVideo(chatId: bigint, req: { assetId: string; caption: string; buttons?: AdminButton[][] }) {
      const messageId = nextAdminMsg++;
      adminOut.push({ chat: chatId.toString(), text: req.caption, buttons: req.buttons ?? [], assetId: req.assetId, messageId });
      return { messageId };
    },
    async deleteMessage() {},
  };

  /** File `agents-montage` simulée, idempotente par identifiant de tâche (comme `addIdempotent`). */
  const enqueueMontage = async (job: MontageQueueJob, o: { jobId?: string } = {}) => {
    if (o.jobId && queue.some((q) => q.jobId === o.jobId)) return;
    queue.push({ job, jobId: o.jobId });
  };

  /** « messages.programmer » du site, réduit à ce qu'il écrit : un message programmé par short (bot du canal). */
  const siteOps: SiteOpsClient = async (req) => {
    siteOpsCalls.push({ op: req.op, input: req.input });
    if (req.op !== "messages.programmer") return { ok: false, error: `opération inattendue ${req.op}` };
    const channelIds = req.input.channelIds as string[];
    for (const channelId of channelIds) {
      const ch = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
      await prisma.post.create({
        data: {
          code: `M${Math.random().toString(36).slice(2, 8)}`,
          channelId,
          botId: ch.primaryBotId!,
          status: "SCHEDULED",
          scheduledAt: new Date(Date.now() + 60_000),
          text: String(req.input.text ?? ""),
          mediaAssetIds: req.input.mediaAssetIds as string[],
          createdById: req.actor.userId,
        },
      });
    }
    return { ok: true, message: "programmé" };
  };

  const agents = {
    prisma: prisma as unknown as AgentsDeps["prisma"],
    enqueue: {
      async orchestrator(job: unknown) {
        orchestratorJobs.push(job);
      },
      async step() {},
    },
    admin,
    siteOps,
    logger: { info() {}, warn() {}, error() {} },
    montage: { enqueue: enqueueMontage },
  } as unknown as AgentsDeps;

  const pdeps: MontagePipelineDeps = {
    ...(agents as MontagePipelineDeps),
    async downloadTelegramFile(ref, dest) {
      downloads.push({ fileId: ref.fileId ?? null, dest });
      await mkdir(dirname(dest), { recursive: true });
      const short = ref.fileId ? storedBytes.get(ref.fileId) : undefined;
      if (short) await writeFile(dest, short);
      else await copyFile(sourcePath, dest);
    },
    async sendVideo(req) {
      if (failStoreOnce && req.caption.includes(failStoreOnce)) {
        failStoreOnce = null;
        throw new Error("Telegram injoignable (panne simulée)");
      }
      const n = stored.length + 1;
      const fileId = `kevin-short-${mode}-${n}`;
      storedBytes.set(fileId, await readFile(req.path));
      stored.push({ chatId: req.chatId, caption: req.caption, fileId });
      return { messageId: 600 + n, fileId, fileUniqueId: `uniq-${mode}-${n}` };
    },
  };

  function ffmpegOf(): FfmpegRunner {
    return real ? recordingRunner(realFfmpegRunner(), ffCalls) : recordingRunner(scriptedRunner(), ffCalls);
  }

  /** Rendus d'un short (chemin de sortie dans son dossier de travail). */
  const rendersOf = (clipId: string) => ffCalls.filter((a) => a.includes("-filter_complex") && a.at(-1)!.includes(`/clips/${clipId}/`));

  /** Vide la file par le VRAI processeur ; 3 essais par tâche comme BullMQ (l'essai en cours est transmis). */
  async function drain(until?: () => Promise<boolean>): Promise<void> {
    for (let n = 0; n < 200 && queue.length; n++) {
      const t = queue.shift()!;
      for (let attempt = 0; attempt < 3; attempt++) {
        const job = { id: t.jobId, name: `agents-montage:${t.job.type}`, data: t.job, attemptsMade: attempt, opts: { attempts: 3 } } as unknown as Job<AgentsMontageJob>;
        try {
          await processAgentsMontage(job, pdeps);
          break;
        } catch (err) {
          stepErrors.push(`${t.job.type} : ${(err as Error).message}`);
          if (attempt === 2) throw err;
        }
      }
      if (until && (await until())) return;
    }
    expect(queue, "file vide à la fin").toHaveLength(0);
  }

  // ---- updates Telegram simulées
  const from = { id: ADMIN, is_bot: false, first_name: "Mathéo", username: "matheo" };
  const chat = { id: ADMIN, type: "private" as const, first_name: "Mathéo" };
  function textUpdate(text: string): Update {
    mid += 1;
    return { update_id: uid++, message: { message_id: mid, date: Math.floor(Date.now() / 1000), chat, from, text } } as Update;
  }
  async function videoUpdate(fileUniqueId: string, caption: string): Promise<Update> {
    mid += 1;
    const size = (await stat(sourcePath)).size;
    return {
      update_id: uid++,
      message: {
        message_id: mid,
        date: Math.floor(Date.now() / 1000),
        chat,
        from,
        caption,
        video: { file_id: `file-${fileUniqueId}`, file_unique_id: fileUniqueId, width: 1920, height: 1080, duration: SOURCE_MS / 1000, mime_type: "video/mp4", file_size: size },
      },
    } as Update;
  }
  /** Appui sur un bouton du message `messageId` (l'aperçu ou la question qui le porte). */
  function callbackUpdate(data: string, messageId: number): Update {
    return {
      update_id: uid++,
      callback_query: { id: `cb${uid}`, chat_instance: "x", from, message: { message_id: messageId, date: 0, chat, text: "?" }, data },
    } as Update;
  }
  /** Ce que Kevin a répondu par le webhook (sa propre instance grammY) depuis un instant. */
  const kevinTextsSince = (n: number) =>
    kevinCalls
      .slice(n)
      .filter((c) => c.method === "sendMessage")
      .map((c) => String(c.payload.text));
  async function toKevin(u: Update): Promise<string> {
    const n = kevinCalls.length;
    await kevin.handleUpdate(u);
    return kevinTextsSince(n).join("\n");
  }

  const clipsOf = (jobId: string) => prisma.shortClip.findMany({ where: { montageJobId: jobId }, orderBy: { index: "asc" } });
  const eventsOf = async (type: string) => prisma.event.count({ where: { type, createdAt: { gte: started } } });
  /** ✅ / ❌ sous l'aperçu ACTUEL du short. */
  async function pressPreview(clipId: string, choice: "ok" | "no"): Promise<string> {
    const clip = await prisma.shortClip.findUniqueOrThrow({ where: { id: clipId } });
    return toKevin(callbackUpdate(`msh:${clipId}:${choice}`, Number(clip.previewMsgId)));
  }
  const auditsOf = (action: string) => prisma.auditLog.findMany({ where: { action, createdAt: { gte: started } } });

  let jobA = "";
  let jobB = "";
  let clipIds: string[] = [];

  beforeAll(async () => {
    started = new Date();
    await prisma.shortClip.deleteMany();
    await prisma.montageJob.deleteMany();
    const old = await prisma.mediaAsset.findMany({ where: { teamKey: "montage" }, select: { id: true } });
    await prisma.mediaAssetTelegramFile.deleteMany({ where: { assetId: { in: old.map((a) => a.id) } } });
    await prisma.mediaAsset.deleteMany({ where: { id: { in: old.map((a) => a.id) } } });
    await resetDb();
    // Phase 30 : QA Global simulé qui approuve les aperçus (le verrou reste actif).
    Object.assign(pdeps, { qaLlm: await approveAllQa(agents) });
    await prisma.bossTurn.deleteMany();
    await prisma.setting.deleteMany({ where: { OR: [{ key: { startsWith: "montage." } }, { key: { startsWith: "boss." } }, { key: { startsWith: "agents." } }] } });
    await prisma.user.deleteMany({ where: { email: "montage-flow@linkaffipro.internal" } });
    await prisma.setting.upsert({ where: { key: "admin.telegramUserId" }, create: { key: "admin.telegramUserId", value: String(ADMIN) }, update: { value: String(ADMIN) } });
    await prisma.setting.create({ data: { key: "agents.libraryChannelId", value: LIBRARY_CHAT } });
    // Vrai ffmpeg : encodage rapide (le réglage existe pour ça) ; le reste des réglages par défaut.
    if (real) await prisma.setting.create({ data: { key: "montage.ffmpeg_preset", value: "ultrafast" } });
    ids.user = (await prisma.user.create({ data: { email: "montage-flow@linkaffipro.internal", name: "Mathéo", passwordHash: "x", role: "ADMIN", telegramUserId: BigInt(ADMIN) } })).id;

    const { bot, channel } = await createBotAndChannel({ title: "Canal test" });
    ids.channelBot = bot.id;
    ids.testChannel = channel.id;
    channelCalls = installFakeTelegram((await apiForBot(bot.id)).api);
    const kevinRec = await prisma.bot.create({
      data: { name: "Kevin", username: "kevin_boss_bot", telegramBotId: BigInt(KEVIN_TG), tokenEncrypted: encrypt(KEVIN_TOKEN), vertical: "CASINO", webhookSecret: "secret-kevin", role: "ADMIN" },
    });
    ids.kevin = kevinRec.id;
    const tgDeps: TelegramDeps = {
      ...prismaTelegramDeps,
      agentsDeps: () => agents,
      adminDialogBot: async () => ({ id: kevinRec.id, username: kevinRec.username, isBoss: true }),
      workerDown: async () => false,
      montageQuestionDelayMs: 0,
    };
    kevin = createBot(kevinRec, tgDeps);
    kevinCalls = installFakeTelegram(kevin.api);

    workDir = await mkdtemp(join(tmpdir(), `lap-montage-it-${mode}-`));
    if (real) {
      // Source d'une minute fabriquée depuis la fixture (5 s bouclées, sans réencodage) par le vrai ffmpeg.
      sourcePath = join(workDir, "..", `${workDir.split("/").pop()}-source-60s.mp4`);
      const r = spawnSync(join(dirname(MONTAGE_FIXTURES.casino), "../../scripts/ffmpeg-docker.sh"), ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-stream_loop", "11", "-i", MONTAGE_FIXTURES.casino, "-c", "copy", sourcePath], { encoding: "utf8", timeout: 120_000 });
      expect(r.status, r.stderr).toBe(0);
    }
    pdeps.ffmpeg = ffmpegOf();
    pdeps.montage = {
      enqueue: enqueueMontage,
      workDir,
      kevinBotId: async () => kevinRec.id,
      fontFile: null,
      hooks: montageKevinHooks(pdeps),
    };
    pdeps.montage.engine = createMontageEngine({
      runner: pdeps.ffmpeg,
      deps: pdeps,
      ai: {
        montageLlm: llm,
        stt,
        async readFile(path: string) {
          lastRead = path;
          return new Uint8Array(await readFile(path));
        },
      },
    });
    setSendableBytesDeps(() => pdeps);
  }, 180_000);

  afterAll(async () => {
    setSendableBytesDeps(null);
    await rm(workDir, { recursive: true, force: true });
    if (real) await rm(sourcePath, { force: true });
  });

  it("vidéo + consigne → vidéo longue gardée dans Telegram (rien en base), travail créé, analyse en file", async () => {
    const reply = await toKevin(await videoUpdate(`src-a-${mode}`, PHRASE));
    expect(reply).toMatch(/reçu ta vidéo|Vidéo bien reçue|C'est reçu/);
    expect(reply).toMatch(/cam en haut à droite/);
    expect(reply).toMatch(/sous-titres/);
    const asset = await prisma.mediaAsset.findFirstOrThrow({ where: { kind: "LONG_VIDEO", teamKey: "montage" } });
    expect(asset).toMatchObject({ storage: "telegram", mimeType: "video/mp4", size: (await stat(sourcePath)).size, duration: SOURCE_MS / 1000 });
    expect(asset.bytes.length).toBe(0);
    expect(asset.telegramRef).toMatchObject({ chatId: String(ADMIN), via: "kevin", fileId: `file-src-a-${mode}`, botId: ids.kevin });
    const job = await prisma.montageJob.findFirstOrThrow({ where: { sourceAssetId: asset.id } });
    jobA = job.id;
    expect(job).toMatchObject({ status: "PENDING", chatId: String(ADMIN), createdById: ids.user });
    expect(job.instructions).toMatchObject({ durationTarget: 15, pipPosition: "TOP_RIGHT", subtitles: true, format: "VERTICAL_9_16" });
    expect(queue.map((q) => q.job.type)).toEqual(["montage.analyze"]);
    expect(await eventsOf("agents.montage.source_received")).toBe(1);
    expect(await eventsOf("agents.montage.job_created")).toBe(1);
    expect(orchestratorJobs).toHaveLength(0);
  });

  it("analyse (images + fausse IA vision) → plan de coupe envoyé par Kevin, images effacées", async () => {
    await drain();
    const job = await prisma.montageJob.findUniqueOrThrow({ where: { id: jobA } });
    expect(job.status).toBe("PLAN_SENT");
    expect(job.sourceMeta).toMatchObject({ width: 1920, height: 1080, videoCodec: "h264" });
    expect(Math.abs((job.sourceMeta as { durationMs: number }).durationMs - SOURCE_MS)).toBeLessThan(500);
    const clips = await clipsOf(jobA);
    clipIds = clips.map((c) => c.id);
    expect(clips.map((c) => [c.index, c.startMs, c.endMs, c.status, c.pipPosition, c.subtitles])).toEqual([
      [1, 2000, 17_000, "PLANNED", "TOP_RIGHT", true],
      [2, 20_000, 35_000, "PLANNED", "TOP_RIGHT", true],
      [3, 40_000, 55_000, "PLANNED", "TOP_RIGHT", true],
    ]);
    const plan = adminOut.filter((m) => m.chat === String(ADMIN)).map((m) => m.text).join("\n");
    expect(plan).toMatch(/Gros gain à la roulette/);
    expect(plan).toMatch(/Réaction au jackpot/);
    expect(job.planMsgId).not.toBeNull();
    // Images de l'analyse effacées après le plan ; la copie de travail de la source reste tant que le travail vit.
    expect(await listFiles(join(workDir, jobA))).toEqual(["source.mp4"]);
    expect(downloads).toHaveLength(1);
    expect(await eventsOf("agents.montage.plan_ready")).toBe(1);
  });

  it("« ok lance » → une tâche de coupe par short ; plantage au milieu : le short rangé n'est pas refait", async () => {
    doubtClipId = clipIds[2]!;
    failStoreOnce = "short 2";
    const reply = await toKevin(textUpdate("ok lance"));
    expect(reply).toMatch(/3/);
    expect((await prisma.montageJob.findUniqueOrThrow({ where: { id: jobA } })).planApprovedAt).not.toBeNull();
    expect((await auditsOf("montage.plan.approved")).map((a) => [a.entityId, a.userId])).toEqual([[jobA, ids.user]]);
    expect(queue.map((q) => q.job.type)).toEqual(["montage.cut", "montage.cut", "montage.cut"]);

    // Jusqu'à ce que le short 1 soit rangé dans Telegram, puis plantage du worker : file perdue, disque nettoyé.
    await drain(async () => !!(await prisma.shortClip.findUniqueOrThrow({ where: { id: clipIds[0]! } })).assetId);
    const first = await prisma.shortClip.findUniqueOrThrow({ where: { id: clipIds[0]! } });
    expect(first.assetId).not.toBeNull();
    expect(rendersOf(clipIds[0]!)).toHaveLength(1);
    queue.length = 0;
    await rm(join(workDir, jobA), { recursive: true, force: true });
    await prisma.$executeRaw`UPDATE "MontageJob" SET "updatedAt" = now() - interval '2 hours' WHERE id = ${jobA}`;
    await prisma.$executeRaw`UPDATE "ShortClip" SET "updatedAt" = now() - interval '2 hours' WHERE "montageJobId" = ${jobA}`;
    // Filet du processeur (toutes les 15 min) : ce qui n'avance plus repart, sans doublon.
    expect(await processAgentsMontage(fakeJob({ type: "montage.sweep" }) as Job<AgentsMontageJob>, pdeps)).toMatchObject({ requeued: 2 });
    await drain();

    // Le short 1 n'a jamais été refait ni rangé deux fois ; le 2 a été rendu à nouveau (son rendu était perdu).
    expect(rendersOf(clipIds[0]!)).toHaveLength(1);
    expect(rendersOf(clipIds[1]!)).toHaveLength(2);
    expect(stored.filter((s) => s.caption.includes("short 1"))).toHaveLength(1);
    // Copie de travail retéléchargée après le plantage.
    expect(downloads.filter((d) => d.fileId === `file-src-a-${mode}`)).toHaveLength(2);
    // Rangement du short 2 en échec une fois (Telegram) : repris par le 2e essai, sans doublon.
    expect(stepErrors.filter((e) => e.startsWith("montage.qc"))).toHaveLength(1);
    expect(stored.filter((s) => s.caption.includes("short 2"))).toHaveLength(1);
  }, 240_000);

  it("un seul passage ffmpeg par short : coupe + caméra en haut à droite + vertical + sous-titres, depuis la source", async () => {
    const clips = await clipsOf(jobA);
    const renders = ffCalls.filter((a) => a.includes("-filter_complex"));
    // Shorts 1 et 2 (le 2 deux fois : son premier rendu a été perdu au plantage) ; le 3 attend la réponse sur ses sous-titres.
    expect(renders.length).toBe(3);
    for (const args of renders) {
      const clip = clips.find((c) => args.at(-1)!.includes(`/clips/${c.id}/`))!;
      expect(args.filter((a) => a === "-i")).toHaveLength(1);
      expect(args[args.indexOf("-i") + 1]).toMatch(/source\.mp4$/);
      expect(args[args.indexOf("-ss") + 1]).toBe((clip.startMs / 1000).toFixed(3));
      expect(args[args.indexOf("-t") + 1]).toBe(((clip.endMs - clip.startMs) / 1000).toFixed(3));
      const graph = args[args.indexOf("-filter_complex") + 1]!;
      expect(graph).toContain("crop=iw/4:ih/4:iw*3/4:0");
      expect(graph).toContain("overlay=W-w-10:10");
      expect(graph).toContain("scale=1080:1920");
      expect(graph).toContain("subtitles=filename=");
      expect(args.slice(args.indexOf("-c:v"), args.indexOf("-c:v") + 6)).toEqual(["-c:v", "libx264", "-crf", "18", "-preset", real ? "ultrafast" : "slow"]);
      expect(args).toContain("aac");
    }
    // Aucune seconde passe (aucun short ne dépasse 50 Mo).
    expect(ffCalls.some((a) => a.some((x) => /\.crf\d+\./.test(x)))).toBe(false);
    // Sous-titres : deux écoutes par short (une biaisée, une sans biais).
    for (const id of clipIds) {
      const calls = sttCalls.filter((c) => c.path.includes(id));
      expect(calls.map((c) => c.biased)).toEqual([true, false]);
    }
  });

  it("shorts rangés dans Telegram (canal « Médiathèque », jamais en base) et aperçus envoyés avec ✅ ✏️ ❌", async () => {
    const clips = await clipsOf(jobA);
    expect(clips.map((c) => c.status)).toEqual(["PREVIEW_SENT", "PREVIEW_SENT", "CUTTING"]);
    for (const c of clips.slice(0, 2)) {
      const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: c.assetId! }, include: { telegramFiles: true } });
      expect(asset).toMatchObject({ kind: "SHORT", storage: "telegram", mimeType: "video/mp4", width: 1080, height: 1920, sourceAssetId: (await prisma.montageJob.findUniqueOrThrow({ where: { id: jobA } })).sourceAssetId });
      expect(asset.bytes.length).toBe(0);
      expect(asset.libraryMessageId).not.toBeNull();
      expect(asset.telegramRef).toMatchObject({ chatId: LIBRARY_CHAT, via: "library", botId: ids.kevin });
      expect(asset.telegramFiles.map((f) => f.botId)).toEqual([ids.kevin]);
      expect(c.subtitlesSrt).toContain("Rien ne va plus");
      expect(c.qc).toMatchObject({ ok: true });
      const preview = adminOut.find((m) => m.assetId === c.assetId)!;
      expect(preview.text).toMatch(new RegExp(`Short ${c.index}/3 — 15s — vertical 9:16`));
      expect(flatButtons(preview.buttons)).toEqual([`msh:${c.id}:ok`, `msh:${c.id}:edit`, `msh:${c.id}:no`]);
      expect(BigInt(preview.messageId)).toBe(c.previewMsgId);
    }
    expect(stored.every((s) => s.chatId === LIBRARY_CHAT)).toBe(true);
    // Fichiers du short effacés dès qu'il est rangé ; seule la source reste.
    expect(await listFiles(join(workDir, jobA))).toEqual(["source.mp4"]);
    expect(await eventsOf("agents.montage.short_stored")).toBe(2);
  });

  it("doute de sous-titre (écoutes différentes) → question → réponse → short repris jusqu'à l'aperçu", async () => {
    const clip = await prisma.shortClip.findUniqueOrThrow({ where: { id: clipIds[2]! } });
    expect(clip.subtitlesSrt).toBeNull();
    expect(clip.subtitlesPending).not.toBeNull();
    expect(rendersOf(clip.id)).toHaveLength(0);
    const question = adminOut.find((m) => flatButtons(m.buttons).some((b) => b.startsWith(`mst:${clip.id}:`)))!;
    expect(question.text).toMatch(/short 3/);
    expect(question.text).toMatch(/martingale/);
    expect(question.text).toMatch(/martindale/);
    const choice = question.buttons.flat().find((b) => b.text === "martingale")!;
    expect(choice).toBeTruthy();
    const reply = await toKevin(callbackUpdate(choice.callbackData, question.messageId));
    expect(reply.length).toBeGreaterThan(0);
    expect(queue.map((q) => q.job.type)).toEqual(["montage.dress"]);
    await drain();
    const after = await prisma.shortClip.findUniqueOrThrow({ where: { id: clip.id } });
    expect(after.subtitlesSrt).toContain("la martingale ça marche");
    expect(after.subtitlesSrt).not.toContain("martindale");
    expect(after.status).toBe("PREVIEW_SENT");
    expect(rendersOf(clip.id)).toHaveLength(1);
    expect(await eventsOf("agents.montage.subtitle_doubt")).toBe(1);
    expect(await eventsOf("agents.montage.subtitle_resolved")).toBe(1);
    expect((await auditsOf("montage.subtitle.answered")).map((a) => [a.entityId, a.userId])).toEqual([[clip.id, ids.user]]);
    expect((await prisma.montageJob.findUniqueOrThrow({ where: { id: jobA } })).status).toBe("PREVIEW");
  }, 120_000);

  it("✅ sur l'aperçu du short 1 → APPROVED, journal", async () => {
    const reply = await pressPreview(clipIds[0]!, "ok");
    expect(reply).toMatch(/1/);
    expect((await prisma.shortClip.findUniqueOrThrow({ where: { id: clipIds[0]! } })).status).toBe("APPROVED");
    const audit = await auditsOf("montage.short.approved");
    expect(audit.map((a) => a.entityId)).toEqual([clipIds[0]]);
    expect(audit[0]!.userId).toBe(ids.user);
    expect(await eventsOf("agents.montage.short_approved")).toBe(1);
  });

  it("« le 2, 10 secondes au lieu de 15 » → short 2 refait (nouveau rendu de 10 s, nouvel aperçu)", async () => {
    const before = await prisma.shortClip.findUniqueOrThrow({ where: { id: clipIds[1]! } });
    const renders = rendersOf(before.id).length;
    const reply = await toKevin(textUpdate("le 2, 10 secondes au lieu de 15"));
    expect(reply).toMatch(/2/);
    const redo = await prisma.shortClip.findUniqueOrThrow({ where: { id: before.id } });
    expect(redo).toMatchObject({ status: "REDO", redoCount: 1, assetId: null, startMs: before.startMs, endMs: before.startMs + 10_000, durationMs: 10_000 });
    await drain();
    const after = await prisma.shortClip.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.status).toBe("PREVIEW_SENT");
    expect(after.assetId).not.toBeNull();
    expect(after.assetId).not.toBe(before.assetId);
    const last = rendersOf(before.id).slice(renders);
    expect(last).toHaveLength(1);
    expect(last[0]![last[0]!.indexOf("-t") + 1]).toBe("10.000");
    const preview = adminOut.filter((m) => m.assetId === after.assetId);
    expect(preview).toHaveLength(1);
    expect(preview[0]!.text).toMatch(/Short 2\/3 — 10s/);
    // ✅ sous l'aperçu de l'ANCIENNE version : refusé, rien n'est validé.
    await toKevin(callbackUpdate(`msh:${before.id}:ok`, Number(before.previewMsgId)));
    expect((await prisma.shortClip.findUniqueOrThrow({ where: { id: before.id } })).status).toBe("PREVIEW_SENT");
    expect(await eventsOf("agents.montage.short_redo")).toBe(1);
    expect((await auditsOf("montage.short.modified")).map((a) => [a.entityId, a.userId])).toEqual([[before.id, ids.user]]);
  }, 120_000);

  it("❌ sur le short 3 → REJECTED (archivé) ; ✅ sur le 2 → travail terminé, Kevin demande où les envoyer", async () => {
    await pressPreview(clipIds[2]!, "no");
    const rejected = await prisma.shortClip.findUniqueOrThrow({ where: { id: clipIds[2]! } });
    expect(rejected.status).toBe("REJECTED");
    // Archivé : le short reste dans la médiathèque (Telegram), il ne part nulle part.
    expect(rejected.assetId).not.toBeNull();
    expect((await auditsOf("montage.short.rejected")).map((a) => a.entityId)).toEqual([clipIds[2]]);
    const reply = await pressPreview(clipIds[1]!, "ok");
    expect(reply).toMatch(/2\/3/);
    const job = await prisma.montageJob.findUniqueOrThrow({ where: { id: jobA } });
    expect(job.status).toBe("DONE");
    expect(job.completedAt).not.toBeNull();
    expect(job.shortCount).toBe(3);
    // Travail fini depuis le webhook : le ménage du disque du worker lui est confié (tâche `montage.cleanup`).
    expect(queue.map((q) => q.job.type)).toEqual(["montage.cleanup"]);
    await drain();
    expect(await listFiles(workDir)).toEqual([]);
  });

  it("« envoie les validés dans le canal Test » → un post par short VALIDÉ seulement, envoyés par le bot du canal", async () => {
    const clips = await clipsOf(jobA);
    const approved = clips.filter((c) => c.status === "APPROVED").map((c) => c.assetId!);
    expect(approved).toHaveLength(2);
    const reply = await toKevin(textUpdate("envoie les validés dans le canal Test"));
    expect(reply).toMatch(/2/);
    expect(siteOpsCalls.map((c) => c.op)).toEqual(["messages.programmer", "messages.programmer"]);
    const posts = await prisma.post.findMany({ where: { channelId: ids.testChannel } });
    expect(posts.flatMap((p) => p.mediaAssetIds as string[]).sort()).toEqual([...approved].sort());
    expect((await auditsOf("montage.shorts.sent"))[0]?.metadata).toMatchObject({ channelId: ids.testChannel, count: 2 });

    // Envoi réel par le scheduler et la file telegram-send (bot du canal simulé) : les octets viennent de Telegram.
    await prisma.post.updateMany({ where: { id: { in: posts.map((p) => p.id) } }, data: { scheduledAt: new Date(Date.now() - 1000) } });
    expect(await processScheduler(fakeJob({ type: "tick" as const }))).toMatchObject({ claimed: 2 });
    for (const p of posts) await processTelegramSend(fakeJob({ type: "post" as const, postId: p.id }));
    expect(channelCalls.filter((c) => c.method === "sendVideo")).toHaveLength(2);
    expect((await prisma.post.findMany({ where: { id: { in: posts.map((p) => p.id) } } })).every((p) => p.status === "SENT")).toBe(true);
  });

  it("un short non validé ne part jamais (tentative directe refusée)", async () => {
    const clips = await clipsOf(jobA);
    const rejectedAsset = clips.find((c) => c.status === "REJECTED")!.assetId!;
    // Ancienne version du short 2 (avant la modification) : rangée mais jamais validée.
    const orphan = await prisma.mediaAsset.findFirstOrThrow({ where: { kind: "SHORT", id: { notIn: clips.map((c) => c.assetId!) } } });
    const before = channelCalls.filter((c) => c.method === "sendVideo").length;
    for (const assetId of [rejectedAsset, orphan.id]) {
      const post = await prisma.post.create({
        data: { code: `X${assetId.slice(-6)}`, channelId: ids.testChannel, botId: ids.channelBot, status: "SENDING", scheduledAt: new Date(), mediaAssetIds: [assetId] },
      });
      await processTelegramSend(fakeJob({ type: "post" as const, postId: post.id }));
      const after = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
      expect(after.status).toBe("FAILED");
      expect(after.lastError).toMatch(/pas encore validé/);
    }
    expect(channelCalls.filter((c) => c.method === "sendVideo").length).toBe(before);
  });

  it("annulation d'un autre travail → CANCELLED, shorts abandonnés, fichiers effacés", async () => {
    const reply = await toKevin(await videoUpdate(`src-b-${mode}`, "fais-moi des shorts de 20 secondes"));
    expect(reply).toMatch(/plan de coupe/);
    jobB = (await prisma.montageJob.findFirstOrThrow({ where: { id: { not: jobA } } })).id;
    await drain();
    expect((await prisma.montageJob.findUniqueOrThrow({ where: { id: jobB } })).status).toBe("PLAN_SENT");
    expect(await listFiles(join(workDir, jobB))).toEqual(["source.mp4"]);
    const cancel = await toKevin(textUpdate("annule le montage"));
    expect(cancel.length).toBeGreaterThan(0);
    const job = await prisma.montageJob.findUniqueOrThrow({ where: { id: jobB } });
    expect(job.status).toBe("CANCELLED");
    expect((await clipsOf(jobB)).every((c) => c.status === "CANCELLED")).toBe(true);
    expect((await clipsOf(jobA)).map((c) => c.status)).toEqual(["APPROVED", "APPROVED", "REJECTED"]);
    expect(await eventsOf("agents.montage.job_cancelled")).toBe(1);
    expect((await auditsOf("boss.annuler_montage")).length).toBe(1);
    expect(queue.map((q) => q.job.type)).toEqual(["montage.cleanup"]);
    await drain();
    expect(await listFiles(join(workDir, jobB))).toEqual([]);
  });

  it("à la fin : aucun fichier temporaire, aucun octet de vidéo en base, rien d'autre parti", async () => {
    expect(await listFiles(workDir)).toEqual([]);
    const media = await prisma.mediaAsset.findMany({ where: { kind: { in: ["LONG_VIDEO", "SHORT"] } } });
    expect(media.filter((m) => m.kind === "LONG_VIDEO")).toHaveLength(2);
    expect(media.filter((m) => m.kind === "SHORT")).toHaveLength(4);
    for (const m of media) {
      expect(m.storage).toBe("telegram");
      expect(m.bytes.length).toBe(0);
    }
    // Tout est passé par le chemin rapide : aucune phrase envoyée à l'interprète IA de Kevin.
    expect(orchestratorJobs).toHaveLength(0);
    // Kevin a toujours répondu en privé à l'admin, jamais ailleurs.
    expect(kevinCalls.filter((c) => c.method === "sendMessage").every((c) => Number(c.payload.chat_id) === ADMIN)).toBe(true);
  });
}

describe("équipe Montage de bout en bout (ffmpeg scripté)", () => montageScenario("scripted"));

describe.skipIf(process.env.MONTAGE_FFMPEG !== "docker" || !realFfmpegAvailable())("équipe Montage de bout en bout (vrai ffmpeg, image Docker lap-ffmpeg)", () => montageScenario("docker"));

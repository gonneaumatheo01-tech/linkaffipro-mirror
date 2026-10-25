/**
 * Phase 28, chantier E — Kevin et le montage (base en mémoire, fausse IA `createFakeBossLlm`, faux pipeline par
 * `deps.montageKevin`, faux site, aucun réseau) : réception (légende, phrase avant / après, vidéo seule → question,
 * document vidéo, plus de 2 Go, format inconnu, transfert pour un post), plan et ajustements, doute de sous-titre,
 * aperçu + boutons, ✅ / ✏️ / ❌, « ok sauf le 3 », envoi des validés dans un canal (OUI), aucune publication sans ✅,
 * annulation, voix (`voiceCheck` sur toutes les variantes).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBossKit, type BossKit } from "../boss/testing";
import { bossFastPath } from "../boss/fast";
import { resetVoiceRotation, voiceCheck, voiceEntryTexts, type VoiceTable } from "../boss/voice";
import { ADMIN_TG_ID } from "../human/test-kit";
import type { SiteOpsClient } from "../site/contract";
import type { KevinMontageDeps, MontageKevinPort, PlanEdit, ClipChange } from "./kevin-port";
import { readMontageAwait, readMontageState } from "./kevin-state";
import { montageVideoQuestion, receiveMontageVideo, RECEPTION_VARIANTS, type VideoMessage, montageIntentOf, looksLikeMontageInstructions } from "./reception";
import { countAfterEdits, parsePlanReply, planMessages, PLAN_VARIANTS } from "./plan-message";
import { failedText, friendlyReason, PREVIEW_VARIANTS } from "./preview";
import { decideShort, FEEDBACK_VARIANTS, handleMontageCallback, parseClipChange, parseDestination, parsePreviewReply } from "./feedback";
import { createKevinMontageHooks } from "./hooks";
import { VIEW_VARIANTS, montageAgentCard } from "./kevin-view";
import { CATALOG_MONTAGE_VARIANTS } from "../boss/catalog-montage";
import { agentCard, findAgent } from "../orders/agents-dict";
import { capability } from "../orders/registry";
import type { MontageJobRow, ShortClipRow, StoredShort } from "./runtime";

const CHAT = ADMIN_TG_ID.toString();

type Calls = {
  approve: Array<{ jobId: string; edits: PlanEdit[] }>;
  redo: Array<{ clipId: string; change: ClipChange }>;
  cancel: string[];
  subtitle: Array<{ clipId: string; index: number; text: string }>;
  jobs: string[];
  site: Array<{ op: string; input: Record<string, unknown> }>;
  videos: Array<{ chatId: string; assetId: string; caption: string; buttons?: Array<Array<{ text: string; callbackData: string }>> }>;
};

async function setup(table: Parameters<typeof createBossKit>[0] = []) {
  const kit = await createBossKit(table);
  const calls: Calls = { approve: [], redo: [], cancel: [], subtitle: [], jobs: [], site: [], videos: [] };
  const p = kit.prisma;
  const port: Partial<MontageKevinPort> = {
    async createLongVideoAsset(_d, input) {
      const a = await p.mediaAsset.create({ data: { filename: "v.mp4", mimeType: input.mimeType ?? "video/mp4", size: input.sizeBytes ?? 0, sha256: input.fileUniqueId, kind: "LONG_VIDEO", storage: "telegram" } as never });
      return { ok: true, assetId: (a as { id: string }).id, created: true };
    },
    async createMontageJob(_d, input) {
      const j = await p.montageJob.create({ data: { sourceAssetId: input.sourceAssetId, instructions: input.instructions, chatId: input.chatId, status: "PENDING", planApprovedAt: null, sourceMeta: { durationMs: 47 * 60_000 } } as never });
      calls.jobs.push((j as { id: string }).id);
      return { id: (j as { id: string }).id };
    },
    async approvePlan(_d, jobId, edits) {
      calls.approve.push({ jobId, edits });
      await p.montageJob.updateMany({ where: { id: jobId }, data: { status: "CUTTING", planApprovedAt: new Date() } });
      return { ok: true, kept: 3, removed: [], problems: [] };
    },
    async redoClip(_d, clipId, change) {
      calls.redo.push({ clipId, change });
      await p.shortClip.updateMany({ where: { id: clipId }, data: { status: "REDO" } });
      return { ok: true };
    },
    async cancelJob(_d, jobId) {
      calls.cancel.push(jobId);
      await p.montageJob.updateMany({ where: { id: jobId }, data: { status: "CANCELLED" } });
      return { ok: true };
    },
    async resolveSubtitleDoubt(_d, clipId, answer) {
      calls.subtitle.push({ clipId, ...answer });
      return { ok: true, done: true, remaining: [] };
    },
    async setClipDecision(_d, clipId, decision) {
      await p.shortClip.updateMany({ where: { id: clipId }, data: { status: decision } });
      return { ok: true };
    },
  };
  const siteOps: SiteOpsClient = vi.fn(async (req: Parameters<SiteOpsClient>[0]) => {
    calls.site.push({ op: req.op, input: req.input });
    return { ok: true as const, message: "Programmé." };
  });
  const deps: KevinMontageDeps = {
    ...kit.deps,
    montageKevin: port,
    siteOps,
    sendStoredVideo: async (req) => {
      calls.videos.push(req);
      return { messageId: 9000 + calls.videos.length };
    },
  };
  return { kit, deps, calls };
}

let mid = 500;
function video(extra: Partial<VideoMessage> = {}): VideoMessage {
  return { messageId: mid++, fileId: `f${mid}`, fileUniqueId: `u${mid}`, sizeBytes: 800 * 1024 * 1024, durationSec: 47 * 60, width: 1920, height: 1080, mimeType: "video/mp4", fileName: "live.mp4", asDocument: false, ...extra };
}

const lastSent = (kit: BossKit) => kit.sent[kit.sent.length - 1]?.html ?? "";
const reply = (r: { reply?: string } | { handled: boolean }) => String((r as { reply?: string }).reply ?? "");

async function seedJob(t: Awaited<ReturnType<typeof setup>>, opts: { status?: string; clips?: number; clipStatus?: string; withAsset?: boolean } = {}) {
  const p = t.kit.prisma;
  const asset = (await p.mediaAsset.create({ data: { filename: "src.mp4", mimeType: "video/mp4", size: 1, sha256: `s${mid++}`, kind: "LONG_VIDEO" } as never })) as { id: string };
  const job = (await p.montageJob.create({
    data: { sourceAssetId: asset.id, instructions: {}, chatId: CHAT, status: opts.status ?? "PLAN_SENT", planApprovedAt: opts.status && opts.status !== "PLAN_SENT" ? new Date() : null, sourceMeta: { durationMs: 47 * 60_000 }, shortCount: 0 } as never,
  })) as MontageJobRow;
  const clips: ShortClipRow[] = [];
  const descs = ["Gros gain à la roulette", "Série de mises", "Réaction au jackpot", "La bille tombe sur le 17", "Dernière mise"];
  for (let i = 1; i <= (opts.clips ?? 3); i++) {
    const short = opts.withAsset ? ((await p.mediaAsset.create({ data: { filename: `s${i}.mp4`, mimeType: "video/mp4", size: 18 * 1024 * 1024, sha256: `sh${mid++}`, kind: "SHORT" } as never })) as { id: string }) : null;
    clips.push(
      (await p.shortClip.create({
        data: {
          montageJobId: job.id,
          index: i,
          startMs: 150_000 + i * 160_000,
          endMs: 165_000 + i * 160_000,
          durationMs: 15_000,
          description: descs[(i - 1) % descs.length],
          score: 10 - i,
          format: "VERTICAL_9_16",
          pipPosition: "NONE",
          subtitles: true,
          subtitlesPending: null,
          status: opts.clipStatus ?? "PLANNED",
          assetId: short?.id ?? null,
          compressed: false,
          previewMsgId: null,
          redoCount: 0,
        } as never,
      })) as ShortClipRow,
    );
  }
  return { job, clips };
}

beforeEach(() => resetVoiceRotation());

// ---------------------------------------------------------------------------------------------------- réception

describe("réception d'une vidéo par Kevin", () => {
  it("vidéo + légende : source enregistrée, consignes comprises, montage créé, « J'ai reçu ta vidéo (47 min, 1080p) »", async () => {
    const t = await setup();
    const r = await receiveMontageVideo(t.deps, { chatId: CHAT, video: video(), botId: "boss_1", forwarded: false, caption: "Kevin, découpe ça en shorts de 15 secondes, cam en haut à droite, thème roulette" });
    expect(r.action).toBe("reply");
    const text = (r as { reply: string }).reply;
    expect(text).toMatch(/reçu.*\(47 min, 1080p\)/);
    expect(text).toMatch(/plan de coupe/);
    expect(text).toContain("cam en haut à droite");
    expect(t.calls.jobs).toHaveLength(1);
    const job = t.kit.tables("montageJob")[0]!;
    expect((job.instructions as { durationTarget: number; pipPosition: string; theme: string }).durationTarget).toBe(15);
    expect((job.instructions as { pipPosition: string }).pipPosition).toBe("TOP_RIGHT");
    expect(voiceCheck(text).problems).toEqual([]);
    // Rien n'est téléchargé : seule une fiche LONG_VIDEO gardée dans Telegram.
    expect(t.kit.tables("mediaAsset")[0]).toMatchObject({ kind: "LONG_VIDEO", storage: "telegram" });
  });

  it("phrase AVANT la vidéo : gardée, la vidéo qui arrive la prend", async () => {
    const t = await setup();
    const first = await bossFastPath(t.deps, t.kit.input("fais des shorts de 20 secondes pour TikTok avec sous-titres"));
    expect(reply(first)).toMatch(/envoie-moi la vidéo|Envoie-moi la vidéo/);
    expect(t.calls.jobs).toHaveLength(0);
    const r = await receiveMontageVideo(t.deps, { chatId: CHAT, video: video(), botId: "boss_1", forwarded: false, caption: null });
    expect(r.action).toBe("reply");
    expect(t.calls.jobs).toHaveLength(1);
    expect((t.kit.tables("montageJob")[0]!.instructions as { durationTarget: number }).durationTarget).toBe(20);
  });

  it("phrase APRÈS la vidéo : la question n'est plus posée, le montage part", async () => {
    const t = await setup();
    const v = video();
    const r = await receiveMontageVideo(t.deps, { chatId: CHAT, video: v, botId: "boss_1", forwarded: false, caption: null });
    expect(r).toEqual({ action: "ask", messageId: v.messageId });
    const after = await bossFastPath(t.deps, t.kit.input("15 secondes, cam en haut"));
    expect(reply(after)).toMatch(/reçu/);
    expect(t.calls.jobs).toHaveLength(1);
    expect(await montageVideoQuestion(t.deps, CHAT, v.messageId)).toBeNull();
  });

  it("vidéo seule : « je la monte ou je la garde ? » avec 2 boutons ; « La garder » la range, rien n'est lancé", async () => {
    const t = await setup();
    const v = video();
    await receiveMontageVideo(t.deps, { chatId: CHAT, video: v, botId: "boss_1", forwarded: false, caption: null });
    const q = await montageVideoQuestion(t.deps, CHAT, v.messageId);
    expect(q?.reply).toMatch(/47 min, 1080p/);
    expect(q?.buttons[0]!.map((b) => b.callbackData)).toEqual([`mvc:${v.messageId}:m`, `mvc:${v.messageId}:l`]);
    const kept = await handleMontageCallback(t.deps, { data: `mvc:${v.messageId}:l`, fromTelegramId: ADMIN_TG_ID, chatId: CHAT });
    expect(kept.reply).toMatch(/médiathèque/);
    expect(t.calls.jobs).toHaveLength(0);
    const again = await handleMontageCallback(t.deps, { data: `mvc:${v.messageId}:m`, fromTelegramId: ADMIN_TG_ID, chatId: CHAT });
    expect(again.reply).toMatch(/n'attend plus|plus cette vidéo/);
  });

  it("bouton « Faire des shorts » : montage lancé avec les réglages par défaut", async () => {
    const t = await setup();
    const v = video();
    await receiveMontageVideo(t.deps, { chatId: CHAT, video: v, botId: "boss_1", forwarded: false, caption: null });
    const r = await handleMontageCallback(t.deps, { data: `mvc:${v.messageId}:m`, fromTelegramId: ADMIN_TG_ID, chatId: CHAT });
    expect(r.reply).toMatch(/reçu/);
    expect(t.calls.jobs).toHaveLength(1);
  });

  it("document vidéo (MOV envoyé comme fichier) : accepté", async () => {
    const t = await setup();
    const r = await receiveMontageVideo(t.deps, {
      chatId: CHAT,
      video: video({ asDocument: true, mimeType: "video/quicktime", fileName: "live.mov", durationSec: null, width: null, height: null }),
      botId: "boss_1",
      forwarded: false,
      caption: "monte cette vidéo en shorts",
    });
    expect((r as { reply: string }).reply).toMatch(/reçu/);
    expect(t.calls.jobs).toHaveLength(1);
  });

  it("plus de 2 Go, plus de 3 h, format inconnu : refus clair, rien d'enregistré", async () => {
    const t = await setup();
    const big = await receiveMontageVideo(t.deps, { chatId: CHAT, video: video({ sizeBytes: 2.4 * 1024 ** 3 }), botId: "b", forwarded: false, caption: "découpe ça" });
    expect((big as { reply: string }).reply).toMatch(/2,4 Go.*2 Go au plus/);
    const long = await receiveMontageVideo(t.deps, { chatId: CHAT, video: video({ durationSec: 3.5 * 3600 }), botId: "b", forwarded: false, caption: "découpe ça" });
    expect((long as { reply: string }).reply).toMatch(/3 h au plus/);
    const odd = await receiveMontageVideo(t.deps, { chatId: CHAT, video: video({ asDocument: true, mimeType: "video/x-flv", fileName: "a.flv" }), botId: "b", forwarded: false, caption: "découpe ça" });
    expect((odd as { reply: string }).reply).toMatch(/format/);
    expect(t.calls.jobs).toHaveLength(0);
    expect(t.kit.tables("mediaAsset")).toHaveLength(0);
  });

  it("vidéo transférée sans phrase de montage : rien n'est lancé (contenu d'un post possible) ; « découpe ça » ensuite la monte", async () => {
    const t = await setup();
    const r = await receiveMontageVideo(t.deps, { chatId: CHAT, video: video(), botId: "b", forwarded: true, caption: null });
    expect(r.action).toBe("pass");
    expect(t.calls.jobs).toHaveLength(0);
    // Une demande de post ne lance pas de montage.
    expect(await bossFastPath(t.deps, t.kit.input("programme ça sur Casino VIP demain 20 h"))).toMatchObject({ handled: false });
    expect(t.calls.jobs).toHaveLength(0);
    const go = await bossFastPath(t.deps, t.kit.input("découpe ça en shorts"));
    expect(reply(go)).toMatch(/reçu/);
    expect(t.calls.jobs).toHaveLength(1);
  });

  it("légende à mots-clés de la médiathèque (#casino #roulette) : chemin de la médiathèque", async () => {
    const t = await setup();
    const r = await receiveMontageVideo(t.deps, { chatId: CHAT, video: video({ sizeBytes: 5 * 1024 * 1024 }), botId: "b", forwarded: false, caption: "#casino #roulette" });
    expect(r.action).toBe("pass");
  });

  it("intentions reconnues (pur)", () => {
    expect(montageIntentOf("Kevin, découpe ça")).toBe("launch");
    expect(montageIntentOf("fais-moi 10 clips de 15 secondes")).toBe("launch");
    expect(montageIntentOf("monte cette vidéo")).toBe("launch");
    expect(montageIntentOf("où en est le montage ?")).toBe("status");
    expect(montageIntentOf("montre-moi les shorts")).toBe("view");
    expect(montageIntentOf("annule le montage en cours")).toBe("cancel");
    expect(montageIntentOf("combien j'ai dépensé ce mois ?")).toBeNull();
    expect(looksLikeMontageInstructions("15 secondes, cam en haut")).toBe(true);
    expect(looksLikeMontageInstructions("vertical pour TikTok avec sous-titres")).toBe(true);
    expect(looksLikeMontageInstructions("#casino #roulette")).toBe(false);
    expect(looksLikeMontageInstructions("programme ça demain 20 h")).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------- plan

describe("plan de coupe et ajustements", () => {
  it("message du plan : lignes « 1. 2:30-2:45 — … (⭐ 9/10) » puis la question ; Kevin attend la réponse", async () => {
    const t = await setup();
    const { job, clips } = await seedJob(t);
    await createKevinMontageHooks().onPlanReady(t.deps as never, job, clips);
    const text = lastSent(t.kit);
    expect(text).toMatch(/3 moments/);
    expect(text).toContain("1. 5:10-5:25 — Gros gain à la roulette (note 9/10)"); // 150 + 160 s = 310 s = 5:10
    expect(text).toContain("3. 10:30-10:45 — Réaction au jackpot (note 7/10)");
    expect(text).toMatch(/Je lance le montage|On lance|Tu veux modifier|changer/);
    expect((await readMontageAwait(t.deps, CHAT))?.kind).toBe("plan");
  });

  it("réponses comprises par les règles (pur)", () => {
    expect(parsePlanReply("ok")).toEqual({ kind: "approve", edits: [] });
    expect(parsePlanReply("ok lance")).toEqual({ kind: "approve", edits: [] });
    expect(parsePlanReply("enlève le 3")).toEqual({ kind: "approve", edits: [{ kind: "remove", index: 3 }] });
    expect(parsePlanReply("ok sauf le 3")).toEqual({ kind: "approve", edits: [{ kind: "remove", index: 3 }] });
    expect(parsePlanReply("le 2, commence 2 secondes plus tôt")).toEqual({ kind: "approve", edits: [{ kind: "shift", index: 2, startDeltaMs: -2000 }] });
    expect(parsePlanReply("10 secondes au lieu de 15")).toEqual({ kind: "approve", edits: [{ kind: "duration", index: null, seconds: 10 }] });
    expect(parsePlanReply("garde que les 5 meilleurs")).toEqual({ kind: "approve", edits: [{ kind: "keepBest", count: 5 }] });
    expect(parsePlanReply("je sais pas trop")).toEqual({ kind: "unknown" });
    expect(countAfterEdits([{ index: 1, startMs: 0, endMs: 1, description: null, score: 9 }, { index: 2, startMs: 0, endMs: 1, description: null, score: 5 }], [{ kind: "keepBest", count: 1 }])).toBe(1);
  });

  it("« enlève le 3 » par Kevin : la chaîne reçoit l'ajustement et lance", async () => {
    const t = await setup();
    const { job, clips } = await seedJob(t);
    await createKevinMontageHooks().onPlanReady(t.deps as never, job, clips);
    const r = await bossFastPath(t.deps, t.kit.input("enlève le 3"));
    expect(t.calls.approve).toEqual([{ jobId: job.id, edits: [{ kind: "remove", index: 3 }] }]);
    expect(reply(r)).toMatch(/j'enlève le 3/);
    expect(voiceCheck(reply(r)).problems).toEqual([]);
  });

  it("« ok » : lancé tel quel ; numéro inconnu → Kevin le dit sans rien lancer", async () => {
    const t = await setup();
    const { job, clips } = await seedJob(t);
    await createKevinMontageHooks().onPlanReady(t.deps as never, job, clips);
    const bad = await bossFastPath(t.deps, t.kit.input("enlève le 9"));
    expect(reply(bad)).toMatch(/pas de moment 9|pas de 9/);
    expect(t.calls.approve).toHaveLength(0);
    const ok = await bossFastPath(t.deps, t.kit.input("ok"));
    expect(t.calls.approve).toEqual([{ jobId: job.id, edits: [] }]);
    expect(reply(ok)).toMatch(/✅/);
  });

  it("réponse que les règles ne comprennent pas : Haiku (fausse IA) donne l'ajustement", async () => {
    const t = await setup([[/celui où il perd/, { name: "ajuster_plan", input: { lancer: true, ajustements: [{ type: "retirer", numero: 2 }] } }]]);
    const { job, clips } = await seedJob(t);
    await createKevinMontageHooks().onPlanReady(t.deps as never, job, clips);
    await bossFastPath(t.deps, t.kit.input("vire le moment celui où il perd"));
    expect(t.calls.approve[0]!.edits).toEqual([{ kind: "remove", index: 2 }]);
  });

  it("plan trop long : découpé en plusieurs messages, la question dans le dernier", () => {
    const clips = Array.from({ length: 20 }, (_, i) => ({ index: i + 1, startMs: i * 60_000, endMs: i * 60_000 + 15_000, description: `Moment ${i + 1} : ${"une longue description de ce qui se passe à la table ".repeat(4)}`, score: 8 }));
    const parts = planMessages(clips, 3600, CHAT, 1200);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(4096);
    expect(parts[parts.length - 1]).toMatch(/lance/i);
    expect(parts[0]).not.toMatch(/Je lance le montage \?/);
    expect(parts.join("\n")).toContain("20. ");
  });
});

// ---------------------------------------------------------------------------------------------------- sous-titres

describe("doute sur un sous-titre", () => {
  it("question avec un bouton par variante + « autre » ; le bouton corrige le passage", async () => {
    const t = await setup();
    const { job, clips } = await seedJob(t, { status: "CUTTING", clipStatus: "DRESSING" });
    const clip = clips[2]!;
    const doubt = { index: 1, atMs: 8000, text: "martindale", alternatives: ["martingale", "martindale"] };
    await t.kit.prisma.shortClip.updateMany({ where: { id: clip.id }, data: { subtitlesPending: { segments: [], uncertain: [doubt] } } });
    await createKevinMontageHooks().onSubtitleDoubt(t.deps as never, job, clip, [doubt]);
    const sent = t.kit.sent[t.kit.sent.length - 1]!;
    expect(sent.html).toMatch(/à 0:08 du short 3/);
    expect(sent.html).toContain("« martingale » ou « martindale »");
    expect(sent.buttons!.map((r) => r[0]!.callbackData)).toEqual([`mst:${clip.id}:1:0`, `mst:${clip.id}:1:1`, `mst:${clip.id}:1:x`]);
    const r = await handleMontageCallback(t.deps, { data: `mst:${clip.id}:1:0`, fromTelegramId: ADMIN_TG_ID, chatId: CHAT });
    expect(t.calls.subtitle).toEqual([{ clipId: clip.id, index: 1, text: "martingale" }]);
    expect(r.reply).toMatch(/corrigé/);
  });

  it("« autre » : Kevin attend le texte, le message suivant corrige le passage", async () => {
    const t = await setup();
    const { clips } = await seedJob(t, { status: "CUTTING", clipStatus: "DRESSING" });
    const clip = clips[0]!;
    await t.kit.prisma.shortClip.updateMany({ where: { id: clip.id }, data: { subtitlesPending: { segments: [], uncertain: [{ index: 2, atMs: 3000, text: "x", alternatives: ["a", "b"] }] } } });
    const r = await handleMontageCallback(t.deps, { data: `mst:${clip.id}:2:x`, fromTelegramId: ADMIN_TG_ID, chatId: CHAT });
    expect(r.reply).toMatch(/bon texte/);
    await bossFastPath(t.deps, t.kit.input("la martingale c'est fini"));
    expect(t.calls.subtitle).toEqual([{ clipId: clip.id, index: 2, text: "la martingale c'est fini" }]);
  });
});

// ---------------------------------------------------------------------------------------------------- aperçus et retours

describe("aperçu, ✅ / ✏️ / ❌ et réponses écrites", () => {
  const stored = (assetId: string, extra: Partial<StoredShort> = {}): StoredShort => ({
    assetId,
    created: true,
    fileId: "F1",
    fileUniqueId: "U1",
    messageId: 1,
    chatId: "-100",
    sizeBytes: Math.round(18.4 * 1024 * 1024),
    durationMs: 15_000,
    width: 1080,
    height: 1920,
    compressed: false,
    ...extra,
  });

  it("aperçu : la vidéo part par son identifiant de fichier, légende « Short 3/3 — 15s — vertical 9:16 — 18,4 Mo », 3 boutons", async () => {
    const t = await setup();
    const { job, clips } = await seedJob(t, { status: "CUTTING", clipStatus: "QC", withAsset: true });
    const clip = clips[2]!;
    const r = await createKevinMontageHooks().onPreviewReady(t.deps as never, job, clip, stored(clip.assetId!));
    expect(r).toEqual({ messageId: 9001 });
    const v = t.calls.videos[0]!;
    expect(v.assetId).toBe(clip.assetId);
    expect(v.caption).toContain("Short 3/3 — 15s — vertical 9:16 — 18,4 Mo");
    expect(v.caption).toContain("Réaction au jackpot");
    expect(v.buttons![0]!.map((b) => b.callbackData)).toEqual([`msh:${clip.id}:ok`, `msh:${clip.id}:edit`, `msh:${clip.id}:no`]);
    expect(v.buttons![0]!.map((b) => b.text)).toEqual(["✅ Valider", "✏️ Modifier", "❌ Refuser"]);
    // Short compressé : Kevin le dit.
    await createKevinMontageHooks().onPreviewReady(t.deps as never, job, clips[0]!, stored(clips[0]!.assetId!, { compressed: true }));
    expect(t.calls.videos[1]!.caption).toMatch(/compressé/);
  });

  it("contrôle raté : phrase simple + Refaire / Laisser tomber ; échec : jamais d'erreur technique brute", async () => {
    const t = await setup();
    const { job, clips } = await seedJob(t, { status: "CUTTING", clipStatus: "QC_FAILED" });
    await createKevinMontageHooks().onQcFailed(t.deps as never, job, clips[1]!, { ok: false, durationMs: 0, width: 0, height: 0, sizeBytes: 0, blackSec: 3.2, silent: false, clipping: false, problems: ["3,2 s de noir au début"] });
    const m = t.kit.sent[t.kit.sent.length - 1]!;
    expect(m.html).toMatch(/short 2/);
    expect(m.html).toContain("3,2 s de noir au début");
    expect(m.buttons![0]!.map((b) => b.callbackData)).toEqual([`msq:${clips[1]!.id}:redo`, `msq:${clips[1]!.id}:drop`]);
    const redo = await handleMontageCallback(t.deps, { data: `msq:${clips[1]!.id}:redo`, fromTelegramId: ADMIN_TG_ID, chatId: CHAT });
    expect(t.calls.redo).toHaveLength(1);
    expect(redo.reply).toMatch(/refais|relance/);
    await createKevinMontageHooks().onFailed(t.deps as never, job, "Error: ENOENT /tmp/montage/x/source.mp4 at ffmpeg.run (runner.ts:12)", null);
    const f = t.kit.sent[t.kit.sent.length - 1]!.html;
    expect(f).not.toMatch(/ENOENT|ffmpeg|tmp/);
    expect(f).toMatch(/souci technique|problème technique/);
    expect(friendlyReason("la vidéo est illisible")).toBe("la vidéo est illisible");
    expect(failedText("la vidéo est illisible", CHAT)).toContain("la vidéo est illisible");
  });

  it("✅ → validé ; ❌ → refusé ; ✏️ → question, puis « raccourcis de 2 secondes » refait le short ; tout tranché → bilan", async () => {
    const t = await setup();
    const { job, clips } = await seedJob(t, { status: "PREVIEW", clipStatus: "PREVIEW_SENT", withAsset: true });
    const ok = await handleMontageCallback(t.deps, { data: `msh:${clips[0]!.id}:ok`, fromTelegramId: ADMIN_TG_ID, chatId: CHAT });
    expect(ok.reply).toMatch(/Short 1|short 1/);
    expect(t.kit.tables("shortClip").find((c) => c.id === clips[0]!.id)!.status).toBe("APPROVED");
    const no = await handleMontageCallback(t.deps, { data: `msh:${clips[1]!.id}:no`, fromTelegramId: ADMIN_TG_ID, chatId: CHAT });
    expect(no.reply).toMatch(/archive|de côté/);
    expect(t.kit.tables("shortClip").find((c) => c.id === clips[1]!.id)!.status).toBe("REJECTED");
    const edit = await handleMontageCallback(t.deps, { data: `msh:${clips[2]!.id}:edit`, fromTelegramId: ADMIN_TG_ID, chatId: CHAT });
    expect(edit.reply).toMatch(/change sur le short 3|différent sur le short 3/);
    const r = await bossFastPath(t.deps, t.kit.input("raccourcis de 2 secondes"));
    expect(t.calls.redo).toEqual([{ clipId: clips[2]!.id, change: expect.objectContaining({ endDeltaMs: -2000 }) }]);
    expect(reply(r)).toMatch(/refais le short 3|short 3/);
    // Le short refait revient en aperçu puis est validé : bilan et question de destination.
    await t.kit.prisma.shortClip.updateMany({ where: { id: clips[2]!.id }, data: { status: "PREVIEW_SENT" } });
    const last = await handleMontageCallback(t.deps, { data: `msh:${clips[2]!.id}:ok`, fromTelegramId: ADMIN_TG_ID, chatId: CHAT });
    expect(last.reply).toMatch(/2\/3 shorts validés/);
    expect((await readMontageAwait(t.deps, CHAT))?.kind).toBe("destination");
    expect(job.id).toBeTruthy();
  });

  it("bouton appuyé par quelqu'un d'autre que l'admin : rien ne change", async () => {
    const t = await setup();
    const { clips } = await seedJob(t, { status: "PREVIEW", clipStatus: "PREVIEW_SENT", withAsset: true });
    const r = await handleMontageCallback(t.deps, { data: `msh:${clips[0]!.id}:ok`, fromTelegramId: 999n, chatId: CHAT });
    expect(r.reply).toBeUndefined();
    expect(t.kit.tables("shortClip").find((c) => c.id === clips[0]!.id)!.status).toBe("PREVIEW_SENT");
  });

  it("modifications comprises (pur)", () => {
    expect(parseClipChange("raccourcis de 2 secondes")).toMatchObject({ endDeltaMs: -2000 });
    expect(parseClipChange("commence 3 s plus tôt")).toMatchObject({ startDeltaMs: -3000 });
    expect(parseClipChange("cam en bas à gauche")).toMatchObject({ pipPosition: "BOTTOM_LEFT" });
    expect(parseClipChange('ajoute le texte "Gros gain"')).toMatchObject({ overlayText: "Gros gain" });
    expect(parseClipChange("sans sous-titres")).toMatchObject({ subtitles: false });
    expect(parseClipChange("bof")).toBeNull();
    expect(parsePreviewReply("ok")).toEqual({ kind: "approveAll", except: [] });
    expect(parsePreviewReply("ok sauf le 3")).toEqual({ kind: "approveAll", except: [3] });
    expect(parsePreviewReply("le 5, raccourcis de 2 secondes")).toMatchObject({ kind: "change", index: 5, change: { endDeltaMs: -2000 } });
    expect(parsePreviewReply("refuse le 4")).toEqual({ kind: "reject", indexes: [4] });
  });

  it("« ok sauf le 3 » : les autres validés, Kevin demande quoi changer sur le 3 ; « le 2, raccourcis de 2 secondes »", async () => {
    const t = await setup();
    const { clips } = await seedJob(t, { status: "PREVIEW", clipStatus: "PREVIEW_SENT", withAsset: true, clips: 4 });
    const job = t.kit.tables("montageJob")[0]!;
    await createKevinMontageHooks().onPreviewReady(t.deps as never, job as never, clips[3]!, { assetId: clips[3]!.assetId!, created: true, fileId: "F", fileUniqueId: "U", messageId: 1, chatId: "-1", sizeBytes: 1000, durationMs: 15_000, width: 1080, height: 1920, compressed: false });
    const r = await bossFastPath(t.deps, t.kit.input("ok sauf le 3"));
    expect(reply(r)).toMatch(/1, 2 et 4/);
    expect(reply(r)).toMatch(/le 3/);
    const st = t.kit.tables("shortClip");
    expect(st.filter((c) => c.status === "APPROVED").map((c) => c.index).sort()).toEqual([1, 2, 4]);
    expect(st.find((c) => c.index === 3)!.status).toBe("PREVIEW_SENT");
    const ch = await bossFastPath(t.deps, t.kit.input("cam en bas à gauche"));
    expect(t.calls.redo[0]).toMatchObject({ clipId: clips[2]!.id, change: { pipPosition: "BOTTOM_LEFT" } });
    expect(reply(ch)).toMatch(/cam en bas à gauche/);
  });
});

// ---------------------------------------------------------------------------------------------------- envoi

describe("envoi des shorts validés", () => {
  it("« envoie les validés dans le canal Casino VIP » : OUI d'abord, puis un message par short VALIDÉ seulement", async () => {
    const t = await setup();
    const { clips } = await seedJob(t, { status: "DONE", clipStatus: "APPROVED", withAsset: true, clips: 3 });
    await t.kit.prisma.shortClip.updateMany({ where: { id: clips[1]!.id }, data: { status: "REJECTED" } });
    const add = await t.kit.prisma.shortClip.create({
      data: { montageJobId: clips[0]!.montageJobId, index: 4, startMs: 0, endMs: 15_000, durationMs: 15_000, status: "PREVIEW_SENT", assetId: "pas-valide", format: "VERTICAL_9_16" } as never,
    });
    expect(add).toBeTruthy();
    await (await import("./kevin-state")).setMontageAwait(t.deps, CHAT, { kind: "destination", jobId: clips[0]!.montageJobId, at: new Date("2026-10-23T08:00:00Z").toISOString() });
    const ask = await bossFastPath(t.deps, t.kit.input("envoie les 2 validés dans le canal Casino VIP"));
    expect(reply(ask)).toMatch(/2 shorts validés.*Casino VIP/);
    expect(reply(ask)).toMatch(/OUI/);
    expect(t.calls.site).toHaveLength(0);
    const yes = await bossFastPath(t.deps, t.kit.input("OUI"));
    expect(reply(yes)).toMatch(/programmé|part/);
    expect(t.calls.site.map((c) => c.op)).toEqual(["messages.programmer", "messages.programmer"]);
    const sentAssets = t.calls.site.map((c) => (c.input.mediaAssetIds as string[])[0]);
    expect(sentAssets).toEqual([clips[0]!.assetId, clips[2]!.assetId]);
    expect(sentAssets).not.toContain("pas-valide");
    expect(t.calls.site[0]!.input.channelIds).toEqual([t.kit.ids.casino]);
    // Un toutes les heures, le premier dans 5 minutes au moins.
    expect(t.calls.site.map((c) => c.input.scheduledAt)).toEqual(["2026-10-23T10:05", "2026-10-23T11:05"]);
  });

  it("canal Test : pas de OUI, envoi tout de suite (pour voir)", async () => {
    const t = await setup();
    await seedJob(t, { status: "DONE", clipStatus: "APPROVED", withAsset: true, clips: 2 });
    const r = await bossFastPath(t.deps, t.kit.input("envoie les shorts validés sur le canal Test"));
    expect(reply(r)).not.toMatch(/OUI/);
    expect(t.calls.site).toHaveLength(2);
  });

  it("aucun short validé : rien ne part, jamais", async () => {
    const t = await setup();
    const { clips } = await seedJob(t, { status: "PREVIEW", clipStatus: "PREVIEW_SENT", withAsset: true, clips: 2 });
    const r = await bossFastPath(t.deps, t.kit.input("envoie les shorts validés dans Casino VIP"));
    expect(reply(r)).toMatch(/aucun short validé|Rien de validé/i);
    expect(t.calls.site).toHaveLength(0);
    // Un short pas encore prêt (pas d'aperçu) ne se valide pas.
    await t.kit.prisma.shortClip.updateMany({ where: { id: clips[0]!.id }, data: { status: "CUTTING" } });
    expect((await decideShort(t.deps, clips[0]!.id, "ok")).ok).toBe(false);
  });

  it("« garde-les » : rien n'est envoyé", async () => {
    const t = await setup();
    const { clips } = await seedJob(t, { status: "DONE", clipStatus: "APPROVED", withAsset: true, clips: 2 });
    await (await import("./kevin-state")).setMontageAwait(t.deps, CHAT, { kind: "destination", jobId: clips[0]!.montageJobId, at: new Date("2026-10-23T08:00:00Z").toISOString() });
    const r = await bossFastPath(t.deps, t.kit.input("garde-les"));
    expect(reply(r)).toMatch(/médiathèque/);
    expect(t.calls.site).toHaveLength(0);
    expect(parseDestination("envoie les 10 validés dans le canal Roulette")).toEqual({ kind: "send", channel: "roulette", indexes: null, spacingMinutes: null });
  });
});

// ---------------------------------------------------------------------------------------------------- catalogue, droits, ordres

describe("catalogue, annulation, état, équipe", () => {
  it("« annule le montage » : la chaîne arrête le travail en cours", async () => {
    const t = await setup();
    const { job } = await seedJob(t, { status: "CUTTING", clipStatus: "CUTTING" });
    const r = await bossFastPath(t.deps, t.kit.input("annule le montage"));
    expect(t.calls.cancel).toEqual([job.id]);
    expect(reply(r)).toMatch(/annulé/i);
  });

  it("« où en est le montage ? » et « montre-moi les shorts »", async () => {
    const t = await setup();
    await seedJob(t, { status: "PREVIEW", clipStatus: "PREVIEW_SENT", withAsset: true });
    const s = await bossFastPath(t.deps, t.kit.input("où en est le montage ?"));
    expect(reply(s)).toMatch(/3 shorts : 3 à valider/);
    const v = await bossFastPath(t.deps, t.kit.input("montre-moi les shorts"));
    expect(reply(v)).toMatch(/1\. .*Gros gain à la roulette : aperçu envoyé, à valider/);
  });

  it("un membre présenté voit l'état mais ne lance, ne modifie ni n'annule rien", async () => {
    const t = await setup();
    const { job } = await seedJob(t, { status: "CUTTING", clipStatus: "CUTTING" });
    const member = { kind: "member" as const, telegramUserId: 77n, memberId: "tm1", role: "MEMBER" as const, firstName: "Léa" };
    const { bossActionAllowed, bossAction } = await import("../boss/catalog");
    expect(bossActionAllowed(bossAction("montage_status")!, member)).toBe(true);
    expect(bossActionAllowed(bossAction("voir_montage")!, member)).toBe(true);
    for (const k of ["montage_video", "modifier_short", "annuler_montage", "envoyer_shorts"]) expect(bossActionAllowed(bossAction(k)!, { ...member, role: "MANAGER" })).toBe(false);
    const r = await bossFastPath(t.deps, t.kit.input("annule le montage", { speaker: member }));
    expect(t.calls.cancel).toEqual([]);
    expect(job.id).toBeTruthy();
    expect(r.handled === false || !/annulé/i.test(reply(r))).toBe(true);
  });

  it("capacités (planificateur) et agents nommables, avec ce qu'ils ont fait et vont faire", async () => {
    const t = await setup();
    expect(capability("montage", "decouper_video")).not.toBeNull();
    expect(capability("montage", "etat_montage")).not.toBeNull();
    expect(findAgent("le monteur")).toMatchObject({ status: "found", agent: { key: "montage-monteur" } });
    expect(findAgent("celui des sous-titres")).toMatchObject({ status: "found", agent: { key: "montage-habillage" } });
    expect(findAgent("contrôle qualité montage")).toMatchObject({ status: "found", agent: { key: "montage-controle" } });
    expect(findAgent("la découpe")).toMatchObject({ status: "found", agent: { key: "montage-decoupe" } });
    expect(findAgent("réception")).toMatchObject({ status: "found", agent: { key: "montage-reception" } });
    await seedJob(t, { status: "CUTTING", clipStatus: "CUTTING", clips: 2 });
    const card = await agentCard(t.deps, "montage-monteur", { day: "2026-10-23" });
    expect(card.lines.join("\n")).toMatch(/2 shorts à monter/);
    const direct = await montageAgentCard(t.deps, "montage-decoupe", "2026-10-23");
    expect(direct.lines.length).toBeGreaterThan(0);
    // Planificateur : rien à monter sans vidéo reçue.
    const check = await capability("montage", "decouper_video")!.check(t.deps, {});
    expect(check.ok).toBe(false);
    await receiveMontageVideo(t.deps, { chatId: CHAT, video: video(), botId: "b", forwarded: true, caption: null });
    expect((await capability("montage", "decouper_video")!.check(t.deps, {})).ok).toBe(true);
    expect((await readMontageState(t.deps, CHAT)).videos).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------- voix

describe("voix de Kevin : toutes les variantes du montage", () => {
  it("passent voiceCheck (zéro échec)", () => {
    const tables: Record<string, VoiceTable> = {
      RECEPTION_VARIANTS,
      PLAN_VARIANTS,
      PREVIEW_VARIANTS,
      FEEDBACK_VARIANTS,
      VIEW_VARIANTS,
      CATALOG_MONTAGE_VARIANTS,
    };
    const failures: string[] = [];
    let count = 0;
    for (const [name, table] of Object.entries(tables))
      for (const [key, entry] of Object.entries(table)) {
        const { texts, rules } = voiceEntryTexts(entry);
        expect(texts.length, `${name}.${key}`).toBeGreaterThan(0);
        for (const text of texts) {
          count++;
          const r = voiceCheck(text, rules);
          if (!r.ok) failures.push(`${name}.${key} : ${r.problems.map((p) => p.code).join(", ")} « ${text} »`);
        }
      }
    expect(failures, failures.join("\n")).toEqual([]);
    expect(count).toBeGreaterThan(80);
  });

  it("2 à 4 variantes par texte fixe de phrase (sauf la légende de l'aperçu, un format)", () => {
    for (const [name, table] of Object.entries({ RECEPTION_VARIANTS, PLAN_VARIANTS, FEEDBACK_VARIANTS, CATALOG_MONTAGE_VARIANTS, VIEW_VARIANTS })) {
      for (const [key, entry] of Object.entries(table as VoiceTable)) {
        if (key === "refused") continue;
        const n = typeof entry === "function" ? entry(entry.samples[0]).length : entry.length;
        expect(n, `${name}.${key}`).toBeGreaterThanOrEqual(2);
        expect(n, `${name}.${key}`).toBeLessThanOrEqual(4);
      }
    }
  });
});

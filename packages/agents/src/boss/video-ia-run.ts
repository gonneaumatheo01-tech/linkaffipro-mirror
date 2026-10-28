/**
 * Kevin met une persona à la place de la personne d'une vidéo qu'on lui envoie (« mets Léa à la place de la personne
 * dans cette vidéo »). Même moteur que l'équipe Rencontres (phase 20 : fal.ai Wan 2.2 Animate « replace », Magic Hour
 * si l'équipe l'a choisi), branché sur une vidéo reçue par Kevin :
 * - `prepareReplace` : contrôles avant la confirmation ET après le OUI (vidéo reçue, 15 s au plus, persona avec photo
 *   de référence, clé du service, plafond vidéo de l'équipe Rencontres) ; rend le résumé ou la réponse de refus ;
 * - `queueReplace` (après OUI) : état `queued`, vidéo marquée comme utilisée, tâche `video-ia.submit` ;
 * - `submitReplace` (worker, file `agents-montage`) : téléchargement de la vidéo (bot de Kevin ≤ 20 Mo, compte connecté
 *   au-delà), repère `submitting` AVANT l'appel payant, soumission, première relecture dans 30 s ;
 * - `pollReplace` : relecture toutes les 60 s, 15 minutes au plus (temps sans relecture non compté), résultat envoyé
 *   au SEUL chat privé de l'admin par le bot de Kevin ; jamais publié, jamais rangé dans un canal ;
 * - `cancelReplace`, `replaceStatus` : « annule le remplacement », « où en est le remplacement ? ».
 * Coût toujours imputé à l'équipe Rencontres (`dating`, poste `video`), jamais au Boss : coût réel au résultat ;
 * estimation comptée si le travail est abandonné sans annulation confirmée ou si un lancement a été coupé.
 */
import { readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { agentEvent, esc, nowOf } from "../admin/journal";
import { NEXT_POLL_DELAY_MS, pausedAfter, pollDelayMs, waitExpired, FIRST_POLL_DELAY_MS } from "../agents/media-ia/video";
import { budgetAllows } from "../agents/media-ia/budget";
import { loadTeamSettings } from "../missions/settings";
import { monthUsage, recordUsage } from "../missions/usage";
import { latestFreeVideo, markVideo, type ReceivedVideo } from "../montage/kevin-state";
import { durationLabel } from "../montage/plan-message";
import { MontageRefused, workDirOf, type MontagePipelineDeps } from "../montage/runtime";
import { downloadSource } from "../montage/source";
import { ProviderError } from "../providers/http";
import { resolveMediaProviders, type MediaProviders } from "../providers/registry";
import type { ProviderFile } from "../providers/video";
import type { Providers, TeamKey } from "../types";
import type { BossReply } from "./contract";
import { eur } from "./catalog-kit";
import { resolvePersona } from "./resolve";
import { VIDEO_IA_VARIANTS as V } from "./video-ia-texts";
import { activeVideoIa, clearVideoIaState, isStaleVideoIa, readVideoIaState, writeVideoIaState, type VideoIaState } from "./video-ia-state";
import { pick } from "./voice";

/** Équipe qui paie (plafond vidéo de l'équipe Rencontres). */
export const VIDEO_IA_TEAM: TeamKey = "dating";
/** Attente maximale chez le fournisseur (temps sans relecture exclu). */
export const VIDEO_IA_MAX_WAIT_MS = 15 * 60_000;

export type VideoIaQueueJob = { type: "video-ia.submit" | "video-ia.poll"; chatId: string };

/** Dépendances : celles du montage (téléchargement, envoi vidéo, file) ; fournisseurs imposés par les tests. */
export type VideoIaDeps = MontagePipelineDeps & { mediaProviders?: Partial<Providers>; fetch?: typeof fetch };

type PersonaMedia = { id: string; name: string; referenceImageIds: string[] };

export type Prepared = {
  video: ReceivedVideo;
  persona: PersonaMedia;
  media: MediaProviders;
  /** Durée connue (Telegram), sinon null : estimation sur la durée maximale, vérifiée au téléchargement. */
  durationSec: number | null;
  billedSec: number;
  estimatedCents: number;
  cap: number | undefined;
  spent: number;
};

type Fail = { ok: false; reply: BossReply };
const fail = (reply: string): Fail => ({ ok: false, reply: { reply } });

function enqueueOf(deps: VideoIaDeps): (job: VideoIaQueueJob, opts?: { jobId?: string; delayMs?: number }) => Promise<void> {
  const fn = deps.montage?.enqueue as unknown as ((job: VideoIaQueueJob, opts?: { jobId?: string; delayMs?: number }) => Promise<void>) | undefined;
  if (!fn) throw new Error("file agents-montage non branchée");
  return fn;
}

async function loadPersona(deps: VideoIaDeps, id: string): Promise<PersonaMedia | null> {
  const p = (await deps.prisma.persona.findUnique({ where: { id }, select: { id: true, name: true, referenceImageIds: true } })) as
    | { id: string; name: string; referenceImageIds: unknown }
    | null;
  if (!p) return null;
  const ids = Array.isArray(p.referenceImageIds) ? p.referenceImageIds.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
  return { id: p.id, name: p.name, referenceImageIds: ids };
}

/** Première photo de référence lisible de la persona (octets en base), ou null. */
async function referenceImage(deps: VideoIaDeps, persona: PersonaMedia): Promise<ProviderFile | null> {
  for (const id of persona.referenceImageIds) {
    const a = (await deps.prisma.mediaAsset.findUnique({ where: { id }, select: { bytes: true, mimeType: true, filename: true } })) as
      | { bytes: Uint8Array; mimeType: string; filename: string }
      | null;
    if (a && a.bytes && a.bytes.length > 0 && a.mimeType.startsWith("image/")) return { bytes: new Uint8Array(a.bytes), mimeType: a.mimeType, filename: a.filename };
  }
  return null;
}

async function mediaOf(deps: VideoIaDeps): Promise<MediaProviders> {
  const settings = await loadTeamSettings(deps.prisma as never, VIDEO_IA_TEAM);
  return resolveMediaProviders({ prisma: deps.prisma as never, settings, providers: deps.mediaProviders, fetch: deps.fetch, now: deps.now });
}

/** Sans clé, le registre rend le faux fournisseur (simulation des agents) : ici on refuse, sauf fournisseur imposé. */
function hasRealProvider(deps: VideoIaDeps, media: MediaProviders): boolean {
  return media.video.name !== "fake" || !!deps.mediaProviders?.video;
}

async function budgetOf(deps: VideoIaDeps, estimate: number): Promise<{ ok: boolean; spent: number; cap: number | undefined }> {
  const settings = await loadTeamSettings(deps.prisma as never, VIDEO_IA_TEAM);
  const cap = settings.monthlyBudgetCents.video;
  const spent = (await monthUsage(deps.prisma as never, VIDEO_IA_TEAM, nowOf(deps))).find((u) => u.provider === "video")?.cents ?? 0;
  return { ok: budgetAllows(spent, cap, estimate), spent, cap };
}

/** Durée et coût d'une vidéo (refus si trop longue ou si le plafond ne suffit pas). */
async function costCheck(
  deps: VideoIaDeps,
  media: MediaProviders,
  durationSec: number | null,
  chatId: string,
): Promise<{ ok: true; billedSec: number; estimatedCents: number; cap: number | undefined; spent: number } | Fail> {
  const max = media.settings.maxVideoSeconds;
  if (durationSec && durationSec > max)
    return fail(pick(V.tooLong({ duration: durationLabel(durationSec) ?? `${Math.round(durationSec)} s`, max: `${max} s` }), "video-ia.tooLong", chatId));
  const billedSec = durationSec && durationSec > 0 ? durationSec : max;
  const estimatedCents = media.video.estimateCents({ durationSec: billedSec, fps: null, resolution: media.settings.resolution });
  const b = await budgetOf(deps, estimatedCents);
  if (!b.ok) return fail(pick(V.budget({ spent: eur(b.spent), cost: eur(estimatedCents), cap: eur(b.cap ?? 0) }), "video-ia.budget", chatId));
  return { ok: true, billedSec, estimatedCents, cap: b.cap, spent: b.spent };
}

/**
 * Contrôles d'une demande (avant la confirmation, puis après le OUI) : rien en cours, une vidéo reçue, la persona
 * (question numérotée si le nom est ambigu), sa photo de référence, la clé, la durée et le plafond.
 */
export async function prepareReplace(
  deps: VideoIaDeps,
  chatId: string,
  personaRaw: string | undefined,
  params: Record<string, unknown>,
): Promise<({ ok: true } & Prepared) | Fail> {
  if (await activeVideoIa(deps, chatId)) return fail(pick(V.busy, "video-ia.busy", chatId));
  const video = await latestFreeVideo(deps, chatId);
  if (!video) return fail(pick(V.noVideo, "video-ia.noVideo", chatId));
  const found = await resolvePersona(deps, { actionKey: "remplacer_personne", params, field: "persona" }, personaRaw);
  if (!found.ok) return { ok: false, reply: found.reply };
  const persona = await loadPersona(deps, found.value.id);
  if (!persona || !(await referenceImage(deps, persona))) return fail(pick(V.noReference({ name: esc(found.value.name) }), "video-ia.noReference", chatId));
  const media = await mediaOf(deps);
  if (!hasRealProvider(deps, media)) return fail(pick(V.noKey, "video-ia.noKey", chatId));
  const cost = await costCheck(deps, media, video.durationSec, chatId);
  if (!cost.ok) return cost;
  const { billedSec, estimatedCents, cap, spent } = cost;
  return { ok: true, video, persona, media, durationSec: video.durationSec, billedSec, estimatedCents, cap, spent };
}

/** Résumé de la confirmation (persona, durée, coût estimé, reste du plafond). */
export function replaceSummary(p: Prepared, chatId: string): string {
  const name = esc(p.persona.name);
  const duration = durationLabel(p.durationSec) ?? `${p.billedSec} s au plus`;
  const cost = eur(p.estimatedCents);
  if (p.cap === undefined) return pick(V.summaryNoCap({ name, duration, cost }), "video-ia.summary", chatId);
  const remaining = eur(Math.max(0, p.cap - p.spent));
  return pick(V.summary({ name, duration, cost, remaining }), "video-ia.summary", chatId);
}

/** Après le OUI : état `queued`, vidéo marquée, tâche de soumission (idempotente par message). */
export async function queueReplace(deps: VideoIaDeps, chatId: string, p: Prepared): Promise<string> {
  const state: VideoIaState = {
    status: "queued",
    chatId,
    personaId: p.persona.id,
    personaName: p.persona.name,
    video: p.video,
    resolution: p.media.settings.resolution,
    durationSec: p.billedSec,
    estimatedCents: p.estimatedCents,
    requestedAt: nowOf(deps).toISOString(),
    polls: 0,
  };
  await writeVideoIaState(deps, state);
  await markVideo(deps, chatId, p.video.messageId, { jobId: `video-ia:${p.video.messageId}` });
  try {
    await enqueueOf(deps)({ type: "video-ia.submit", chatId }, { jobId: `video-ia.submit:${chatId}:${p.video.messageId}` });
  } catch (err) {
    deps.logger?.error({ err: (err as Error).message }, "[video-ia] mise en file impossible");
    await clearVideoIaState(deps, chatId);
    await markVideo(deps, chatId, p.video.messageId, { jobId: null });
    return pick(V.launchFailed, "video-ia.launchFailed", chatId);
  }
  await agentEvent(deps, "agents.video_ia.requested", { personaId: p.persona.id, durationSec: p.billedSec, estimatedCents: p.estimatedCents });
  return pick(V.launched({ name: esc(p.persona.name) }), "video-ia.launched", chatId);
}

async function tellAdmin(deps: VideoIaDeps, html: string): Promise<void> {
  try {
    await deps.admin?.send(html);
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[video-ia] message à l'admin non envoyé");
  }
}

/** Fin d'un remplacement : dépense comptée (même nulle : un appel), état effacé, message à l'admin. */
async function finish(deps: VideoIaDeps, s: VideoIaState, cents: number, html: string, event: string, extra: Record<string, unknown> = {}): Promise<void> {
  const spent = Math.max(0, Math.round(cents));
  if (s.status !== "queued") await recordUsage(deps.prisma as never, VIDEO_IA_TEAM, "video", spent, nowOf(deps));
  await clearVideoIaState(deps, s.chatId);
  // La vidéo redevient utilisable (nouvel essai, montage).
  await markVideo(deps, s.chatId, s.video.messageId, { jobId: null });
  await agentEvent(deps, event, { personaId: s.personaId, provider: s.provider ?? null, cents: spent, ...extra });
  await tellAdmin(deps, html);
}

function sourcePath(deps: VideoIaDeps, s: VideoIaState): string {
  const ext = /\.([a-z0-9]{2,5})$/i.exec(s.video.fileName ?? "")?.[1]?.toLowerCase() ?? "mp4";
  return join(workDirOf(deps), "video-ia", `${s.chatId}-${s.video.messageId}.${ext}`);
}

/** Tâche `video-ia.submit` (voir l'en-tête). Rejouée par BullMQ : ne relance jamais un travail déjà parti. */
export async function submitReplace(deps: VideoIaDeps, chatId: string): Promise<{ ok: boolean; summary: string }> {
  const s = await readVideoIaState(deps, chatId);
  if (!s) return { ok: true, summary: "rien à lancer" };
  const name = esc(s.personaName);
  if (s.status === "running") return { ok: true, summary: "déjà lancé" };
  if (s.status === "submitting") {
    // Coupé entre l'appel payant et l'enregistrement du travail : jamais resoumis à l'aveugle, estimation comptée.
    await finish(deps, s, s.estimatedCents, pick(V.interrupted, "video-ia.interrupted", chatId), "agents.video_ia.interrupted");
    return { ok: false, summary: "lancement interrompu" };
  }
  if (isStaleVideoIa(s, nowOf(deps))) {
    await clearVideoIaState(deps, chatId);
    return { ok: false, summary: "demande trop ancienne" };
  }
  const persona = await loadPersona(deps, s.personaId);
  const reference = persona ? await referenceImage(deps, persona) : null;
  if (!persona || !reference) {
    await finish(deps, s, 0, pick(V.noReference({ name }), "video-ia.noReference", chatId), "agents.video_ia.refused", { reason: "reference" });
    return { ok: false, summary: "pas de photo de référence" };
  }
  const media = await mediaOf(deps);
  if (!hasRealProvider(deps, media)) {
    await finish(deps, s, 0, pick(V.noKey, "video-ia.noKey", chatId), "agents.video_ia.refused", { reason: "key" });
    return { ok: false, summary: "clé absente" };
  }

  const path = sourcePath(deps, s);
  try {
    const v = s.video;
    try {
      await downloadSource(
        deps,
        {
          id: `video-ia-${v.messageId}`,
          size: v.sizeBytes ?? 0,
          duration: v.durationSec,
          storage: "telegram",
          telegramRef: { chatId, messageId: v.messageId, botId: v.botId, fileId: v.fileId, fileUniqueId: v.fileUniqueId, via: "kevin", sizeBytes: v.sizeBytes },
        },
        path,
      );
    } catch (err) {
      deps.logger?.warn({ err: (err as Error).message }, "[video-ia] vidéo source non récupérée");
      const text = err instanceof MontageRefused ? esc(err.message) : pick(V.sourceUnreadable, "video-ia.source", chatId);
      await finish(deps, s, 0, text, "agents.video_ia.refused", { reason: "source" });
      return { ok: false, summary: "vidéo source illisible" };
    }
    // Durée inconnue (vidéo envoyée en fichier) : mesurée sur la copie.
    let durationSec = v.durationSec;
    if (!durationSec && deps.montage?.engine?.probeMedia)
      durationSec = await deps.montage.engine
        .probeMedia(path)
        .then((p) => p.durationMs / 1000)
        .catch(() => null);
    const cost = await costCheck(deps, media, durationSec, chatId);
    if (!cost.ok) {
      await finish(deps, s, 0, cost.reply.reply ?? "", "agents.video_ia.refused", { reason: "duration-or-budget" });
      return { ok: false, summary: "trop longue ou plafond atteint" };
    }
    const bytes = new Uint8Array(await readFile(path));
    const video = media.video;
    // Repère AVANT l'appel payant.
    const submitting: VideoIaState = { ...s, status: "submitting", provider: video.name, estimatedCents: cost.estimatedCents, durationSec: cost.billedSec };
    await writeVideoIaState(deps, submitting);
    let start: Awaited<ReturnType<typeof video.startReplace>>;
    try {
      start = await video.startReplace({
        sourceVideo: { bytes, mimeType: v.mimeType || "video/mp4", filename: v.fileName || `video-${v.messageId}.mp4` },
        referenceImage: reference,
        resolution: media.settings.resolution,
        durationSec: cost.billedSec,
        fps: null,
      });
    } catch (err) {
      const message = (err as Error).message || "erreur inconnue";
      deps.logger?.warn({ err: message, transient: err instanceof ProviderError && err.transient }, "[video-ia] soumission refusée");
      await finish(deps, submitting, 0, pick(V.failed({ name }), "video-ia.failed", chatId), "agents.video_ia.failed", { error: message.slice(0, 200) });
      return { ok: false, summary: "soumission refusée" };
    }
    const running: VideoIaState = {
      ...submitting,
      status: "running",
      jobId: start.jobId,
      ...(start.ref ? { ref: start.ref } : {}),
      submittedAt: nowOf(deps).toISOString(),
      estimatedCents: start.estimatedCents || cost.estimatedCents,
      polls: 0,
    };
    // Annulé par l'admin pendant l'appel : le travail parti est arrêté tout de suite.
    const still = await readVideoIaState(deps, chatId);
    if (!still) {
      const c = video.cancel ? await video.cancel(start.jobId, start.ref).catch(() => ({ cancelled: false })) : { cancelled: false };
      await recordUsage(deps.prisma as never, VIDEO_IA_TEAM, "video", c.cancelled ? 0 : running.estimatedCents, nowOf(deps));
      return { ok: true, summary: "annulé pendant le lancement" };
    }
    await writeVideoIaState(deps, running);
    await agentEvent(deps, "agents.video_ia.submitted", { personaId: s.personaId, provider: video.name, estimatedCents: running.estimatedCents });
    await enqueueOf(deps)({ type: "video-ia.poll", chatId }, { jobId: `video-ia.poll:${chatId}:${start.jobId}:0`, delayMs: FIRST_POLL_DELAY_MS });
    return { ok: true, summary: `lancé (${media.settings.resolution})` };
  } finally {
    await rm(path, { force: true }).catch(() => undefined);
  }
}

/** Tâche `video-ia.poll` (voir l'en-tête). */
export async function pollReplace(deps: VideoIaDeps, chatId: string): Promise<{ ok: boolean; summary: string }> {
  const s = await readVideoIaState(deps, chatId);
  if (!s || s.status !== "running" || !s.jobId || !s.submittedAt) return { ok: true, summary: "rien à relire" };
  const name = esc(s.personaName);
  const media = await mediaOf(deps);
  const provider = (s.provider && media.byName[s.provider]) || null;
  if (!provider) {
    await finish(deps, s, s.estimatedCents, pick(V.failed({ name }), "video-ia.failed", chatId), "agents.video_ia.failed", { error: "fournisseur indisponible" });
    return { ok: false, summary: "fournisseur indisponible" };
  }
  const now = nowOf(deps);
  const pausedMs = pausedAfter({ submittedAt: s.submittedAt, lastPolledAt: s.lastPolledAt, polls: s.polls, pausedMs: s.pausedMs }, now);
  const next: VideoIaState = { ...s, polls: s.polls + 1, lastPolledAt: now.toISOString(), pausedMs };
  const again = async (delayMs: number) => {
    await writeVideoIaState(deps, next);
    await enqueueOf(deps)({ type: "video-ia.poll", chatId }, { jobId: `video-ia.poll:${chatId}:${s.jobId}:${next.polls}`, delayMs });
  };
  // État relu AVANT le test du délai : un résultat prêt n'est jamais jeté.
  const r = await provider.poll(s.jobId, s.ref);
  if (r.status === "queued" || r.status === "running") {
    if (waitExpired(s.submittedAt, now, VIDEO_IA_MAX_WAIT_MS, pausedMs)) {
      const c = provider.cancel ? await provider.cancel(s.jobId, s.ref).catch(() => ({ cancelled: false })) : { cancelled: false };
      await finish(deps, s, c.cancelled ? 0 : s.estimatedCents, pick(V.timedOut({ name }), "video-ia.timedOut", chatId), "agents.video_ia.timed_out", { cancelled: c.cancelled });
      return { ok: false, summary: "trop long, abandonné" };
    }
    await again(pollDelayMs(next.polls));
    return { ok: true, summary: r.status === "queued" ? "en file chez le fournisseur" : "en cours chez le fournisseur" };
  }
  if (r.status === "failed" || !r.outputUrl) {
    await finish(deps, s, r.actualCents ?? 0, pick(V.failed({ name }), "video-ia.failed", chatId), "agents.video_ia.failed", { error: (r.error ?? "résultat sans fichier").slice(0, 200) });
    return { ok: false, summary: "échec chez le fournisseur" };
  }
  let file: ProviderFile;
  try {
    file = await provider.download(r.outputUrl);
  } catch (err) {
    if (err instanceof ProviderError && !err.transient) {
      await finish(deps, s, r.actualCents ?? s.estimatedCents, pick(V.failed({ name }), "video-ia.failed", chatId), "agents.video_ia.failed", { error: err.message.slice(0, 200) });
      return { ok: false, summary: "résultat illisible" };
    }
    await again(NEXT_POLL_DELAY_MS);
    return { ok: true, summary: "téléchargement à reprendre" };
  }
  if (!deps.sendVideo) throw new Error("envoi vidéo de Kevin non branché (worker)");
  const out = join(workDirOf(deps), "video-ia", `${chatId}-${s.jobId.replace(/[^\w-]/g, "_")}-resultat.mp4`);
  try {
    await mkdir(join(workDirOf(deps), "video-ia"), { recursive: true });
    await writeFile(out, file.bytes);
    // Légende en texte brut (pas de HTML dans une légende de vidéo).
    await deps.sendVideo({ chatId, path: out, caption: pick(V.ready({ name: s.personaName }), "video-ia.ready", chatId) });
  } finally {
    await rm(out, { force: true }).catch(() => undefined);
  }
  await recordUsage(deps.prisma as never, VIDEO_IA_TEAM, "video", Math.max(0, Math.round(r.actualCents ?? s.estimatedCents)), nowOf(deps));
  await clearVideoIaState(deps, chatId);
  await agentEvent(deps, "agents.video_ia.done", { personaId: s.personaId, provider: s.provider ?? null, cents: Math.round(r.actualCents ?? s.estimatedCents) });
  return { ok: true, summary: "vidéo envoyée à l'admin" };
}

/** « Où en est le remplacement ? » */
export async function replaceStatus(deps: VideoIaDeps, chatId: string): Promise<string> {
  const s = await activeVideoIa(deps, chatId);
  if (!s) return pick(V.none, "video-ia.none", chatId);
  const name = esc(s.personaName);
  if (s.status !== "running" || !s.submittedAt) return pick(V.statusWaiting({ name }), "video-ia.statusWaiting", chatId);
  const sec = Math.max(1, (nowOf(deps).getTime() - Date.parse(s.submittedAt)) / 1000);
  return pick(V.status({ name, since: durationLabel(sec) ?? "un instant" }), "video-ia.status", chatId);
}

/** « Annule le remplacement » : arrêt demandé au fournisseur ; estimation comptée sauf arrêt confirmé. */
export async function cancelReplace(deps: VideoIaDeps, chatId: string): Promise<string> {
  const s = await readVideoIaState(deps, chatId);
  if (!s) return pick(V.none, "video-ia.none", chatId);
  if (s.status === "queued" || !s.jobId) {
    // Pas encore parti (ou lancement en cours : la soumission voit l'état effacé et arrête le travail elle-même).
    await clearVideoIaState(deps, chatId);
    await markVideo(deps, chatId, s.video.messageId, { jobId: null });
    await agentEvent(deps, "agents.video_ia.cancelled", { personaId: s.personaId, cents: 0 });
    return pick(V.cancelled, "video-ia.cancelled", chatId);
  }
  const media = await mediaOf(deps);
  const provider = (s.provider && media.byName[s.provider]) || null;
  const c = provider?.cancel ? await provider.cancel(s.jobId, s.ref).catch(() => ({ cancelled: false })) : { cancelled: false };
  const cents = c.cancelled ? 0 : Math.max(0, Math.round(s.estimatedCents));
  await recordUsage(deps.prisma as never, VIDEO_IA_TEAM, "video", cents, nowOf(deps));
  await clearVideoIaState(deps, chatId);
  await markVideo(deps, chatId, s.video.messageId, { jobId: null });
  await agentEvent(deps, "agents.video_ia.cancelled", { personaId: s.personaId, provider: s.provider ?? null, cents, confirmed: c.cancelled });
  return cents > 0 ? pick(V.cancelledBilled({ cost: eur(cents) }), "video-ia.cancelledBilled", chatId) : pick(V.cancelled, "video-ia.cancelled", chatId);
}

/**
 * Média IA, vidéo : remplacement de la personne de la vidéo source par le personnage (fal Wan 2.2 Animate
 * « replace », Magic Hour en repli, faux fournisseur en simulation). Travail asynchrone sans webhook : soumission,
 * travail gardé dans `payload.mediaJob` (identifiant, adresses d'état et de résultat), puis l'étape se ré-enfile
 * (30 s, puis 60 s) jusqu'au résultat, 15 minutes au plus. Plafond vidéo vérifié AVANT la soumission avec le coût
 * estimé ; coût réel enregistré au résultat. Source manquante, plafond, ou échecs → repli photo (journalisé).
 *
 * Relecture de la phase 25 : l'état est relu chez le fournisseur AVANT de tester le délai (un résultat prêt n'est
 * jamais jeté) ; le temps passé en pause (aucune relecture pendant des heures) ne compte pas dans les 15 minutes ;
 * au dépassement, le travail est annulé chez fal et l'estimation est comptée comme dépense sauf annulation confirmée,
 * puis repli photo, jamais de nouvelle soumission. Un travail est toujours relu chez SON fournisseur (`byName`).
 * Repère `videoSubmitting` écrit dans la mission AVANT l'appel payant et `mediaJob` écrit dès la soumission : une
 * reprise après plantage relit au lieu de resoumettre. Tout coût engagé (échec Magic Hour facturé, travail abandonné)
 * est compté : l'étape le rend avec une courte attente, puis la photo est produite à la relecture.
 */
import { ProviderError } from "../../providers/http";
import { FAKE_TEST_IMAGE } from "../../providers/fake";
import { FAL_FAILURES_BEFORE_FALLBACK, resolveMediaProviders, type MediaProviders } from "../../providers/registry";
import type { ProviderFile, VideoJobRef, VideoProvider, VideoResolution } from "../../providers/video";
import { parsePayload } from "../../missions/mission";
import type { AgentContext, AgentResult, Mission, MissionPayload } from "../../types";
import { loadPersonaMedia, loadPlan, personaIdOf, type PersonaMedia } from "../data";
import { checkMediaBudget } from "./budget";
import { applyFallback } from "./fallback";
import { runPhoto } from "./photo";
import { storeProducedMedia } from "./store";

export const FIRST_POLL_DELAY_MS = 30_000;
export const NEXT_POLL_DELAY_MS = 60_000;
/** Attente maximale d'un travail chez le fournisseur. */
export const MAX_VIDEO_WAIT_MS = 15 * 60_000;
/** Écart au-delà du délai prévu entre deux relectures compté comme une pause (équipe en pause, worker arrêté). */
export const PAUSE_SLACK_MS = 2 * 60_000;
/** Attente courte avant de produire la photo de repli quand un coût vidéo doit d'abord être compté. */
export const FALLBACK_STEP_DELAY_MS = 1_000;

export type MediaJob = {
  provider: VideoProvider["name"];
  jobId: string;
  ref?: VideoJobRef;
  submittedAt: string;
  estimatedCents: number;
  resolution: VideoResolution;
  sourceAssetId: string;
  durationSec: number;
  polls: number;
  /** Dernière relecture (ISO) et temps passé en pause, exclu de l'attente maximale. */
  lastPolledAt?: string;
  pausedMs?: number;
};

/** Repère posé AVANT l'appel payant de soumission (effacé à la fin de l'étape). */
export type VideoSubmitting = { at: string; provider: VideoProvider["name"]; estimatedCents: number };

export function mediaJobOf(v: unknown): MediaJob | null {
  if (!v || typeof v !== "object") return null;
  const j = v as Partial<MediaJob>;
  return typeof j.jobId === "string" && typeof j.provider === "string" && typeof j.submittedAt === "string" ? (j as MediaJob) : null;
}

/** Délai avant la prochaine relecture (pur) : 30 s après la soumission, puis 60 s. */
export function pollDelayMs(polls: number): number {
  return polls <= 0 ? FIRST_POLL_DELAY_MS : NEXT_POLL_DELAY_MS;
}

/** Le travail a-t-il dépassé l'attente maximale (pur) ? `pausedMs` : temps passé en pause, non compté. */
export function waitExpired(submittedAt: string, now: Date, maxMs = MAX_VIDEO_WAIT_MS, pausedMs = 0): boolean {
  const t = Date.parse(submittedAt);
  return Number.isFinite(t) && now.getTime() - t - Math.max(0, pausedMs) > maxMs;
}

/**
 * Temps de pause cumulé après cette relecture (pur) : un écart entre deux relectures bien plus long que le délai
 * prévu (équipe en pause, worker arrêté) n'est pas du temps d'attente du fournisseur.
 */
export function pausedAfter(job: Pick<MediaJob, "submittedAt" | "lastPolledAt" | "polls" | "pausedMs">, now: Date): number {
  const last = Date.parse(job.lastPolledAt ?? job.submittedAt);
  const before = Math.max(0, job.pausedMs ?? 0);
  if (!Number.isFinite(last)) return before;
  const gap = now.getTime() - last;
  const expected = pollDelayMs(job.polls);
  return gap > expected + PAUSE_SLACK_MS ? before + (gap - expected) : before;
}

const counter = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Repli photo : la photo est produite dans la même étape. Si un coût vidéo a été engagé (`videoCents`), l'étape le
 * rend d'abord (poste « vidéo ») avec une courte attente ; la photo est produite à la relecture (format « photo »).
 */
async function toPhoto(ctx: AgentContext, mission: Mission, reason: string, extra: Record<string, unknown> = {}, videoCents = 0): Promise<AgentResult> {
  const fb = await applyFallback(ctx, mission, "video", reason);
  const patch = { ...extra, ...(fb?.patch ?? { format: "photo" as const }), mediaJob: null };
  if (videoCents > 0)
    return {
      ok: true,
      output: patch,
      costCents: videoCents,
      costProvider: "video",
      wait: { delayMs: FALLBACK_STEP_DELAY_MS },
      summary: `vidéo impossible (${reason.slice(0, 120)}), ${videoCents} c comptés → photo`,
    };
  const photo = await runPhoto({ ...mission, payload: { ...mission.payload, ...patch } }, ctx);
  return {
    ...photo,
    output: { ...patch, ...(photo.output ?? {}) },
    summary: `vidéo impossible (${reason.slice(0, 120)}) → ${photo.summary ?? "photo"}`,
  };
}

async function loadFile(ctx: AgentContext, id: string | null | undefined): Promise<(ProviderFile & { duration: number | null }) | null> {
  if (!id) return null;
  const a = await ctx.prisma.mediaAsset.findUnique({ where: { id }, select: { bytes: true, mimeType: true, filename: true, duration: true } });
  return a ? { bytes: new Uint8Array(a.bytes), mimeType: a.mimeType, filename: a.filename, duration: a.duration ?? null } : null;
}

/** Écrit tout de suite dans la charge utile de la mission (repères posés avant / juste après un appel payant). */
async function patchPayload(ctx: AgentContext, missionId: string, patch: Partial<MissionPayload>): Promise<void> {
  const row = await ctx.prisma.agentMission.findUnique({ where: { id: missionId }, select: { payload: true } });
  await ctx.prisma.agentMission.update({ where: { id: missionId }, data: { payload: JSON.parse(JSON.stringify({ ...parsePayload(row?.payload), ...patch })) as never } });
}

/**
 * Échec d'un fournisseur : fal réessaie une fois, puis Magic Hour (si clé), sinon repli photo. `spentCents` : coût
 * déjà facturé par le fournisseur malgré l'échec (Magic Hour `credits_charged`), toujours compté.
 */
async function onFailure(ctx: AgentContext, mission: Mission, media: MediaProviders, provider: VideoProvider["name"], error: string, spentCents = 0): Promise<AgentResult> {
  const spent = Math.max(0, Math.round(spentCents));
  const falFailures = counter(mission.payload.falFailures) + (provider === "fal" ? 1 : 0);
  const errors = [...(Array.isArray(mission.payload.videoErrors) ? (mission.payload.videoErrors as string[]) : []), error.slice(0, 200)].slice(-5);
  const keep = { falFailures, videoErrors: errors, mediaJob: null };
  if (provider === "fal" && (falFailures < FAL_FAILURES_BEFORE_FALLBACK || media.fallbackVideo))
    return {
      ok: true,
      output: keep,
      ...(spent > 0 ? { costCents: spent, costProvider: "video" as const } : {}),
      wait: { delayMs: FIRST_POLL_DELAY_MS },
      summary:
        falFailures < FAL_FAILURES_BEFORE_FALLBACK
          ? `fal.ai en échec (${error.slice(0, 100)}), nouvel essai`
          : `fal.ai en échec deux fois, passage à ${media.fallbackVideo!.name === "magichour" ? "Magic Hour" : media.fallbackVideo!.name}`,
    };
  return toPhoto(ctx, { ...mission, payload: { ...mission.payload, ...keep } }, `échec de la vidéo : ${error.slice(0, 140)}`, keep, spent);
}

/** Dépassement de l'attente : annulation chez le fournisseur, estimation comptée sauf annulation confirmée, photo. */
async function abandon(ctx: AgentContext, mission: Mission, provider: VideoProvider, job: MediaJob): Promise<AgentResult> {
  const cancel = provider.cancel ? await provider.cancel(job.jobId, job.ref).catch(() => ({ cancelled: false })) : { cancelled: false };
  const cents = cancel.cancelled ? 0 : Math.max(0, Math.round(job.estimatedCents));
  const minutes = Math.round(MAX_VIDEO_WAIT_MS / 60_000);
  return toPhoto(
    ctx,
    mission,
    `toujours en cours après ${minutes} minutes${cancel.cancelled ? " (annulé chez le fournisseur)" : ""}`,
    { abandonedJob: { provider: job.provider, jobId: job.jobId, cancelled: cancel.cancelled, cents } },
    cents,
  );
}

async function submit(ctx: AgentContext, mission: Mission, media: MediaProviders, persona: PersonaMedia, sourceAssetId: string): Promise<AgentResult> {
  const video = media.video;
  const source = await loadFile(ctx, sourceAssetId);
  if (!source) return toPhoto(ctx, mission, "vidéo source introuvable dans la médiathèque");
  const simulation = video.name === "fake";
  let reference = await loadFile(ctx, persona.referenceImageIds[0]);
  if (!reference) {
    if (!simulation) return toPhoto(ctx, mission, `aucune image de référence pour ${persona.name} (fiche persona)`);
    reference = { ...FAKE_TEST_IMAGE, duration: null };
  }
  const max = media.settings.maxVideoSeconds;
  let durationSec = source.duration;
  if (!durationSec && ctx.frames) durationSec = (await ctx.frames({ bytes: source.bytes, mimeType: source.mimeType }, 1).catch(() => null))?.durationSec ?? null;
  if (durationSec && durationSec > max) return toPhoto(ctx, mission, `vidéo source trop longue (${Math.round(durationSec)} s pour ${max} s au plus)`);
  // Durée inconnue : estimation prudente sur la durée maximale.
  const billedSec = durationSec && durationSec > 0 ? durationSec : max;
  const resolution = media.settings.resolution;
  const estimate = video.estimateCents({ durationSec: billedSec, fps: null, resolution });
  const budget = await checkMediaBudget(ctx, "video", estimate);
  if (!budget.ok) return toPhoto(ctx, mission, budget.reason);

  // Repère AVANT l'appel payant : une reprise après plantage ne resoumet pas à l'aveugle.
  const marker: VideoSubmitting = { at: ctx.now().toISOString(), provider: video.name, estimatedCents: estimate };
  await patchPayload(ctx, mission.id, { videoSubmitting: marker });
  let start: Awaited<ReturnType<VideoProvider["startReplace"]>>;
  try {
    start = await video.startReplace({
      sourceVideo: source,
      referenceImage: reference,
      resolution,
      durationSec: billedSec,
      fps: null,
      sourceAssetId,
    });
  } catch (err) {
    const message = (err as Error).message || "erreur inconnue";
    const transient = err instanceof ProviderError && err.transient;
    const firstTry = typeof mission.payload.videoStartedAt === "string" ? mission.payload.videoStartedAt : ctx.now().toISOString();
    if (transient && !waitExpired(firstTry, ctx.now()))
      return { ok: true, output: { videoStartedAt: firstTry }, wait: { delayMs: NEXT_POLL_DELAY_MS }, summary: `${message.slice(0, 120)}, nouvel essai dans 1 min` };
    return onFailure(ctx, mission, media, video.name, message);
  }
  const job: MediaJob = {
    provider: video.name,
    jobId: start.jobId,
    ...(start.ref ? { ref: start.ref } : {}),
    submittedAt: ctx.now().toISOString(),
    estimatedCents: start.estimatedCents,
    resolution,
    sourceAssetId,
    durationSec: billedSec,
    polls: 0,
  };
  // Travail gardé tout de suite (avant la fin de l'étape), hors du `catch` : une erreur ici ne fait jamais resoumettre.
  await patchPayload(ctx, mission.id, { mediaJob: job, videoSubmitting: null });
  return {
    ok: true,
    output: { mediaJob: job, personaId: persona.id },
    wait: { delayMs: pollDelayMs(0) },
    summary: `vidéo envoyée à ${video.name === "fake" ? "la simulation" : video.name} (${resolution}${start.estimatedCents ? `, environ ${start.estimatedCents} c` : ""})`,
  };
}

async function poll(ctx: AgentContext, mission: Mission, media: MediaProviders, persona: PersonaMedia, job: MediaJob): Promise<AgentResult> {
  // Toujours le fournisseur du travail (la préférence ne sert qu'aux nouvelles soumissions).
  const provider = media.byName[job.provider] ?? null;
  if (!provider)
    return toPhoto(ctx, mission, `fournisseur ${job.provider} plus disponible (clé retirée ?)`, {}, Math.max(0, Math.round(job.estimatedCents)));
  const now = ctx.now();
  const pausedMs = pausedAfter(job, now);
  const next: MediaJob = { ...job, polls: job.polls + 1, lastPolledAt: now.toISOString(), pausedMs };
  // État relu AVANT le test du délai : un résultat prêt n'est jamais jeté.
  const r = await provider.poll(job.jobId, job.ref);
  if (r.status === "queued" || r.status === "running") {
    if (waitExpired(job.submittedAt, now, MAX_VIDEO_WAIT_MS, pausedMs)) return abandon(ctx, mission, provider, next);
    return {
      ok: true,
      output: { mediaJob: next },
      wait: { delayMs: pollDelayMs(next.polls) },
      summary: `${r.transient ? `relecture impossible (${(r.error ?? "").slice(0, 80)})` : r.status === "queued" ? "en file chez le fournisseur" : "en cours chez le fournisseur"}`,
    };
  }
  if (r.status === "failed" || !r.outputUrl) return onFailure(ctx, mission, media, job.provider, r.error ?? "résultat sans fichier", r.actualCents ?? 0);

  let file: ProviderFile;
  try {
    file = await provider.download(r.outputUrl);
  } catch (err) {
    if (err instanceof ProviderError && !err.transient) return onFailure(ctx, mission, media, job.provider, err.message);
    return { ok: true, output: { mediaJob: next }, wait: { delayMs: NEXT_POLL_DELAY_MS }, summary: "téléchargement à reprendre" };
  }
  const simulation = provider.name === "fake";
  const stored = await storeProducedMedia(ctx.prisma, {
    file,
    kind: "GENERATED",
    teamKey: mission.teamKey,
    personaId: persona.id,
    sourceAssetId: job.sourceAssetId,
    providerName: provider.name,
    providerJobId: job.jobId,
    resolution: job.resolution,
    simulation,
    salt: `${mission.id}:${job.jobId}`,
    duration: job.durationSec ? Math.round(job.durationSec) : null,
  });
  const cents = Math.max(0, Math.round(r.actualCents ?? job.estimatedCents));
  return {
    ok: true,
    output: { format: "video", mediaAssetId: stored.id, mediaJob: { ...next, done: true } as MediaJob, personaId: persona.id },
    costCents: cents,
    costProvider: "video",
    summary: `vidéo de ${persona.name} prête${simulation ? " (simulation)" : ""} (${job.resolution}${cents ? `, ${cents} c` : ""})`,
  };
}

export async function runVideo(given: Mission, ctx: AgentContext): Promise<AgentResult> {
  // Charge utile relue en base : un repère ou un travail écrit par un essai précédent (plantage) est pris en compte.
  const row = await ctx.prisma.agentMission.findUnique({ where: { id: given.id }, select: { payload: true } });
  const saved = row ? parsePayload(row.payload) : {};
  const fresh: Partial<MissionPayload> = {};
  for (const k of ["mediaJob", "videoSubmitting"] as const) if (k in saved) fresh[k] = saved[k];
  const mission: Mission = { ...given, payload: { ...given.payload, ...fresh } };
  const plan = await loadPlan(ctx.prisma, mission);
  const persona = await loadPersonaMedia(ctx.prisma, personaIdOf(mission, plan));
  if (!persona) return toPhoto(ctx, mission, "aucune persona sur le plan du canal");
  const sourceAssetId = typeof mission.payload.sourceAssetId === "string" ? mission.payload.sourceAssetId : null;
  if (!sourceAssetId) return toPhoto(ctx, mission, "aucune vidéo source disponible");
  const media = await resolveMediaProviders({
    prisma: ctx.prisma,
    settings: ctx.settings,
    providers: ctx.providers,
    fetch: ctx.fetch,
    now: ctx.now,
    falFailures: counter(mission.payload.falFailures),
  });
  const job = mediaJobOf(mission.payload.mediaJob);
  const done = (job as { done?: boolean } | null)?.done === true;
  if (done && mission.payload.mediaAssetId) return { ok: true, summary: "vidéo déjà produite" };
  if (job && !done) return poll(ctx, mission, media, persona, job);
  // Soumission interrompue (plantage entre l'appel payant et l'enregistrement du travail) : jamais resoumise à
  // l'aveugle ; estimation comptée, repli photo.
  const pending = mission.payload.videoSubmitting as VideoSubmitting | null | undefined;
  if (pending && typeof pending === "object" && typeof pending.at === "string")
    return clearMarker(await toPhoto(ctx, mission, "soumission vidéo interrompue (reprise après un arrêt)", {}, Math.max(0, Math.round(pending.estimatedCents ?? 0))));
  return clearMarker(await submit(ctx, mission, media, persona, sourceAssetId));
}

/** Le repère de soumission est toujours effacé à la fin de l'étape. */
function clearMarker(r: AgentResult): AgentResult {
  return { ...r, output: { ...(r.output ?? {}), videoSubmitting: null } };
}

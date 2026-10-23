/**
 * Média IA, vidéo : remplacement de la personne de la vidéo source par le personnage (fal Wan 2.2 Animate
 * « replace », Magic Hour en repli, faux fournisseur en simulation). Travail asynchrone sans webhook : soumission,
 * travail gardé dans `payload.mediaJob` (identifiant, adresses d'état et de résultat), puis l'étape se ré-enfile
 * (30 s, puis 60 s) jusqu'au résultat, 15 minutes au plus. Plafond vidéo vérifié AVANT la soumission avec le coût
 * estimé ; coût réel enregistré au résultat. Source manquante, plafond, ou échecs → repli photo (journalisé).
 */
import { ProviderError } from "../../providers/http";
import { FAKE_TEST_IMAGE } from "../../providers/fake";
import { FAL_FAILURES_BEFORE_FALLBACK, resolveMediaProviders, type MediaProviders } from "../../providers/registry";
import type { ProviderFile, VideoJobRef, VideoProvider, VideoResolution } from "../../providers/video";
import type { AgentContext, AgentResult, Mission } from "../../types";
import { loadPersonaMedia, loadPlan, personaIdOf, type PersonaMedia } from "../data";
import { checkMediaBudget } from "./budget";
import { applyFallback } from "./fallback";
import { runPhoto } from "./photo";
import { storeProducedMedia } from "./store";

export const FIRST_POLL_DELAY_MS = 30_000;
export const NEXT_POLL_DELAY_MS = 60_000;
/** Attente maximale d'un travail chez le fournisseur. */
export const MAX_VIDEO_WAIT_MS = 15 * 60_000;

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
};

export function mediaJobOf(v: unknown): MediaJob | null {
  if (!v || typeof v !== "object") return null;
  const j = v as Partial<MediaJob>;
  return typeof j.jobId === "string" && typeof j.provider === "string" && typeof j.submittedAt === "string" ? (j as MediaJob) : null;
}

/** Délai avant la prochaine relecture (pur) : 30 s après la soumission, puis 60 s. */
export function pollDelayMs(polls: number): number {
  return polls <= 0 ? FIRST_POLL_DELAY_MS : NEXT_POLL_DELAY_MS;
}

/** Le travail a-t-il dépassé l'attente maximale (pur) ? */
export function waitExpired(submittedAt: string, now: Date, maxMs = MAX_VIDEO_WAIT_MS): boolean {
  const t = Date.parse(submittedAt);
  return Number.isFinite(t) && now.getTime() - t > maxMs;
}

const counter = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Repli photo : la photo est produite dans la même étape. */
async function toPhoto(ctx: AgentContext, mission: Mission, reason: string, extra: Record<string, unknown> = {}): Promise<AgentResult> {
  const fb = await applyFallback(ctx, mission, "video", reason);
  const patch = { ...extra, ...(fb?.patch ?? { format: "photo" as const }) };
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

/** Échec d'un fournisseur : fal réessaie une fois, puis Magic Hour (si clé), sinon repli photo. */
async function onFailure(ctx: AgentContext, mission: Mission, media: MediaProviders, provider: VideoProvider["name"], error: string): Promise<AgentResult> {
  const falFailures = counter(mission.payload.falFailures) + (provider === "fal" ? 1 : 0);
  const errors = [...(Array.isArray(mission.payload.videoErrors) ? (mission.payload.videoErrors as string[]) : []), error.slice(0, 200)].slice(-5);
  const keep = { falFailures, videoErrors: errors, mediaJob: null };
  if (provider === "fal" && (falFailures < FAL_FAILURES_BEFORE_FALLBACK || media.fallbackVideo))
    return {
      ok: true,
      output: keep,
      wait: { delayMs: FIRST_POLL_DELAY_MS },
      summary:
        falFailures < FAL_FAILURES_BEFORE_FALLBACK
          ? `fal.ai en échec (${error.slice(0, 100)}), nouvel essai`
          : `fal.ai en échec deux fois, passage à ${media.fallbackVideo!.name === "magichour" ? "Magic Hour" : media.fallbackVideo!.name}`,
    };
  return toPhoto(ctx, { ...mission, payload: { ...mission.payload, ...keep } }, `échec de la vidéo : ${error.slice(0, 140)}`, keep);
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

  try {
    const start = await video.startReplace({
      sourceVideo: source,
      referenceImage: reference,
      resolution,
      durationSec: billedSec,
      fps: null,
      sourceAssetId,
    });
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
    return {
      ok: true,
      output: { mediaJob: job, personaId: persona.id },
      wait: { delayMs: pollDelayMs(0) },
      summary: `vidéo envoyée à ${video.name === "fake" ? "la simulation" : video.name} (${resolution}${start.estimatedCents ? `, environ ${start.estimatedCents} c` : ""})`,
    };
  } catch (err) {
    const message = (err as Error).message || "erreur inconnue";
    const transient = err instanceof ProviderError && err.transient;
    const firstTry = typeof mission.payload.videoStartedAt === "string" ? mission.payload.videoStartedAt : ctx.now().toISOString();
    if (transient && !waitExpired(firstTry, ctx.now()))
      return { ok: true, output: { videoStartedAt: firstTry }, wait: { delayMs: NEXT_POLL_DELAY_MS }, summary: `${message.slice(0, 120)}, nouvel essai dans 1 min` };
    return onFailure(ctx, mission, media, video.name, message);
  }
}

async function poll(ctx: AgentContext, mission: Mission, media: MediaProviders, persona: PersonaMedia, job: MediaJob): Promise<AgentResult> {
  const provider = [media.video, media.fallbackVideo].find((p) => p?.name === job.provider) ?? null;
  if (!provider) return onFailure(ctx, mission, media, job.provider, `fournisseur ${job.provider} plus disponible (clé retirée ?)`);
  if (waitExpired(job.submittedAt, ctx.now())) return onFailure(ctx, mission, media, job.provider, "toujours en cours après 15 minutes");
  const next = { ...job, polls: job.polls + 1 };
  const r = await provider.poll(job.jobId, job.ref);
  if (r.status === "queued" || r.status === "running")
    return {
      ok: true,
      output: { mediaJob: next },
      wait: { delayMs: pollDelayMs(next.polls) },
      summary: `${r.transient ? `relecture impossible (${(r.error ?? "").slice(0, 80)})` : r.status === "queued" ? "en file chez le fournisseur" : "en cours chez le fournisseur"}`,
    };
  if (r.status === "failed" || !r.outputUrl) return onFailure(ctx, mission, media, job.provider, r.error ?? "résultat sans fichier");

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

export async function runVideo(mission: Mission, ctx: AgentContext): Promise<AgentResult> {
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
  return submit(ctx, mission, media, persona, sourceAssetId);
}

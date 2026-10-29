/**
 * Média IA, photo : génération d'une photo neuve du personnage avec son LoRA (fal Flux + LoRA, ou faux fournisseur en
 * simulation), plafond photo vérifié avant l'appel avec le coût estimé, rangement `MediaAsset` PHOTO / AI. Échec,
 * LoRA manquant ou plafond atteint → repli sur un post texte (journalisé).
 *
 * Relecture de la phase 25 : génération et téléchargement séparés. Le travail est gardé dans `payload.photoJob` dès
 * la soumission (identifiant, adresses, coût) : une reprise relit ce travail au lieu d'en payer un autre ; une fois la
 * photo générée, ses adresses y sont gardées et seul le téléchargement est refait. Le coût est compté une seule fois
 * (`photoJob.costCounted`), dans tous les cas où la génération a eu lieu (photo écartée par le filtre de contenu de
 * fal, téléchargement en échec, abandon d'un travail soumis compris).
 */
import { paidCentsOf } from "../../providers/fal";
import { ProviderError } from "../../providers/http";
import type { ImageGenerateResult, ImageJobRef } from "../../providers/image";
import { parsePayload } from "../../missions/mission";
import { resolveMediaProviders } from "../../providers/registry";
import type { AgentContext, AgentResult, Mission } from "../../types";
import { loadPersonaMedia, loadPlan, personaIdOf } from "../data";
import { checkMediaBudget } from "./budget";
import { applyFallback } from "./fallback";
import { buildPhotoPrompt } from "./prompt";
import { storeProducedMedia } from "./store";

/** Essais d'une photo après une erreur passagère (429, 5xx) avant le repli texte. */
export const PHOTO_MAX_ATTEMPTS = 3;
export const PHOTO_RETRY_DELAY_MS = 60_000;

/** Travail photo gardé dans la mission. */
export type PhotoJob = {
  provider: string;
  /** Soumission (fal) : relue à la reprise, jamais resoumise. */
  job?: ImageJobRef | null;
  /** Photos générées (adresses temporaires du fournisseur) : seul le téléchargement reste à faire. */
  images?: ImageGenerateResult["images"] | null;
  cents: number;
  /** Coût déjà rendu par une étape (compté une seule fois). */
  costCounted?: boolean;
  attempt: number;
};

export function photoJobOf(v: unknown): PhotoJob | null {
  if (!v || typeof v !== "object") return null;
  const j = v as Partial<PhotoJob>;
  return typeof j.provider === "string" && typeof j.cents === "number" ? (j as PhotoJob) : null;
}

async function toText(ctx: AgentContext, mission: Mission, reason: string, cents = 0): Promise<AgentResult> {
  const fb = await applyFallback(ctx, mission, "photo", reason);
  return {
    ok: true,
    output: { ...(fb?.patch ?? { format: "text", mediaAssetId: null }), photoJob: null },
    ...(cents > 0 ? { costCents: cents, costProvider: "image" as const } : {}),
    summary: `photo impossible (${reason}) → post texte`,
  };
}

async function patchPhotoJob(ctx: AgentContext, missionId: string, photoJob: PhotoJob): Promise<void> {
  const row = await ctx.prisma.agentMission.findUnique({ where: { id: missionId }, select: { payload: true } });
  await ctx.prisma.agentMission.update({ where: { id: missionId }, data: { payload: JSON.parse(JSON.stringify({ ...parsePayload(row?.payload), photoJob })) as never } });
}

export async function runPhoto(given: Mission, ctx: AgentContext): Promise<AgentResult> {
  // Charge utile relue en base : un travail gardé par un essai précédent (plantage) est repris.
  const row = await ctx.prisma.agentMission.findUnique({ where: { id: given.id }, select: { payload: true } });
  const saved = row ? parsePayload(row.payload) : {};
  const mission: Mission = "photoJob" in saved ? { ...given, payload: { ...given.payload, photoJob: saved.photoJob } } : given;
  const plan = await loadPlan(ctx.prisma, mission);
  const persona = await loadPersonaMedia(ctx.prisma, personaIdOf(mission, plan));
  const kept = photoJobOf(mission.payload.photoJob);
  if (!persona) return toText(ctx, mission, "aucune persona sur le plan du canal", kept && !kept.costCounted ? kept.cents : 0);
  const media = await resolveMediaProviders({ prisma: ctx.prisma, settings: ctx.settings, providers: ctx.providers, fetch: ctx.fetch, now: ctx.now });
  const image = media.image;
  const simulation = image.name === "fake";
  // Travail d'un autre fournisseur (clé changée) : abandonné, son coût compté s'il a été soumis.
  const prior = kept && kept.provider === image.name ? kept : null;
  const priorUnpaid = kept && !prior && !kept.costCounted && (kept.job || kept.images) ? kept.cents : 0;
  if (!prior) {
    if (!simulation && (!persona.loraUrl || !persona.loraTrigger))
      return toText(ctx, mission, `LoRA ou mot déclencheur de ${persona.name} manquant (fiche persona)`, priorUnpaid);
    const estimate = image.estimateCents({ count: 1, aspect: "portrait" });
    const budget = await checkMediaBudget(ctx, "image", estimate);
    if (!budget.ok) return toText(ctx, mission, budget.reason, priorUnpaid);
  }

  const attempts = (typeof mission.payload.photoAttempts === "number" ? mission.payload.photoAttempts : 0) + 1;
  const theme = typeof mission.payload.theme === "string" ? mission.payload.theme : null;
  let state: PhotoJob = prior ?? { provider: image.name, cents: 0, attempt: attempts };
  /** Coût à rendre par cette étape (une seule fois sur la vie du travail). */
  const due = () => (!state.costCounted && (state.images || state.job) ? Math.max(0, Math.round(state.cents)) : 0) + priorUnpaid;
  try {
    if (!state.images?.length) {
      const res = await image.generate(
        {
          loraUrl: persona.loraUrl ?? "",
          triggerWord: persona.loraTrigger ?? persona.name,
          loraScale: persona.loraScale,
          prompt: buildPhotoPrompt({ trigger: persona.loraTrigger ?? persona.name, mediaNotes: persona.mediaNotes, theme, seed: `${mission.id}:${state.attempt}` }),
          count: 1,
          aspect: "portrait",
          referenceAssetId: persona.referenceImageIds[0] ?? null,
        },
        {
          resume: state.job ?? null,
          onSubmitted: async (job) => {
            state = { ...state, job, cents: job.cents };
            await patchPhotoJob(ctx, mission.id, state);
          },
        },
      );
      state = { ...state, images: res.images, cents: res.cents };
      if (!res.images[0]) throw new ProviderError("aucune photo rendue", false);
    }
    const first = state.images![0]!;
    let file: Awaited<ReturnType<typeof image.download>>;
    try {
      file = await image.download(first.url);
    } catch (err) {
      const message = (err as Error).message || "erreur inconnue";
      const transient = err instanceof ProviderError ? err.transient : true;
      const cents = due();
      // Photo générée : son coût est compté maintenant ; seul le téléchargement sera refait.
      if (transient && attempts < PHOTO_MAX_ATTEMPTS)
        return {
          ok: true,
          output: { photoAttempts: attempts, photoJob: { ...state, costCounted: true } },
          ...(cents > 0 ? { costCents: cents, costProvider: "image" as const } : {}),
          wait: { delayMs: PHOTO_RETRY_DELAY_MS },
          summary: `photo générée, téléchargement : ${message.slice(0, 100)}, nouvel essai dans 1 min`,
        };
      return toText(ctx, mission, `photo générée mais impossible à télécharger : ${message.slice(0, 140)}`, cents);
    }
    const stored = await storeProducedMedia(ctx.prisma, {
      file,
      teamKey: mission.teamKey,
      personaId: persona.id,
      providerName: image.name,
      simulation,
      salt: `${mission.id}:photo:${state.attempt}`,
      width: first.width ?? null,
      height: first.height ?? null,
    });
    const cents = due();
    return {
      ok: true,
      output: { format: "photo", mediaAssetId: stored.id, personaId: persona.id, photoAttempts: attempts, photoJob: { ...state, costCounted: true } },
      costCents: cents,
      costProvider: "image",
      summary: `photo de ${persona.name}${simulation ? " (simulation)" : ""} prête${cents ? `, ${cents} c` : ""}`,
    };
  } catch (err) {
    const message = (err as Error).message || "erreur inconnue";
    const transient = err instanceof ProviderError ? err.transient : true;
    // Génération payée puis écartée (filtre de contenu) : coût compté, travail oublié.
    const paid = paidCentsOf(err);
    if (paid > 0) state = { ...state, cents: paid, images: [], job: state.job ?? null };
    const cents = paid > 0 ? (state.costCounted ? 0 : paid) + priorUnpaid : 0;
    if (transient && attempts < PHOTO_MAX_ATTEMPTS)
      return {
        ok: true,
        // Travail soumis gardé (relu au prochain essai) ; sans soumission, un nouvel essai complet.
        output: { photoAttempts: attempts, photoJob: paid > 0 ? null : state.job || state.images?.length ? state : null },
        ...(cents > 0 ? { costCents: cents, costProvider: "image" as const } : {}),
        wait: { delayMs: PHOTO_RETRY_DELAY_MS },
        summary: `photo : ${message.slice(0, 120)}, nouvel essai dans 1 min`,
      };
    // Abandon d'un travail soumis dont on ne sait rien : l'estimation est comptée (prudence).
    const abandoned = paid > 0 ? cents : state.job && !state.costCounted ? Math.max(0, Math.round(state.cents)) + priorUnpaid : priorUnpaid;
    return toText(ctx, mission, `échec de la photo : ${message.slice(0, 160)}`, abandoned);
  }
}

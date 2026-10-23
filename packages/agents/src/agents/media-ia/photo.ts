/**
 * Média IA, photo : génération d'une photo neuve du personnage avec son LoRA (fal Flux + LoRA, ou faux fournisseur en
 * simulation), plafond photo vérifié avant l'appel avec le coût estimé, rangement `MediaAsset` PHOTO / AI. Échec,
 * LoRA manquant ou plafond atteint → repli sur un post texte (journalisé).
 */
import { ProviderError } from "../../providers/http";
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

async function toText(ctx: AgentContext, mission: Mission, reason: string): Promise<AgentResult> {
  const fb = await applyFallback(ctx, mission, "photo", reason);
  return { ok: true, output: fb?.patch ?? { format: "text", mediaAssetId: null }, summary: `photo impossible (${reason}) → post texte` };
}

export async function runPhoto(mission: Mission, ctx: AgentContext): Promise<AgentResult> {
  const plan = await loadPlan(ctx.prisma, mission);
  const persona = await loadPersonaMedia(ctx.prisma, personaIdOf(mission, plan));
  if (!persona) return toText(ctx, mission, "aucune persona sur le plan du canal");
  const media = await resolveMediaProviders({ prisma: ctx.prisma, settings: ctx.settings, providers: ctx.providers, fetch: ctx.fetch, now: ctx.now });
  const image = media.image;
  const simulation = image.name === "fake";
  if (!simulation && (!persona.loraUrl || !persona.loraTrigger))
    return toText(ctx, mission, `LoRA ou mot déclencheur de ${persona.name} manquant (fiche persona)`);

  const estimate = image.estimateCents({ count: 1, aspect: "portrait" });
  const budget = await checkMediaBudget(ctx, "image", estimate);
  if (!budget.ok) return toText(ctx, mission, budget.reason);

  const attempts = (typeof mission.payload.photoAttempts === "number" ? mission.payload.photoAttempts : 0) + 1;
  const theme = typeof mission.payload.theme === "string" ? mission.payload.theme : null;
  try {
    const res = await image.generate({
      loraUrl: persona.loraUrl ?? "",
      triggerWord: persona.loraTrigger ?? persona.name,
      loraScale: persona.loraScale,
      prompt: buildPhotoPrompt({ trigger: persona.loraTrigger ?? persona.name, mediaNotes: persona.mediaNotes, theme, seed: `${mission.id}:${attempts}` }),
      count: 1,
      aspect: "portrait",
      referenceAssetId: persona.referenceImageIds[0] ?? null,
    });
    const first = res.images[0];
    if (!first) throw new ProviderError("aucune photo rendue", false);
    const file = await image.download(first.url);
    const stored = await storeProducedMedia(ctx.prisma, {
      file,
      kind: "PHOTO",
      teamKey: mission.teamKey,
      personaId: persona.id,
      providerName: image.name,
      simulation,
      salt: `${mission.id}:photo:${attempts}`,
      width: first.width ?? null,
      height: first.height ?? null,
    });
    return {
      ok: true,
      output: { format: "photo", mediaAssetId: stored.id, personaId: persona.id, photoAttempts: attempts },
      costCents: res.cents,
      costProvider: "image",
      summary: `photo de ${persona.name}${simulation ? " (simulation)" : ""} prête${res.cents ? `, ${res.cents} c` : ""}`,
    };
  } catch (err) {
    const message = (err as Error).message || "erreur inconnue";
    const transient = err instanceof ProviderError ? err.transient : true;
    if (transient && attempts < PHOTO_MAX_ATTEMPTS)
      return {
        ok: true,
        output: { photoAttempts: attempts },
        wait: { delayMs: PHOTO_RETRY_DELAY_MS },
        summary: `photo : ${message.slice(0, 120)}, nouvel essai dans 1 min`,
      };
    return toText(ctx, mission, `échec de la photo : ${message.slice(0, 160)}`);
  }
}

/**
 * Stock de vidéos sources d'une persona : « non utilisée » = jamais publiée sur aucun canal. Sous 3, une demande
 * MEDIA est posée au client (« envoie 5 à 10 vidéos avec #dating #source #<prénom> »), une fois par jour au plus et
 * par persona (`Setting` `agents.dating.sourcesAsked.<personaId>` = jour de Paris).
 */
import { readSetting, writeSetting } from "../../admin/journal";
import { askHuman } from "../../human/requests";
import { personaTagOf } from "../../library/tags";
import { parisDay } from "../../rules/time";
import type { AgentContext } from "../../types";

export const LOW_SOURCE_STOCK = 3;

export function sourcesAskedKey(personaId: string): string {
  return `agents.dating.sourcesAsked.${personaId}`;
}

/** Règle pure : faut-il demander des vidéos (stock bas, pas encore demandé aujourd'hui) ? */
export function shouldAskForSources(unused: number, lastAskedDay: unknown, today: string): boolean {
  return unused < LOW_SOURCE_STOCK && lastAskedDay !== today;
}

export function sourcesQuestion(name: string, unused: number): string {
  const tag = personaTagOf(name) || "prenom";
  return `Il me reste ${unused} vidéo${unused > 1 ? "s" : ""} source${unused > 1 ? "s" : ""} non utilisée${unused > 1 ? "s" : ""} pour ${name}. Envoie-moi 5 à 10 vidéos avec la légende #dating #source #${tag} (ou réponds « plus tard »).`;
}

/** Vidéos sources de la persona jamais publiées (hors `excludeId`, celle qui vient d'être choisie). */
export async function unusedSourceCount(ctx: Pick<AgentContext, "prisma">, personaId: string, excludeId?: string | null): Promise<number> {
  const sources = await ctx.prisma.mediaAsset.findMany({
    where: { personaId, kind: "SOURCE", mimeType: { startsWith: "video/" } },
    select: { id: true },
  });
  const ids = sources.map((s) => s.id).filter((id) => id !== excludeId);
  if (!ids.length) return 0;
  const used = await ctx.prisma.mediaUsage.findMany({ where: { assetId: { in: ids } }, select: { assetId: true } });
  const usedSet = new Set(used.map((u) => u.assetId));
  return ids.filter((id) => !usedSet.has(id)).length;
}

/** Demande des vidéos si le stock est bas ; rend vrai si une demande a été posée. Jamais d'erreur levée. */
export async function maybeAskForSources(
  ctx: AgentContext,
  persona: { id: string; name: string },
  excludeId?: string | null,
): Promise<boolean> {
  try {
    const unused = await unusedSourceCount(ctx, persona.id, excludeId);
    const today = parisDay(ctx.now());
    if (!shouldAskForSources(unused, await readSetting(ctx, sourcesAskedKey(persona.id)), today)) return false;
    await writeSetting(ctx, sourcesAskedKey(persona.id), today);
    await askHuman(ctx, {
      teamKey: "dating",
      kind: "MEDIA",
      key: `media.dating.source.${persona.id}`,
      question: sourcesQuestion(persona.name, unused),
      expected: { count: 5, tags: ["dating", "source", personaTagOf(persona.name)] },
      onAnswer: { resume: false },
    });
    return true;
  } catch (err) {
    ctx.logger?.warn({ err: (err as Error).message, personaId: persona.id }, "[agents] demande de vidéos sources non posée");
    return false;
  }
}

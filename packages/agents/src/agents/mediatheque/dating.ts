/**
 * Médiathèque de l'équipe Dating : format du post tiré du mélange du jour du canal (3 photos pour 1 texte par
 * défaut, la part de vidéos d'un ancien mélange ignorée : vidéos IA retirées le 29 octobre 2026). Une photo est
 * produite par Média IA ; sans persona sur le plan, le post est un texte (repli journalisé).
 */
import { DATING_DEFAULT_MIX, dayFormat } from "../../chiefs/dating-format";
import { parsePayload } from "../../missions/mission";
import { parisDay, parisDayStart } from "../../rules/time";
import type { AgentContext, AgentResult, Mission } from "../../types";
import { loadPlan, personaIdOf } from "../data";
import { applyFallback } from "../media-ia/fallback";
import type { MediaFormat } from "./pick";

const isFormat = (f: unknown): f is MediaFormat => f === "video" || f === "photo" || f === "text";
/** Ancienne mission « vidéo » : devenue une photo. */
const datingFormat = (f: MediaFormat): MediaFormat => (f === "video" ? "photo" : f);

/** Formats voulus des autres posts du jour sur ce canal (missions non annulées ni échouées). */
async function plannedToday(ctx: AgentContext, mission: Mission): Promise<MediaFormat[]> {
  if (!mission.channelId) return [];
  const rows = await ctx.prisma.agentMission.findMany({
    where: {
      channelId: mission.channelId,
      id: { not: mission.id },
      status: { notIn: ["CANCELLED", "FAILED"] },
      // Jour du plan (comme le Casino) ; une mission créée à la main n'en a pas : sa date de création compte.
      OR: [{ planDay: parisDay(ctx.now()) }, { planDay: null, createdAt: { gte: parisDayStart(parisDay(ctx.now())) } }],
    },
    select: { payload: true },
  });
  return rows.map((r) => parsePayload(r.payload)).map((p) => p.plannedFormat ?? p.format).filter(isFormat);
}

export async function runDatingMediatheque(mission: Mission, ctx: AgentContext): Promise<AgentResult> {
  const plan = await loadPlan(ctx.prisma, mission);
  const personaId = personaIdOf(mission, plan);
  const planned: MediaFormat = datingFormat(
    isFormat(mission.payload.plannedFormat)
      ? mission.payload.plannedFormat
      : isFormat(mission.payload.format)
        ? mission.payload.format
        : dayFormat(plan.test ? DATING_DEFAULT_MIX : plan.mix, await plannedToday(ctx, mission)),
  );
  const base = { plannedFormat: planned, personaId, sourceAssetId: null };

  if (planned === "text") return { ok: true, skipped: true, output: { ...base, format: "text", mediaAssetId: null }, summary: "post texte" };
  if (!personaId) {
    const fb = await applyFallback(ctx, { ...mission, payload: { ...mission.payload, ...base } }, "photo", "aucune persona sur le plan du canal");
    return { ok: true, skipped: true, output: { ...base, ...(fb?.patch ?? {}), format: "text" }, summary: "aucune persona → post texte" };
  }
  return { ok: true, skipped: true, output: { ...base, format: "photo" }, summary: "post photo (produite par Média IA)" };
}

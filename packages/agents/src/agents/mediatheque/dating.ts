/**
 * Médiathèque de l'équipe Dating : format du post tiré du mélange du jour du canal (1 vidéo, 2 photos, 1 texte par
 * défaut), puis pour une vidéo la source de la persona jamais utilisée sur ce canal depuis 30 jours (ni réservée par
 * une autre mission en cours). Aucune source → repli photo (journalisé). Stock bas → demande au client.
 */
import { DATING_DEFAULT_MIX, dayFormat } from "../../chiefs/dating-format";
import { parsePayload } from "../../missions/mission";
import { parisDay, parisDayStart } from "../../rules/time";
import type { AgentContext, AgentResult, Mission } from "../../types";
import { loadPersonaMedia, loadPlan, personaIdOf } from "../data";
import { applyFallback } from "../media-ia/fallback";
import { pickAsset, type AssetUsage, type MediaFormat } from "./pick";
import { maybeAskForSources } from "./stock";

const isFormat = (f: unknown): f is MediaFormat => f === "video" || f === "photo" || f === "text";

/** Formats voulus des autres posts du jour sur ce canal (missions non annulées ni échouées). */
async function plannedToday(ctx: AgentContext, mission: Mission): Promise<MediaFormat[]> {
  if (!mission.channelId) return [];
  const rows = await ctx.prisma.agentMission.findMany({
    where: {
      channelId: mission.channelId,
      id: { not: mission.id },
      status: { notIn: ["CANCELLED", "FAILED"] },
      createdAt: { gte: parisDayStart(parisDay(ctx.now())) },
    },
    select: { payload: true },
  });
  return rows.map((r) => parsePayload(r.payload)).map((p) => p.plannedFormat ?? p.format).filter(isFormat);
}

/** Sources réservées par les autres missions en cours (comptées comme utilisées sur leur canal). */
async function reservedSources(ctx: AgentContext, mission: Mission): Promise<AssetUsage[]> {
  const rows = await ctx.prisma.agentMission.findMany({
    where: { id: { not: mission.id }, status: { in: ["PENDING", "RUNNING", "WAITING_VALIDATION", "WAITING_HUMAN"] } },
    select: { payload: true, channelId: true },
  });
  const now = ctx.now();
  return rows
    .map((r) => ({ p: parsePayload(r.payload), channelId: r.channelId }))
    .filter((r) => typeof r.p.sourceAssetId === "string" && r.channelId)
    .map((r) => ({ assetId: r.p.sourceAssetId as string, channelId: r.channelId!, usedAt: now }));
}

export async function runDatingMediatheque(mission: Mission, ctx: AgentContext): Promise<AgentResult> {
  const plan = await loadPlan(ctx.prisma, mission);
  const personaId = personaIdOf(mission, plan);
  const planned: MediaFormat = isFormat(mission.payload.plannedFormat)
    ? mission.payload.plannedFormat
    : isFormat(mission.payload.format)
      ? mission.payload.format
      : dayFormat(plan.test ? DATING_DEFAULT_MIX : plan.mix, await plannedToday(ctx, mission));
  const base = { plannedFormat: planned, personaId };

  if (planned === "text") return { ok: true, skipped: true, output: { ...base, format: "text", mediaAssetId: null }, summary: "post texte" };
  if (!personaId) {
    const m = { ...mission, payload: { ...mission.payload, ...base } };
    const fb = planned === "video" ? await applyFallback(ctx, m, "video", "aucune persona sur le plan du canal") : null;
    const fb2 = await applyFallback(ctx, { ...m, payload: { ...m.payload, ...(fb?.patch ?? {}) } }, "photo", "aucune persona sur le plan du canal");
    return { ok: true, skipped: true, output: { ...base, ...(fb?.patch ?? {}), ...(fb2?.patch ?? {}), format: "text" }, summary: "aucune persona → post texte" };
  }
  if (planned === "photo") return { ok: true, skipped: true, output: { ...base, format: "photo" }, summary: "post photo (produite par Média IA)" };

  const persona = await loadPersonaMedia(ctx.prisma, personaId);
  if (!persona) {
    const fb = await applyFallback(ctx, { ...mission, payload: { ...mission.payload, ...base } }, "video", "persona introuvable");
    return { ok: true, skipped: true, output: { ...base, ...(fb?.patch ?? {}) }, summary: "persona introuvable → post photo" };
  }
  if (typeof mission.payload.sourceAssetId === "string")
    return { ok: true, output: { ...base, format: "video" }, summary: `vidéo source ${mission.payload.sourceAssetId}` };

  const candidates = await ctx.prisma.mediaAsset.findMany({
    where: { personaId, kind: "SOURCE", mimeType: { startsWith: "video/" } },
    select: { id: true, createdAt: true },
  });
  const usages = candidates.length
    ? await ctx.prisma.mediaUsage.findMany({ where: { assetId: { in: candidates.map((c) => c.id) } }, select: { assetId: true, channelId: true, usedAt: true } })
    : [];
  const channelId = mission.channelId ?? "";
  const picked = pickAsset(candidates, [...usages, ...(await reservedSources(ctx, mission))], channelId, ctx.now());
  await maybeAskForSources(ctx, persona, picked);
  if (!picked) {
    const fb = await applyFallback(ctx, { ...mission, payload: { ...mission.payload, ...base } }, "video", `aucune vidéo source disponible pour ${persona.name}`);
    return { ok: true, skipped: true, output: { ...base, ...(fb?.patch ?? {}) }, summary: `aucune vidéo source de ${persona.name} → post photo` };
  }
  return { ok: true, output: { ...base, format: "video", sourceAssetId: picked }, summary: `vidéo source ${picked} (${persona.name})` };
}

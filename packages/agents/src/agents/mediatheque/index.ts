/**
 * Agent Médiathèque (base, phase 19) : choisit le format du post d'après le mélange du canal, puis le prochain média
 * non utilisé sur ce canal (`MediaAsset` de l'équipe, et de la persona du plan s'il y en a une). Aucun média
 * disponible → post texte. Aucun appel externe.
 */
import type { AgentDefinition } from "../../types";
import { parsePayload } from "../../missions/mission";
import { loadPlan } from "../data";
import { runDatingMediatheque } from "./dating";
import { chooseFormat, pickAsset, type MediaFormat } from "./pick";

const MIME_PREFIX: Record<Exclude<MediaFormat, "text">, string> = { video: "video/", photo: "image/" };

export const agent: AgentDefinition = {
  key: "mediatheque",
  async run(mission, ctx) {
    if (mission.teamKey === "dating") return runDatingMediatheque(mission, ctx);
    const plan = await loadPlan(ctx.prisma, mission);
    let format: MediaFormat;
    if (mission.payload.format) format = mission.payload.format;
    else {
      const recent = mission.channelId
        ? await ctx.prisma.agentMission.findMany({
            where: { channelId: mission.channelId, status: "DONE", id: { not: mission.id } },
            orderBy: { createdAt: "desc" },
            take: 20,
            select: { payload: true },
          })
        : [];
      const formats = recent
        .map((m) => parsePayload(m.payload).format)
        .filter((f): f is MediaFormat => f === "video" || f === "photo" || f === "text");
      format = chooseFormat(plan.mix, formats);
    }
    if (format === "text" || !mission.channelId)
      return { ok: true, output: { format: "text", mediaAssetId: null }, summary: "post texte" };

    const candidates = await ctx.prisma.mediaAsset.findMany({
      where: {
        teamKey: mission.teamKey,
        mimeType: { startsWith: MIME_PREFIX[format] },
        ...(plan.personaId ? { personaId: plan.personaId } : {}),
      },
      select: { id: true, createdAt: true },
    });
    const usages = candidates.length
      ? await ctx.prisma.mediaUsage.findMany({
          where: { assetId: { in: candidates.map((c) => c.id) } },
          select: { assetId: true, channelId: true, usedAt: true },
        })
      : [];
    const assetId = pickAsset(candidates, usages, mission.channelId, ctx.now());
    if (!assetId)
      return {
        ok: true,
        output: { format: "text", mediaAssetId: null },
        summary: `pas de ${format === "video" ? "vidéo" : "photo"} disponible → post texte`,
      };
    return { ok: true, output: { format, mediaAssetId: assetId }, summary: `${format === "video" ? "vidéo" : "photo"} ${assetId}` };
  },
};

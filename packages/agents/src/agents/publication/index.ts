/**
 * Agent Publication : crée le `Post` programmé (créneau de Planification, bouton Offre de la campagne du plan),
 * envoyé ensuite par le scheduler existant. Idempotent : `AgentMission.postId` est posé dans la même transaction que la
 * création du message, et une mission qui a déjà son message n'en crée jamais un second. En simulation, le message
 * part sur le canal Test avec l'en-tête « [SIMULATION équipe … → <vrai canal>] ».
 */
import { createAgentPost, type PrismaClient } from "@linkaffipro/db";
import type { AgentDefinition } from "../../types";
import { findTestChannel, loadChannel, loadPlan } from "../data";
import { planSlot } from "../planification/plan";
import { withSimulationHeader } from "./header";
import { experimentGroupId, missionExperimentOf } from "../experimentation/variants";

/** Délai minimal entre la création du message et son envoi ; au-delà, le créneau est recalculé. */
const SLOT_MARGIN_MS = 60_000;

export const agent: AgentDefinition = {
  key: "publication",
  async run(mission, ctx) {
    if (mission.postId) {
      const existing = await ctx.prisma.post.findUnique({ where: { id: mission.postId }, select: { id: true } });
      if (existing) return { ok: true, output: { publishChannelId: mission.payload.publishChannelId }, summary: `déjà publié (${existing.id})` };
    }
    const text = mission.payload.text;
    if (!text) return { ok: false, error: "Aucun texte à publier.", retryable: false };
    const target = await loadChannel(ctx.prisma, mission.channelId);
    if (!target) return { ok: false, error: "Canal visé introuvable.", retryable: false };
    const simulation = ctx.settings.simulation || mission.isTest;
    const publishChannel = simulation ? await findTestChannel(ctx.prisma) : target;
    if (!publishChannel)
      return { ok: false, error: "Simulation : aucun canal Test actif (cochez « canal de test » sur un canal).", retryable: false };

    let slot = mission.payload.slot ? new Date(mission.payload.slot) : null;
    const now = ctx.now();
    if (!slot || slot.getTime() < now.getTime() + SLOT_MARGIN_MS) {
      const re = await planSlot(
        { ...mission, payload: { ...mission.payload, notBefore: mission.scheduledFor && mission.scheduledFor > now ? mission.scheduledFor.toISOString() : mission.payload.notBefore } },
        ctx,
      );
      slot = re.ok ? re.at : new Date(now.getTime() + 5 * 60_000);
    }
    const plan = await loadPlan(ctx.prisma, mission);
    const experiment = missionExperimentOf(mission.payload);
    const finalText = simulation ? withSimulationHeader(mission.teamKey, target.title, text) : text;
    const buttonText = typeof ctx.settings.settings.offerButtonText === "string" && ctx.settings.settings.offerButtonText
      ? ctx.settings.settings.offerButtonText
      : "🎁 Voir l'offre";

    const result = await (ctx.prisma as PrismaClient).$transaction(async (tx) => {
      const fresh = await tx.agentMission.findUnique({ where: { id: mission.id }, select: { postId: true } });
      if (fresh?.postId) return { postId: fresh.postId, created: false, publisher: null as string | null };
      const post = await createAgentPost(tx, {
        channelId: publishChannel.id,
        text: finalText,
        scheduledAt: slot!,
        mediaAssetIds: mission.payload.mediaAssetId ? [mission.payload.mediaAssetId] : [],
        agentMissionId: mission.id,
        language: target.language,
        offer: plan.campaignId ? { campaignId: plan.campaignId, buttonText, labelSuffix: simulation ? " (agents, simulation)" : " (agents)" } : null,
        ab: experiment ? { groupId: experimentGroupId(experiment.id), variant: experiment.variant } : null,
      });
      await tx.agentMission.update({ where: { id: mission.id }, data: { postId: post.postId, scheduledFor: slot } });
      if (mission.payload.mediaAssetId)
        await tx.mediaUsage.create({
          data: { assetId: mission.payload.mediaAssetId, channelId: publishChannel.id, postId: post.postId, missionId: mission.id, usedAt: now },
        });
      // Vidéo source d'une vidéo produite : comptée sur le canal VISÉ (même en simulation), jamais réutilisée
      // sur ce canal avant 30 jours.
      const source = mission.payload.format === "video" && typeof mission.payload.sourceAssetId === "string" ? mission.payload.sourceAssetId : null;
      if (source && source !== mission.payload.mediaAssetId)
        await tx.mediaUsage.create({ data: { assetId: source, channelId: target.id, postId: post.postId, missionId: mission.id, usedAt: now } });
      return { postId: post.postId, created: true, publisher: post.publisher as string | null };
    });
    return {
      ok: true,
      output: { slot: slot!.toISOString(), publishChannelId: publishChannel.id, targetChannelId: target.id, simulation, postId: result.postId },
      summary: result.created
        ? `programmé ${slot!.toISOString()} sur ${simulation ? "le canal Test (simulation)" : "le canal"}${result.publisher === "ACCOUNT" ? ", par le compte Telegram" : ""}`
        : `déjà publié (${result.postId})`,
    };
  },
};

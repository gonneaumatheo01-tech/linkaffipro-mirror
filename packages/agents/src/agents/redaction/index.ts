/**
 * Agent Rédaction : écrit le post avec le modèle fort (réglage `agents.models`), à partir du canal, de la persona, des
 * consignes de l'équipe et des 30 derniers posts du canal. Une sortie invalide est une erreur « à réessayer ».
 */
import { TELEGRAM_CAPTION_MAX } from "@linkaffipro/core";
import type { AgentDefinition } from "../../types";
import { parsePayload } from "../../missions/mission";
import { loadChannel, loadPersona, loadPlan, personaIdOf, recentChannelTexts } from "../data";
import { buildRedactionUser, parseRedaction, REDACTION_SYSTEM } from "./prompt";
import { missionExperimentOf } from "../experimentation/variants";
import { loadCasinoOffer } from "../../casino/offer";
import { casinoTemplateTexts, inspirationsFor } from "../../casino/templates";
import { sportsRedaction } from "../../sports/steps";

export const agent: AgentDefinition = {
  key: "redaction",
  async run(mission, ctx) {
    // Équipe Paris sportifs (phase 23) : texte écrit par le code à partir des chiffres du pari.
    if (mission.teamKey === "sports") return sportsRedaction(mission, ctx);
    const llm = ctx.providers.llm;
    if (!llm) return { ok: false, error: "Aucun fournisseur d'IA texte.", retryable: false };
    const channel = await loadChannel(ctx.prisma, mission.channelId);
    if (!channel) return { ok: false, error: "Canal de la mission introuvable.", retryable: false };
    const plan = await loadPlan(ctx.prisma, mission);
    const [persona, recentPosts] = await Promise.all([
      loadPersona(ctx.prisma, personaIdOf(mission, plan)),
      recentChannelTexts(ctx.prisma, mission.channelId, mission.id),
    ]);
    const theme = (typeof mission.payload.theme === "string" ? mission.payload.theme : null) ?? (await nextTheme(ctx, mission.channelId, mission.id, plan.themes));
    const format = mission.payload.format ?? "text";
    // Équipe Casino : offre du moment (campagne du canal) et modèles de l'univers en inspiration.
    const casino = mission.teamKey === "casino";
    const offer = casino ? await loadCasinoOffer(ctx.prisma, plan.campaignId) : null;
    const inspirations = casino ? inspirationsFor(await casinoTemplateTexts(ctx.prisma), mission.id) : [];
    const maxLength = Math.min(ctx.settings.maxTextLength, format === "text" ? 4096 : TELEGRAM_CAPTION_MAX);
    const redoReason = mission.payload.redone ? (mission.payload.reasons ?? []).join(" ; ") || null : null;
    const res = await llm.complete({
      model: ctx.settings.models.strong,
      system: REDACTION_SYSTEM,
      user: buildRedactionUser({
        vertical: channel.vertical,
        channelTitle: channel.title,
        language: channel.language,
        format,
        maxLength,
        persona,
        styleGuidelines: ctx.settings.styleGuidelines,
        themes: plan.themes,
        theme,
        recentPosts,
        redoReason,
        channelStyleNotes: plan.styleNotes ?? null,
        testStyle: testStyleOf(mission.payload),
        offer: offer ? { name: offer.name, facts: offer.facts } : null,
        inspirations,
      }),
      maxTokens: 1200,
    });
    try {
      const out = parseRedaction(res.text, maxLength);
      return {
        ok: true,
        output: {
          text: out.text,
          hook: out.hook,
          topic: out.topic,
          theme,
          personaId: personaIdOf(mission, plan),
          ...(casino ? { offerCampaignId: offer?.campaignId ?? null } : {}),
        },
        costCents: res.costCents,
        summary: `sujet « ${out.topic} », ${out.text.length} caractères`,
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message, retryable: true, costCents: res.costCents };
    }
  },
};

/** Consigne de la variante d'un test A/B « style de légende » tiré pour cette mission. */
function testStyleOf(payload: Record<string, unknown>): string | null {
  const e = missionExperimentOf(payload);
  return e?.kind === "STYLE_LEGENDE" ? (e.config.style ?? null) : null;
}

/** Thème du plan le moins récemment traité sur ce canal (null si le plan n'en a pas). */
async function nextTheme(
  ctx: Parameters<AgentDefinition["run"]>[1],
  channelId: string | null,
  missionId: string,
  themes: readonly string[],
): Promise<string | null> {
  if (!themes.length) return null;
  if (!channelId) return themes[0]!;
  const recent = await ctx.prisma.agentMission.findMany({
    where: { channelId, id: { not: missionId }, status: { in: ["DONE", "RUNNING", "WAITING_VALIDATION"] } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { payload: true },
  });
  const order = recent.map((m) => parsePayload(m.payload).theme).filter((t): t is string => typeof t === "string");
  const unused = themes.find((t) => !order.includes(t));
  if (unused) return unused;
  return [...themes].sort((a, b) => order.indexOf(b) - order.indexOf(a))[0]!;
}

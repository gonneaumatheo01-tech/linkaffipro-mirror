/**
 * Agent Rédaction : écrit le post avec le modèle fort (réglage `agents.models`), à partir du canal, de la persona, des
 * consignes de l'équipe et des 30 derniers posts du canal. Une sortie invalide est une erreur « à réessayer ».
 */
import { TELEGRAM_CAPTION_MAX } from "@linkaffipro/core";
import type { AgentDefinition } from "../../types";
import { parsePayload } from "../../missions/mission";
import { loadChannel, loadPersona, loadPlan, recentChannelTexts } from "../data";
import { buildRedactionUser, parseRedaction, REDACTION_SYSTEM } from "./prompt";

export const agent: AgentDefinition = {
  key: "redaction",
  async run(mission, ctx) {
    const llm = ctx.providers.llm;
    if (!llm) return { ok: false, error: "Aucun fournisseur d'IA texte.", retryable: false };
    const channel = await loadChannel(ctx.prisma, mission.channelId);
    if (!channel) return { ok: false, error: "Canal de la mission introuvable.", retryable: false };
    const plan = await loadPlan(ctx.prisma, mission);
    const [persona, recentPosts] = await Promise.all([
      loadPersona(ctx.prisma, plan.personaId),
      recentChannelTexts(ctx.prisma, mission.channelId, mission.id),
    ]);
    const theme = (typeof mission.payload.theme === "string" ? mission.payload.theme : null) ?? (await nextTheme(ctx, mission.channelId, mission.id, plan.themes));
    const format = mission.payload.format ?? "text";
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
      }),
      maxTokens: 1200,
    });
    try {
      const out = parseRedaction(res.text, maxLength);
      return {
        ok: true,
        output: { text: out.text, hook: out.hook, topic: out.topic, theme, personaId: plan.personaId },
        costCents: res.costCents,
        summary: `sujet « ${out.topic} », ${out.text.length} caractères`,
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message, retryable: true, costCents: res.costCents };
    }
  },
};

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

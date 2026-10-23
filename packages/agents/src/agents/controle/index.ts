/**
 * Agent Contrôle qualité : (a) règles de contenu, (b) doublon avec les 30 derniers posts du canal, (c) média valide —
 * par le code ; (d) relecture IA facultative (modèle rapide, oui / non / doute). Verdict : publier, refaire (une fois,
 * retour à Rédaction) ou valider (demande humaine).
 */
import { checkContent } from "../../rules/content";
import { findDuplicate } from "../../rules/similarity";
import type { AgentContext, AgentDefinition, Mission } from "../../types";
import { parsePayload } from "../../missions/mission";
import { loadChannel, recentChannelTexts } from "../data";
import { decideVerdict, JUDGE_SYSTEM, mediaProblem, parseJudgement, type Judgement } from "./verdict";

async function autonomyFacts(mission: Mission, ctx: AgentContext) {
  const p = mission.payload;
  const others = { id: { not: mission.id }, status: "DONE" as const };
  const [channelDone, personaDone, themeDone] = await Promise.all([
    mission.channelId ? ctx.prisma.agentMission.count({ where: { ...others, channelId: mission.channelId } }) : Promise.resolve(1),
    typeof p.personaId === "string" ? ctx.prisma.agentMission.findMany({ where: others, select: { payload: true }, take: 500 }) : Promise.resolve(null),
    typeof p.theme === "string" && mission.channelId
      ? ctx.prisma.agentMission.findMany({ where: { ...others, channelId: mission.channelId }, select: { payload: true }, take: 500 })
      : Promise.resolve(null),
  ]);
  return {
    firstPostOfChannel: channelDone === 0,
    newPersona: personaDone ? !personaDone.some((m) => parsePayload(m.payload).personaId === p.personaId) : false,
    newTheme: themeDone ? !themeDone.some((m) => parsePayload(m.payload).theme === p.theme) : false,
    newCategory: false,
  };
}

export const agent: AgentDefinition = {
  key: "controle",
  async run(mission, ctx) {
    const p = mission.payload;
    const text = p.text ?? "";
    const problems: string[] = [];
    const content = checkContent(text, { maxLength: ctx.settings.maxTextLength, forbiddenWords: ctx.settings.forbiddenWords });
    problems.push(...content.problems.map((x) => x.message));
    const recent = await recentChannelTexts(ctx.prisma, mission.channelId, mission.id);
    const dup = findDuplicate(text, recent, ctx.settings.similarityThreshold);
    if (dup) problems.push(`trop proche d'un post récent du canal (${Math.round(dup.score * 100)} %)`);
    if (p.mediaAssetId) {
      const asset = await ctx.prisma.mediaAsset.findUnique({
        where: { id: p.mediaAssetId },
        select: { mimeType: true, size: true, duration: true },
      });
      const m = mediaProblem(asset, p.format);
      if (m) problems.push(m);
    }

    let judgement: Judgement = null;
    let judgementReason: string | null = null;
    let costCents = 0;
    const llm = ctx.providers.llm;
    if (!problems.length && !p.approved && llm && ctx.settings.settings.aiReview !== false) {
      const channel = await loadChannel(ctx.prisma, mission.channelId);
      const res = await llm.complete({
        model: ctx.settings.models.fast,
        system: JUDGE_SYSTEM,
        user: [
          "Tâche : controle",
          `Canal : ${channel?.title ?? "?"} (univers ${channel?.vertical ?? "général"})`,
          ctx.settings.styleGuidelines ? `Fiche de l'équipe : ${ctx.settings.styleGuidelines.slice(0, 1500)}` : "",
          `Post :\n${text}`,
        ]
          .filter(Boolean)
          .join("\n"),
        maxTokens: 300,
      });
      costCents = res.costCents;
      ({ judgement, reason: judgementReason } = parseJudgement(res.text));
    }

    const v = decideVerdict({
      ruleProblems: problems,
      judgement,
      judgementReason,
      approved: p.approved === true,
      redone: p.redone === true,
      autonomyLevel: ctx.settings.autonomyLevel,
      facts: await autonomyFacts(mission, ctx),
    });
    const judged = judgement ? `, relecture : ${judgement}` : "";
    if (v.verdict === "redo")
      return {
        ok: true,
        output: { verdict: "redo", redone: true, reasons: v.reasons },
        goTo: "redaction",
        costCents,
        summary: `à refaire : ${v.reasons.join(" ; ")}`,
      };
    if (v.verdict === "validate")
      return {
        ok: true,
        output: { verdict: "validate", reasons: v.reasons },
        needsValidation: { reason: v.reason },
        costCents,
        summary: `validation demandée : ${v.reason}${judged}`,
      };
    return { ok: true, output: { verdict: "publish", reasons: [] }, costCents, summary: `bon pour publication${judged}` };
  },
};

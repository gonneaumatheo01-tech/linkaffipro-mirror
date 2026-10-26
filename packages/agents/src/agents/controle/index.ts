/**
 * Agent Contrôle qualité : (a) règles de contenu, (b) doublon avec les 30 derniers posts du canal, (c) média valide —
 * par le code ; (d) relecture IA facultative (modèle rapide, oui / non / doute). Verdict : publier, refaire (une fois,
 * retour à Rédaction) ou valider (demande humaine).
 */
import { checkContent } from "../../rules/content";
import { findDuplicate } from "../../rules/similarity";
import { escapeHtml } from "@linkaffipro/core";
import type { AgentContext, AgentDefinition, AgentResult, Mission } from "../../types";
import { parsePayload } from "../../missions/mission";
import { loadChannel, recentChannelTexts } from "../data";
import { alwaysValidateReason } from "../../orchestrator/autonomy";
import { applyFallback } from "../media-ia/fallback";
import { loadPersonaMedia } from "../data";
import { checkProducedMedia, storeControlFrame } from "./media-check";
import { casinoMediaRefusal, isCasinoTarget, offerButtonProblem } from "../../casino/control";
import { loadCasinoOffer, type CasinoOffer } from "../../casino/offer";
import { casinoTemplateTexts } from "../../casino/templates";
import { casinoFallbacksOf, CASINO_FALLBACK_EVENT } from "../mediatheque/casino";
import { inventedFigures } from "../../rules/figures";
import { loadPlan } from "../data";
import { agentEvent } from "../../admin/journal";
import { sportsControl } from "../../sports/steps";
import { referenceShinglesForChannel } from "../../inspiration/style";
import { COPY_PROBLEM, copiedSequence } from "../../inspiration/copy-check";
import { heldTeamControl, withGlobalQa } from "../../qa-gates/posts";
import { decideVerdict, JUDGE_SYSTEM, mediaProblem, parseJudgement, type Judgement } from "./verdict";

async function autonomyFacts(mission: Mission, ctx: AgentContext) {
  const p = mission.payload;
  const others = { id: { not: mission.id }, status: "DONE" as const };
  const [channelDone, personaDone, themeDone] = await Promise.all([
    mission.channelId ? ctx.prisma.agentMission.count({ where: { ...others, channelId: mission.channelId } }) : Promise.resolve(1),
    typeof p.personaId === "string" ? ctx.prisma.agentMission.findMany({ where: others, select: { payload: true }, take: 2000 }) : Promise.resolve(null),
    typeof p.theme === "string" && mission.channelId
      ? ctx.prisma.agentMission.findMany({ where: { ...others, channelId: mission.channelId }, select: { payload: true }, take: 500 })
      : Promise.resolve(null),
  ]);
  const offerId = typeof p.offerCampaignId === "string" ? p.offerCampaignId : null;
  const offerDone =
    mission.teamKey === "casino" && offerId
      ? (await ctx.prisma.agentMission.findMany({ where: { ...others, teamKey: "casino" }, select: { payload: true }, take: 2000 })).some(
          (m) => parsePayload(m.payload).offerCampaignId === offerId,
        )
      : true;
  const ofPersona = (personaDone ?? []).map((m) => parsePayload(m.payload)).filter((x) => x.personaId === p.personaId);
  return {
    firstPostOfChannel: channelDone === 0,
    personaVideosDone: ofPersona.filter((x) => x.format === "video").length,
    personaPhotosDone: ofPersona.filter((x) => x.format === "photo").length,
    newPersona: personaDone ? ofPersona.length === 0 : false,
    newTheme: themeDone ? !themeDone.some((m) => parsePayload(m.payload).theme === p.theme) : false,
    newCategory: false,
    newOffer: !offerDone,
  };
}

export const agent: AgentDefinition = {
  key: "controle",
  async run(mission, ctx) {
    // Phase 30 : le QA Global passe juste APRÈS le Contrôle de l'équipe (dernier verrou, `qa-gates/posts.ts`). Pendant
    // une panne du QA, le verdict de l'équipe est gardé : la relecture ne refait que la vérification globale.
    return withGlobalQa(mission, ctx, heldTeamControl(mission) ?? (await teamControl(mission, ctx)));
  },
};

/** Contrôle qualité de l'équipe (phases 19 à 27), avant le QA Global. */
async function teamControl(mission: Mission, ctx: AgentContext): Promise<AgentResult> {
  {
    // Équipe Paris sportifs (phase 23) : cote re-vérifiée, coup d'envoi, doublons, image, validations imposées ; puis
    // contrôle « jamais de copie » (phase 27) sur le texte qui partira (texte remis à la cote, ou corrigé par l'admin).
    if (mission.teamKey === "sports") return withSportsCopyCheck(mission, ctx, await sportsControl(mission, ctx));
    const p = mission.payload;
    const text = p.text ?? "";
    const problems: string[] = [];
    const content = checkContent(text, { maxLength: ctx.settings.maxTextLength, forbiddenWords: ctx.settings.forbiddenWords });
    problems.push(...content.problems.map((x) => x.message));
    const recent = await recentChannelTexts(ctx.prisma, mission.channelId, mission.id);
    const dup = findDuplicate(text, recent, ctx.settings.similarityThreshold);
    if (dup) problems.push(`trop proche d'un post récent du canal (${Math.round(dup.score * 100)} %)`);
    // Phase 27 : jamais 8 mots consécutifs repris d'un post d'un canal d'inspiration lié à ce canal.
    const copied = copiedSequence(text, await referenceShinglesForChannel(ctx, mission.channelId));
    // Jamais les mots eux-mêmes dans le motif (repris dans `AgentRun` et le journal, au-delà des 30 jours du texte).
    if (copied) problems.push(COPY_REFUSAL);
    if (p.mediaAssetId) {
      const asset = await ctx.prisma.mediaAsset.findUnique({
        where: { id: p.mediaAssetId },
        select: { mimeType: true, size: true, duration: true },
      });
      const m = mediaProblem(asset, p.format);
      if (m) problems.push(m);
    }

    // Équipe Casino : jamais de média non fourni, chiffres seulement ceux de la fiche de l'offre, modèles jamais recopiés.
    const channel0 = await loadChannel(ctx.prisma, mission.channelId);
    const casino = isCasinoTarget(mission.teamKey, channel0?.vertical);
    let offer: CasinoOffer | null = null;
    let offerProblem: string | null = null;
    if (casino) {
      if (p.mediaAssetId) {
        const asset = await ctx.prisma.mediaAsset.findUnique({ where: { id: p.mediaAssetId }, select: { origin: true } });
        const refusal = casinoMediaRefusal(asset ? { origin: asset.origin ?? null } : null);
        if (refusal) return refuseCasinoMedia(mission, ctx, refusal);
      }
      const plan = await loadPlan(ctx.prisma, mission);
      offer = await loadCasinoOffer(ctx.prisma, plan.campaignId);
      offerProblem = offerButtonProblem({ campaignId: plan.campaignId, offer, text });
      const invented = inventedFigures(text, offer?.facts ?? null);
      if (invented.length)
        problems.push(`chiffre absent de la fiche de l'offre (${invented.join(", ")}) : n'écris que ce que la fiche dit`);
      if (!dup) {
        const tdup = findDuplicate(text, await casinoTemplateTexts(ctx.prisma), ctx.settings.similarityThreshold);
        if (tdup) problems.push(`trop proche d'un modèle de message (${Math.round(tdup.score * 100)} %) : inspire-toi, ne recopie pas`);
      }
    }

    let judgement: Judgement = null;
    let judgementReason: string | null = null;
    let costCents = 0;

    // Média produit par l'IA : regard sur 3 images de la vidéo (ou sur la photo).
    let mediaDoubt: string | null = null;
    let doubtFrame: { bytes: Uint8Array; mime: string } | null = null;
    if (!problems.length && !p.approved) {
      const mc = await checkProducedMedia(mission, ctx);
      if (mc.kind === "technical") return technicalFailure(mission, ctx, mc.reason);
      if (mc.kind === "judged") {
        costCents += mc.costCents;
        if (mc.defect !== "non") {
          mediaDoubt = `${mc.defect === "oui" ? "défaut visible" : "doute"} (${mc.reason})`;
          if (mc.frame) doubtFrame = { bytes: mc.frame, mime: mc.frameMime };
        }
      }
    }
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
      costCents += res.costCents;
      ({ judgement, reason: judgementReason } = parseJudgement(res.text));
    }

    const facts = await autonomyFacts(mission, ctx);
    const persona = typeof p.personaId === "string" ? await loadPersonaMedia(ctx.prisma, p.personaId) : null;
    const alwaysValidate = alwaysValidateReason({
      teamKey: mission.teamKey,
      format: p.format,
      personaName: persona?.name ?? null,
      personaVideosDone: facts.personaVideosDone,
      personaPhotosDone: facts.personaPhotosDone,
      firstPostOfChannel: facts.firstPostOfChannel,
      mediaDoubt,
      theme: typeof p.theme === "string" ? p.theme : null,
      newTheme: facts.newTheme,
      newOffer: facts.newOffer,
      offerName: offer?.name ?? null,
      offerProblem,
      casinoChannel: channel0?.vertical === "CASINO",
    });
    const v = decideVerdict({
      ruleProblems: problems,
      judgement,
      judgementReason,
      approved: p.approved === true,
      redone: p.redone === true,
      autonomyLevel: ctx.settings.autonomyLevel,
      facts: { ...facts, alwaysValidate },
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
    if (v.verdict === "validate" && doubtFrame) await sendDoubtFrame(mission, ctx, doubtFrame, mediaDoubt!);
    if (v.verdict === "validate")
      return {
        ok: true,
        output: { verdict: "validate", reasons: v.reasons },
        needsValidation: { reason: v.reason },
        costCents,
        summary: `validation demandée : ${v.reason}${judged}`,
      };
    return { ok: true, output: { verdict: "publish", reasons: [] }, costCents, summary: `bon pour publication${judged}` };
  }
}

/** Motif de refus d'un texte qui reprend 8 mots d'un post de référence (sans les mots). */
export const COPY_REFUSAL = `${COPY_PROBLEM} : inspire-toi de la méthode, ne recopie jamais`;

/**
 * Paris sportifs (phase 27) : le texte écrit par le code, remis à la cote vérifiée ou corrigé par l'admin, ne reprend
 * jamais 8 mots d'un post de référence lié au canal. Texte fautif : jamais publié, même déjà validé (« approved ») ;
 * il part en validation pour être réécrit (le texte des paris ne se « refait » pas, comme les autres règles).
 */
export async function withSportsCopyCheck(mission: Mission, ctx: AgentContext, res: AgentResult): Promise<AgentResult> {
  if (!res.ok || res.skipped || res.goTo || res.wait) return res;
  const out = (res.output ?? {}) as Record<string, unknown>;
  if (out.betSkipped === true) return res;
  const text = typeof out.text === "string" ? out.text : (mission.payload.text ?? "");
  if (!text || !copiedSequence(text, await referenceShinglesForChannel(ctx, mission.channelId))) return res;
  const reasons = [...(Array.isArray(out.reasons) ? (out.reasons as unknown[]).filter((r): r is string => typeof r === "string" && r !== "") : []), COPY_REFUSAL];
  return {
    ...res,
    output: { ...out, verdict: "validate", approved: false, reasons },
    needsValidation: { reason: `à corriger : ${reasons.join(" ; ")}` },
    summary: `validation demandée : ${COPY_REFUSAL}`,
  };
}

/** Image du doute envoyée à l'admin juste avant l'aperçu de validation (qui, lui, porte la vidéo ou la photo). */
async function sendDoubtFrame(mission: Mission, ctx: AgentContext, frame: { bytes: Uint8Array; mime: string }, why: string): Promise<void> {
  try {
    const frameId = await storeControlFrame(ctx, mission, frame.bytes, frame.mime);
    await ctx.admin?.send(`🖼 Image regardée par le contrôle qualité : ${escapeHtml(why)}. La validation suit.`, { mediaAssetId: frameId });
  } catch (err) {
    ctx.logger?.warn({ err: (err as Error).message, missionId: mission.id }, "[agents] image du contrôle non envoyée");
  }
}

/**
 * Média non fourni sur un canal casino : jamais publié, même validé. La mission repart en post texte (repli
 * journalisé et compté dans le rapport) ; le média est retiré de la charge utile.
 */
async function refuseCasinoMedia(mission: Mission, ctx: AgentContext, reason: string): Promise<AgentResult> {
  const p = mission.payload;
  const from = p.format === "video" || p.format === "photo" ? p.format : "photo";
  const theme = typeof p.theme === "string" ? p.theme : null;
  const entry = { from, to: "text" as const, fromTheme: theme, toTheme: theme, reason: `média refusé : ${reason}`, at: ctx.now().toISOString() };
  await agentEvent(ctx, CASINO_FALLBACK_EVENT, { missionId: mission.id, from, to: "text", fromTheme: theme, toTheme: theme, reason: entry.reason }, { channelId: mission.channelId });
  return {
    ok: true,
    output: { format: "text", mediaAssetId: null, approved: false, redone: false, verdict: "redo", reasons: [reason], fallbacks: [...casinoFallbacksOf(p as Record<string, unknown>), entry] },
    goTo: "redaction",
    summary: `média refusé (${reason}) → post texte`,
  };
}

/** Échecs techniques tolérés avant d'abandonner la mission (chaque fois : repli vers le format suivant). */
const MAX_TECHNICAL_FAILURES = 2;

/** Média illisible ou hors bornes : jamais publié ; repli (vidéo → photo → texte) et reprise de la production. */
async function technicalFailure(mission: Mission, ctx: AgentContext, reason: string): Promise<AgentResult> {
  const p = mission.payload;
  const count = (typeof p.technicalFailures === "number" ? p.technicalFailures : 0) + 1;
  const format = p.format ?? "text";
  const fb = format === "text" || count > MAX_TECHNICAL_FAILURES ? null : await applyFallback(ctx, mission, format, `média refusé par le contrôle : ${reason}`);
  if (!fb) return { ok: false, error: `Média refusé par le contrôle qualité (${reason}) : jamais publié.`, retryable: false };
  return {
    ok: true,
    output: { ...fb.patch, mediaAssetId: null, technicalFailures: count, redone: false },
    goTo: fb.format === "photo" ? "media-ia" : "redaction",
    summary: `média refusé (${reason}) → ${fb.format === "photo" ? "post photo" : "post texte"}`,
  };
}

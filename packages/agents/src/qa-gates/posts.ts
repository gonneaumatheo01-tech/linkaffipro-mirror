/**
 * Phase 30, chantier B — QA Global des posts des équipes (Rencontres, Casino, Paris sportifs).
 *
 * Deux verrous, une seule empreinte :
 * 1. Étape de la mission : juste APRÈS le Contrôle qualité de l'équipe (`withGlobalQa`, appelé par l'agent Contrôle),
 *    sur le contenu tel qu'il partira (texte avec l'en-tête de simulation, médias, bouton Offre, canal de destination).
 *    Refus → la mission revient à la Rédaction avec les motifs et les corrections (même mécanique que le retour du
 *    Contrôle), ou à la validation de l'admin pour un pari (texte écrit par le code) ; QA indisponible → l'étape
 *    attend et se relit 5 minutes plus tard (rien ne part) ; 3e refus → Kevin demande au client de trancher.
 * 2. Point d'envoi du worker (`agentPostSendGate`) : un post d'agent (`Post.agentMissionId`) ne part que si une
 *    approbation existe pour l'empreinte de son contenu ACTUEL ; sinon vérification maintenant. Un post modifié après
 *    l'approbation est donc revérifié. Un post écrit par l'équipe humaine (sans mission) ne passe jamais par le QA.
 * Identifiant du contenu vérifié : la MISSION (les refus d'un même post, corrigé ou non, se cumulent) ; le canal fait
 * partie du contenu (un pari sur deux canaux = deux contenus).
 * Texte corrigé par l'admin dans une validation (`humanEdited`) : contenu du client, il ne passe pas par le QA (contrat).
 */
import { hasCustomEmoji } from "@linkaffipro/core";
import { agentEvent, nowOf } from "../admin/journal";
import { findTestChannel, loadChannel, loadPlan, type ChannelInfo } from "../agents/data";
import { withSimulationHeader, simulationHeader } from "../agents/publication/header";
import { cancelMission, continueMission } from "../missions/lifecycle";
import { parsePayload } from "../missions/mission";
import type { QaContent, QaDeps } from "../qa/contract";
import { contentHash } from "../qa/index";
import { loadCategory, loadMissionPick } from "../sports/data";
import { parseSportsSettings } from "../sports/settings";
import { textWithOdds } from "../sports/steps";
import type { AgentContext, AgentResult, AgentsDeps, Mission, TeamKey } from "../types";
import { askQaDecision, correctionLines, qaGate, recordClientOverride, registerQaDecisionHandler, shortMotif } from "./gate";

/** Relecture d'une étape quand le QA est indisponible (rien ne part entre-temps). */
export const QA_RETRY_MS = 5 * 60_000;
/** Bouton Offre des posts d'agents (même texte que l'agent Publication). */
export const DEFAULT_OFFER_BUTTON = "🎁 Voir l'offre";

export type PostQaShape = {
  text: string;
  mediaAssetIds: readonly string[];
  buttons: unknown;
  /** Canal où le post part (canal Test en simulation). */
  channelId: string;
  /** Canal visé par la mission (règles du canal). */
  targetChannelId: string | null;
  /** Univers du canal visé (règles de l'univers, règles publicitaires). */
  vertical: string | null;
};

/** Boutons réduits à ce qui se voit (texte, type, adresse) : les identifiants créés à l'enregistrement n'y sont pas. */
export function normalizeButtons(raw: unknown): Array<Array<{ text: string; type: string; url?: string }>> {
  if (!Array.isArray(raw)) return [];
  const rows = raw.map((row) => (Array.isArray(row) ? row : [row]));
  return rows
    .map((row) =>
      row
        .filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
        .map((b) => ({
          text: typeof b.text === "string" ? b.text : "",
          type: typeof b.type === "string" ? b.type : "URL",
          ...(typeof b.url === "string" && b.url ? { url: b.url } : {}),
        })),
    )
    .filter((row) => row.length > 0);
}

/** Contenu vérifié d'un post (même forme à l'étape et au point d'envoi : même empreinte). */
export function postQaContent(s: PostQaShape): QaContent {
  return {
    text: s.text,
    mediaAssetIds: [...s.mediaAssetIds],
    buttons: normalizeButtons(s.buttons),
    channelId: s.channelId,
    targetChannelId: s.targetChannelId,
    vertical: s.vertical,
  };
}

const offerButtons = (text: string, publishChannel: Pick<ChannelInfo, "type">, campaignId: string | null, buttonText: string) =>
  campaignId && !(hasCustomEmoji(text) && publishChannel.type !== "GROUP") ? [[{ text: buttonText, type: "OFFER" }]] : [];

/**
 * Posts tels que l'agent Publication les créera (même règles : en-tête de simulation, canal Test, bouton Offre de la
 * campagne sauf publication par le compte). Une prévision fausse coûte une vérification de plus au point d'envoi,
 * jamais un envoi sans vérification.
 */
export async function predictedPostShapes(mission: Mission, ctx: AgentContext, payload: Record<string, unknown>): Promise<PostQaShape[]> {
  const text0 = typeof payload.text === "string" ? payload.text : "";
  const mediaAssetIds = typeof payload.mediaAssetId === "string" && payload.mediaAssetId ? [payload.mediaAssetId] : [];
  const simulation = ctx.settings.simulation || mission.isTest;
  const test = simulation ? await findTestChannel(ctx.prisma) : null;
  if (mission.teamKey === "sports") {
    const pick = await loadMissionPick(ctx.prisma, { ...mission, payload: payload as Mission["payload"] });
    const category = pick ? await loadCategory(ctx.prisma, pick.categoryId) : null;
    const s = parseSportsSettings(ctx.settings.settings);
    const odds = typeof payload.oddsAtControl === "number" ? payload.oddsAtControl : (pick?.oddsAtSend ?? null);
    const text = pick && odds ? textWithOdds(payload, pick, s, odds).text : text0;
    const ids = Array.isArray(payload.targetChannelIds) ? (payload.targetChannelIds as string[]) : mission.channelId ? [mission.channelId] : [];
    const targets = (await Promise.all(ids.map((id) => loadChannel(ctx.prisma, id)))).filter((c): c is ChannelInfo => !!c);
    if (!targets.length) return [];
    const campaignId = category?.campaignId ?? null;
    if (simulation) {
      if (!test) return [];
      const t = `${simulationHeader("sports", targets.map((x) => x.title).join(", "))}\n${text}`;
      return [{ text: t, mediaAssetIds, buttons: offerButtons(t, test, campaignId, s.offerButtonText), channelId: test.id, targetChannelId: targets[0]!.id, vertical: targets[0]!.vertical }];
    }
    return targets.map((x) => ({ text, mediaAssetIds, buttons: offerButtons(text, x, campaignId, s.offerButtonText), channelId: x.id, targetChannelId: x.id, vertical: x.vertical }));
  }
  const target = await loadChannel(ctx.prisma, mission.channelId);
  if (!target) return [];
  const publish = simulation ? test : target;
  if (!publish) return [];
  const text = simulation ? withSimulationHeader(mission.teamKey, target.title, text0) : text0;
  const plan = await loadPlan(ctx.prisma, { ...mission, payload: payload as Mission["payload"] });
  const buttonText = typeof ctx.settings.settings.offerButtonText === "string" && ctx.settings.settings.offerButtonText ? ctx.settings.settings.offerButtonText : DEFAULT_OFFER_BUTTON;
  return [{ text, mediaAssetIds, buttons: offerButtons(text, publish, plan.campaignId, buttonText), channelId: publish.id, targetChannelId: target.id, vertical: target.vertical }];
}

/** Nom court d'un post pour le client (« un post sur Casino VIP »), sans son texte. */
async function postLabel(deps: Pick<AgentsDeps, "prisma">, channelId: string | null): Promise<string> {
  const c = channelId ? await loadChannel(deps.prisma as never, channelId).catch(() => null) : null;
  return c ? `un post sur ${c.title}` : "un post";
}

/**
 * Dernier verrou après le Contrôle qualité de l'équipe (étape de la mission). `res` : verdict du Contrôle de l'équipe.
 * Un renvoi, une attente, une étape sautée ou un pari écarté passent tels quels (rien ne sort à cette étape).
 */
export async function withGlobalQa(mission: Mission, ctx: AgentContext & QaDeps, res: AgentResult): Promise<AgentResult> {
  if (!res.ok || res.skipped || res.goTo || res.wait) return res;
  const out = (res.output ?? {}) as Record<string, unknown>;
  if (out.betSkipped === true) return res;
  // Validation demandée par le Contrôle de l'équipe pour des problèmes qu'il a trouvés : l'admin voit, corrige ou
  // refuse ; le QA Global passe ensuite (texte corrigé = texte du client ; validé tel quel = vérifié au point d'envoi,
  // rien ne part sans). Une validation de routine (niveau d'autonomie, nouveauté) passe d'abord par le QA Global.
  const teamReasons = Array.isArray(out.reasons) ? out.reasons.filter((r) => typeof r === "string" && r) : [];
  if (res.needsValidation && teamReasons.length) return res;
  // Mission annulée par le Contrôle (pari écarté) : rien à vérifier.
  const fresh = await ctx.prisma.agentMission.findUnique({ where: { id: mission.id }, select: { status: true } });
  if (fresh?.status === "CANCELLED") return res;
  const payload = { ...mission.payload, ...out } as Record<string, unknown>;
  if (typeof payload.text !== "string" || !payload.text.trim()) return res;
  const shapes = await predictedPostShapes(mission, ctx, payload);
  if (!shapes.length) return res;
  const contents = shapes.map(postQaContent);

  // Texte écrit par l'admin dans la validation : contenu du client, accord rangé pour ces empreintes exactes. Le repère
  // `humanEdited` reste dans la charge utile après une nouvelle rédaction (retour à la Rédaction après un refus) : il
  // ne vaut que si le texte est ENCORE celui que l'admin a écrit (jamais un texte de l'IA rangé comme texte du client).
  if (payload.humanEdited === true && (await isClientEditedText(ctx, mission.id, payload.text))) {
    for (const c of contents) await recordClientOverride(ctx, "POST", mission.id, contentHash(c), "client-edit", nowOf(ctx));
    await agentEvent(ctx, "qa.post.client_text", { missionId: mission.id, teamKey: mission.teamKey }, { channelId: mission.channelId });
    return res;
  }

  for (const content of contents) {
    const gate = await qaGate(ctx, { contentType: "POST", contentId: mission.id, teamKey: mission.teamKey, content, channelId: mission.channelId });
    if (gate.kind === "approved") continue;
    if (gate.kind === "unavailable")
      return {
        ok: true,
        output: {
          ...out,
          qaWaitingSince: (mission.payload as Record<string, unknown>).qaWaitingSince ?? nowOf(ctx).toISOString(),
          // Verdict du Contrôle de l'équipe gardé pour la relecture (pas de nouvel appel payant tant que rien ne change).
          qaHeld: { key: heldKey(payload), output: out, needsValidation: res.needsValidation ?? null, summary: res.summary ?? null },
        } as never,
        wait: { delayMs: QA_RETRY_MS },
        costCents: res.costCents,
        summary: "contrôle qualité global indisponible : rien ne part, nouvel essai dans 5 minutes",
      };
    const lines = correctionLines(gate.result);
    const qa = { checkId: gate.result.checkId, attempt: gate.result.attempt, reasons: lines };
    if (gate.needsHuman) {
      await ctx.prisma.agentMission.updateMany({ where: { id: mission.id, status: { in: ["RUNNING", "PENDING"] } }, data: { status: "WAITING_HUMAN", lastActivityAt: nowOf(ctx) } });
      await askQaDecision(ctx, {
        contentType: "POST",
        contentId: mission.id,
        teamKey: mission.teamKey,
        hash: gate.hash,
        label: await postLabel(ctx, mission.channelId),
        result: gate.result,
        missionId: mission.id,
        extra: { stage: "mission" },
      });
      return {
        ok: true,
        goTo: "controle",
        output: { ...out, qa, approved: false } as never,
        costCents: res.costCents,
        summary: `refusé 3 fois par le contrôle qualité global (${shortMotif(gate.result, 120)}) : le client tranche`,
      };
    }
    if (mission.teamKey === "sports")
      // Texte d'un pari écrit par le code : il ne se « refait » pas ; l'admin le corrige dans la validation.
      return {
        ok: true,
        output: { ...out, verdict: "validate", approved: false, reasons: lines, qa } as never,
        needsValidation: { reason: `à corriger (contrôle qualité global) : ${shortMotif(gate.result, 200)}` },
        costCents: res.costCents,
        summary: `refusé par le contrôle qualité global : ${shortMotif(gate.result, 120)}`,
      };
    return {
      ok: true,
      output: { ...out, verdict: "redo", redone: true, approved: false, reasons: lines, qa } as never,
      goTo: "redaction",
      costCents: res.costCents,
      summary: `refusé par le contrôle qualité global : ${shortMotif(gate.result, 120)}`,
    };
  }
  return { ...res, output: { ...out, qaWaitingSince: null, qaHeld: null } as never };
}

/** Le texte est-il exactement celui que l'admin a écrit dans la dernière validation corrigée de la mission ? */
async function isClientEditedText(deps: Pick<AgentsDeps, "prisma">, missionId: string, text: string): Promise<boolean> {
  try {
    const v = (await deps.prisma.agentValidation.findFirst({
      where: { missionId, status: "EDITED" },
      orderBy: { decidedAt: "desc" },
      select: { editedText: true },
    })) as { editedText: string | null } | null;
    return typeof v?.editedText === "string" && v.editedText.trim() !== "" && v.editedText.trim() === text.trim();
  } catch {
    return false;
  }
}

/** Repère du verdict gardé : texte, média et décision de l'admin (un changement relance le Contrôle de l'équipe). */
function heldKey(p: Record<string, unknown>): string {
  return contentHash({ text: p.text ?? null, mediaAssetId: p.mediaAssetId ?? null, approved: p.approved === true, humanEdited: p.humanEdited === true });
}

/**
 * Verdict du Contrôle de l'équipe gardé pendant que le QA Global était indisponible (même texte, même média) : la
 * relecture ne refait que la vérification globale. Null si rien n'est gardé ou si le contenu a changé.
 */
export function heldTeamControl(mission: Mission): AgentResult | null {
  const p = mission.payload as Record<string, unknown>;
  const h = p.qaHeld as { key?: unknown; output?: unknown; needsValidation?: unknown; summary?: unknown } | null | undefined;
  if (!h || typeof h !== "object" || h.key !== heldKey(p) || !h.output || typeof h.output !== "object") return null;
  const nv = h.needsValidation as { reason?: unknown } | null;
  return {
    ok: true,
    output: h.output as never,
    ...(nv && typeof nv.reason === "string" ? { needsValidation: { reason: nv.reason } } : {}),
    summary: typeof h.summary === "string" ? h.summary : "contrôle de l'équipe déjà fait",
  };
}

// ------------------------------------------------------------------------------------------------ point d'envoi

export type AgentPostRow = {
  id: string;
  agentMissionId: string | null;
  channelId: string;
  text: string | null;
  mediaAssetIds: unknown;
  buttons: unknown;
};

export type SendGateDecision = { decision: "send" } | { decision: "held"; reason: string; retryAt: Date } | { decision: "rejected"; reason: string } | { decision: "human"; reason: string };

/** Messages laissés sur le post retenu (`Post.lastError`). */
export const QA_POST_MESSAGES = {
  held: "En attente du contrôle qualité global (indisponible) : rien n'est publié, nouvel essai automatique.",
  rejected: "Retenu par le contrôle qualité global, rien n'est publié : ",
  human: "Refusé 3 fois par le contrôle qualité global : en attente de la décision du client. ",
} as const;

/** Contenu actuel d'un post enregistré. */
export async function postContentOf(deps: Pick<AgentsDeps, "prisma">, post: AgentPostRow): Promise<{ content: QaContent; teamKey: TeamKey | string } | null> {
  if (!post.agentMissionId) return null;
  const mission = (await deps.prisma.agentMission.findUnique({ where: { id: post.agentMissionId }, select: { teamKey: true, channelId: true } })) as { teamKey: string; channelId: string | null } | null;
  const target = mission?.channelId ? await loadChannel(deps.prisma as never, mission.channelId) : null;
  const media = Array.isArray(post.mediaAssetIds) ? post.mediaAssetIds.filter((x): x is string => typeof x === "string") : [];
  return {
    teamKey: mission?.teamKey ?? "agents",
    content: postQaContent({ text: post.text ?? "", mediaAssetIds: media, buttons: post.buttons, channelId: post.channelId, targetChannelId: mission?.channelId ?? null, vertical: target?.vertical ?? null }),
  };
}

/**
 * Verrou au point d'envoi. Rend « send » pour un post humain, ou si une approbation (ou l'accord du client) existe pour
 * l'empreinte actuelle. Sinon vérification maintenant ; refus, délai ou erreur → rien ne part, la mission est
 * prévenue. Ne lève jamais (une panne = « held »).
 */
export async function agentPostSendGate(deps: QaDeps, post: AgentPostRow): Promise<SendGateDecision> {
  if (!post.agentMissionId) return { decision: "send" };
  const now = nowOf(deps);
  try {
    const shape = await postContentOf(deps, post);
    if (!shape) return { decision: "send" };
    const gate = await qaGate(deps, { contentType: "POST", contentId: post.agentMissionId, teamKey: String(shape.teamKey), content: shape.content, channelId: post.channelId });
    if (gate.kind === "approved") return { decision: "send" };
    if (gate.kind === "unavailable") return { decision: "held", reason: QA_POST_MESSAGES.held, retryAt: new Date(now.getTime() + QA_RETRY_MS) };
    const motif = shortMotif(gate.result, 200);
    if (gate.needsHuman) {
      await askQaDecision(deps, {
        contentType: "POST",
        contentId: post.agentMissionId,
        teamKey: String(shape.teamKey),
        hash: gate.hash,
        label: await postLabel(deps, post.channelId),
        result: gate.result,
        extra: { stage: "send", postId: post.id },
      });
      return { decision: "human", reason: `${QA_POST_MESSAGES.human}${motif}` };
    }
    await returnMissionForQa(deps, post.agentMissionId, post.id, correctionLines(gate.result));
    return { decision: "rejected", reason: `${QA_POST_MESSAGES.rejected}${motif}` };
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message, postId: post.id }, "[qa] verrou d'envoi en échec : post retenu");
    return { decision: "held", reason: QA_POST_MESSAGES.held, retryAt: new Date(now.getTime() + QA_RETRY_MS) };
  }
}

/**
 * Post refusé au point d'envoi : la mission (souvent déjà terminée) est rouverte à la Rédaction avec les corrections ;
 * le post refusé est retiré par l'appelant (jamais envoyé). Les utilisations de médias du post sont rendues.
 */
export async function returnMissionForQa(deps: AgentsDeps, missionId: string, postId: string, reasons: string[]): Promise<void> {
  const row = await deps.prisma.agentMission.findUnique({ where: { id: missionId } });
  if (!row || row.status === "CANCELLED") return;
  // Pari publié sur plusieurs canaux dont un est déjà parti : la mission n'est pas refaite (jamais de doublon) ; seul
  // le post refusé est retiré.
  const sent = await deps.prisma.post.count({ where: { agentMissionId: missionId, status: "SENT", id: { not: postId } } });
  if (sent > 0) {
    await agentEvent(deps, "qa.post.dropped", { missionId, postId, teamKey: row.teamKey, reason: "autres canaux déjà publiés" }, { channelId: row.channelId });
    return;
  }
  const payload = parsePayload(row.payload);
  await deps.prisma.mediaUsage.deleteMany({ where: { postId } }).catch(() => undefined);
  const sports = row.teamKey === "sports";
  await deps.prisma.agentMission.update({
    where: { id: missionId },
    data: {
      status: "RUNNING",
      postId: row.postId === postId ? null : row.postId,
      lastActivityAt: nowOf(deps),
      payload: JSON.parse(JSON.stringify({ ...payload, postId: null, reasons, redone: true, approved: false, verdict: "redo", ...(sports ? { controlCheckedAt: null } : {}) })),
    },
  });
  await agentEvent(deps, "qa.post.returned", { missionId, postId, teamKey: row.teamKey, reasons: reasons.length }, { channelId: row.channelId });
  await continueMission(deps, missionId, { fromAgent: sports ? "controle" : "redaction", reason: "refusé par le contrôle qualité global" });
}

// ------------------------------------------------------------------------------------------------ décision du client

registerQaDecisionHandler("POST", {
  async onApprove(deps, d) {
    // Au point d'envoi : le post retenu repart tout de suite (l'accord vaut pour son empreinte exacte).
    const postId = typeof d.extra.postId === "string" ? d.extra.postId : null;
    if (postId) await deps.prisma.post.updateMany({ where: { id: postId, status: "DRAFT", agentMissionId: d.contentId }, data: { status: "SCHEDULED", scheduledAt: nowOf(deps), lastError: null } });
    // À l'étape : la mission reprend au Contrôle par la file des demandes (réponse reçue).
  },
  async onDrop(deps, d) {
    await cancelMission(deps, d.contentId, { reason: "refusé par le contrôle qualité global, abandonné par le client" });
    await deps.prisma.post.updateMany({ where: { agentMissionId: d.contentId, status: { in: ["DRAFT", "SCHEDULED"] } }, data: { status: "CANCELLED", lastError: "Abandonné par le client après 3 refus du contrôle qualité global." } });
  },
});

/**
 * Application, annulation et refus des recommandations (agent Synthèse & réglages). Bornes revérifiées au moment
 * d'appliquer ; la valeur réellement en place est gardée dans `before` (annulation en un clic) ; `Event` toujours,
 * `AuditLog` quand un humain agit. Une annulation est refusée si le réglage a été modifié depuis (rien n'est écrasé).
 */
import { Prisma } from "@linkaffipro/db";
import type { AgentsDeps } from "../../types";
import type { ActorRef } from "../../admin/team";
import { agentAudit, agentEvent, nowOf } from "../../admin/journal";
import { allowedHoursFor, loadAlgoTeam } from "../../algo/settings";
import { weekStartDate } from "../../algo/week";
import type { RecommendationActionResult } from "../../algo/contracts";
import { checkBounds } from "./bounds";
import { effectiveMix } from "../../algo/mix";
import { ADS_NEVER_APPLIED, ADS_TEAM_KEY } from "../ads/recommendations";
import { recommendationNotApproved } from "../../qa-gates/recommendations";

export type RecommendationRow = {
  id: string;
  teamKey: string;
  target: string;
  targetId: string;
  field: string;
  before: unknown;
  after: unknown;
  evidence: unknown;
  size: string;
  status: string;
  appliedAt: Date | null;
  source?: string | null;
};

/** Refus d'appliquer une proposition de l'analyse du marché par la mécanique des réglages (rien n'est changé). */
export const MARKET_NEVER_APPLIED =
  "Les propositions de l'analyse du marché ne s'appliquent jamais depuis la plateforme : acceptez-la ou refusez-la dans Agents → Analyses, puis agissez vous-même.";

/** Phase 32 : refus d'appliquer ou d'annuler un calibrage de la Prospection par la mécanique de l'équipe Algorithme. */
export const PROSPECTION_CALIBRATION_ELSEWHERE = "Le calibrage de la prospection se règle dans Agents → Prospection → Valeur, ou avec Kevin (« applique 1 »).";

type Actor = ActorRef | { by: "GRAND_CHEF" };
const isHuman = (a: Actor): a is ActorRef => !("by" in a);

/** Forme stable (clés triées) : Postgres réordonne les clés d'un JSON. */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object" && !(v instanceof Date))
    return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]));
  return v ?? null;
}
export const sameValue = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const same = sameValue;
const json = (v: unknown) => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));
/** Colonne JSON facultative : « rien » s'écrit DbNull pour Prisma. */
const jsonOrDbNull = (v: unknown) => (v === undefined || v === null ? Prisma.DbNull : json(v));
const JSON_PERSONA_FIELDS = new Set(["suggestedFollowUpHours"]);

/** Valeur actuelle d'un réglage ; `undefined` si la cible n'existe plus. */
export async function currentValue(deps: Pick<AgentsDeps, "prisma">, target: string, targetId: string, field: string): Promise<{ value: unknown; identity?: string } | undefined> {
  if (target === "CHANNEL_PLAN") {
    const plan = await deps.prisma.channelAgentPlan.findUnique({ where: { channelId: targetId } });
    if (!plan) return undefined;
    if (field === "window") return { value: { windowStart: plan.windowStart, windowEnd: plan.windowEnd } };
    return { value: (plan as Record<string, unknown>)[field] ?? null };
  }
  if (target === "TEAM_CONFIG") {
    const team = await deps.prisma.agentTeamConfig.findUnique({ where: { teamKey: targetId } });
    return team ? { value: (team as Record<string, unknown>)[field] ?? null } : undefined;
  }
  if (target === "PERSONA") {
    const p = (await deps.prisma.persona.findUnique({ where: { id: targetId } })) as Record<string, unknown> | null;
    return p ? { value: p[field] ?? null, identity: String(p.identityKind ?? "ASSISTANT") } : undefined;
  }
  return undefined;
}

async function writeValue(deps: Pick<AgentsDeps, "prisma">, target: string, targetId: string, field: string, value: unknown): Promise<void> {
  if (target === "CHANNEL_PLAN") {
    const data =
      field === "window"
        ? { windowStart: (value as { windowStart: string }).windowStart, windowEnd: (value as { windowEnd: string }).windowEnd }
        : { [field]: json(value) };
    await deps.prisma.channelAgentPlan.update({ where: { channelId: targetId }, data });
  } else if (target === "TEAM_CONFIG") {
    await deps.prisma.agentTeamConfig.update({ where: { teamKey: targetId }, data: { [field]: value ?? "" } });
  } else if (target === "PERSONA") {
    await deps.prisma.persona.update({ where: { id: targetId }, data: { [field]: JSON_PERSONA_FIELDS.has(field) ? jsonOrDbNull(value) : (value ?? null) } });
  }
}

/** Mélange du début de semaine : « avant » de la première recommandation de mélange appliquée cette semaine. */
async function weekBaseMix(deps: AgentsDeps, teamKey: string, channelId: string, current: unknown) {
  const since = weekStartDate(nowOf(deps));
  const first = (await deps.prisma.recommendation.findFirst({
    where: { target: "CHANNEL_PLAN", targetId: channelId, field: "mix", status: "APPLIED", appliedAt: { gte: since } },
    orderBy: { appliedAt: "asc" },
  })) as RecommendationRow | null;
  return effectiveMix(teamKey, first ? first.before : current);
}

/** Valeur à écrire : exemples de style ajoutés (B) réappliqués sur le registre actuel s'il a changé. */
function valueToWrite(rec: RecommendationRow, current: unknown): unknown {
  const append = (rec.evidence as { append?: unknown } | null)?.append;
  if (rec.target === "PERSONA" && rec.field === "styleExamples" && Array.isArray(append) && !same(current, rec.before)) {
    const base = typeof current === "string" ? current : "";
    const have = new Set(base.split("\n").map((l) => l.trim()).filter(Boolean));
    return [base.trimEnd(), ...append.filter((l): l is string => typeof l === "string" && !have.has(l.trim()))].filter(Boolean).join("\n");
  }
  return rec.after;
}

export async function applyRecommendationImpl(deps: AgentsDeps, id: string, actor: Actor): Promise<RecommendationActionResult> {
  const rec = (await deps.prisma.recommendation.findUnique({ where: { id } })) as RecommendationRow | null;
  if (!rec) return { ok: false, message: "Recommandation introuvable." };
  // Agent Ads (phase 24) : il recommande, il n'agit jamais chez Meta / TikTok ; rien n'est écrit.
  if (rec.teamKey === ADS_TEAM_KEY) return { ok: false, message: ADS_NEVER_APPLIED };
  // Analyse du marché (phase 29) : elle recommande, le client agit ; rien n'est écrit ici (« applique 2 » chez Kevin).
  if (rec.teamKey === "analystes" || rec.source === "market_analysis") return { ok: false, message: MARKET_NEVER_APPLIED };
  // Phase 32 : le calibrage de la Prospection a sa propre application (choix numérotés, bornes, suivi).
  if (rec.teamKey === "prospection" || rec.source === "prospection_calibration") return { ok: false, message: PROSPECTION_CALIBRATION_ELSEWHERE };
  if (rec.status !== "PROPOSED") return { ok: false, message: rec.status === "APPLIED" ? "Déjà appliquée." : "Cette recommandation n'est plus proposée." };
  // Phase 30 : jamais appliquée sans l'approbation du QA Global pour son contenu actuel (humain comme Grand Chef).
  const notApproved = await recommendationNotApproved(deps, rec as never);
  if (notApproved) return { ok: false, message: notApproved };
  const cur = await currentValue(deps, rec.target, rec.targetId, rec.field);
  if (cur === undefined) return { ok: false, message: "La cible de ce réglage n'existe plus." };
  const { settings } = await loadAlgoTeam(deps.prisma);
  const wanted = valueToWrite(rec, cur.value);
  const bounds = checkBounds(
    { target: rec.target, field: rec.field, after: wanted },
    {
      settings,
      weekBaseMix: rec.field === "mix" ? await weekBaseMix(deps, rec.teamKey, rec.targetId, cur.value) : null,
      currentMix: rec.field === "mix" ? effectiveMix(rec.teamKey, cur.value) : null,
      allowedHours: rec.target === "CHANNEL_PLAN" ? allowedHoursFor(settings, rec.targetId) : undefined,
      personaIdentity: cur.identity,
    },
  );
  const by = isHuman(actor) ? "HUMAN" : "GRAND_CHEF";
  if (!bounds.ok) {
    await agentEvent(deps, "agents.algo.recommendation_refused", { recommendationId: id, reason: bounds.reason, by });
    return { ok: false, message: bounds.reason };
  }
  if (same(cur.value, bounds.value)) {
    await deps.prisma.recommendation.update({ where: { id }, data: { status: "REJECTED", rejectedAt: nowOf(deps) } });
    return { ok: false, message: "Ce réglage est déjà en place : recommandation close." };
  }
  await writeValue(deps, rec.target, rec.targetId, rec.field, bounds.value);
  await deps.prisma.recommendation.update({
    where: { id },
    data: {
      status: "APPLIED",
      appliedAt: nowOf(deps),
      appliedBy: by,
      appliedById: isHuman(actor) ? (actor.userId ?? null) : null,
      before: jsonOrDbNull(cur.value),
      after: json(bounds.value),
    },
  });
  await agentEvent(deps, "agents.algo.recommendation_applied", { recommendationId: id, target: rec.target, targetId: rec.targetId, field: rec.field, by });
  if (isHuman(actor))
    await agentAudit(deps, {
      userId: actor.userId ?? null,
      action: "agents.algo.recommendation_applied",
      entityType: "Recommendation",
      entityId: id,
      metadata: { via: actor.via, target: rec.target, targetId: rec.targetId, field: rec.field },
    });
  return { ok: true, message: "Réglage appliqué." };
}

export async function undoRecommendationImpl(deps: AgentsDeps, id: string, actor: ActorRef): Promise<RecommendationActionResult> {
  const rec = (await deps.prisma.recommendation.findUnique({ where: { id } })) as RecommendationRow | null;
  if (!rec) return { ok: false, message: "Recommandation introuvable." };
  if (rec.teamKey === "prospection" || rec.source === "prospection_calibration") return { ok: false, message: PROSPECTION_CALIBRATION_ELSEWHERE };
  if (rec.status !== "APPLIED") return { ok: false, message: "Seul un réglage appliqué peut être annulé." };
  const cur = await currentValue(deps, rec.target, rec.targetId, rec.field);
  if (cur === undefined) return { ok: false, message: "La cible de ce réglage n'existe plus." };
  if (!same(cur.value, rec.after))
    return { ok: false, message: "Ce réglage a été modifié depuis : l'annulation écraserait ce changement. Modifiez-le à la main." };
  await writeValue(deps, rec.target, rec.targetId, rec.field, rec.before);
  await deps.prisma.recommendation.update({ where: { id }, data: { status: "UNDONE", undoneAt: nowOf(deps), undoneById: actor.userId ?? null } });
  await agentEvent(deps, "agents.algo.recommendation_undone", { recommendationId: id, target: rec.target, targetId: rec.targetId, field: rec.field });
  await agentAudit(deps, {
    userId: actor.userId ?? null,
    action: "agents.algo.recommendation_undone",
    entityType: "Recommendation",
    entityId: id,
    metadata: { via: actor.via, target: rec.target, targetId: rec.targetId, field: rec.field },
  });
  return { ok: true, message: "Réglage annulé : la valeur d'avant est remise." };
}

export async function rejectRecommendationImpl(deps: AgentsDeps, id: string, actor: ActorRef): Promise<RecommendationActionResult> {
  const rec = (await deps.prisma.recommendation.findUnique({ where: { id } })) as RecommendationRow | null;
  if (!rec) return { ok: false, message: "Recommandation introuvable." };
  if (rec.status !== "PROPOSED") return { ok: false, message: "Cette recommandation n'est plus proposée." };
  await deps.prisma.recommendation.update({ where: { id }, data: { status: "REJECTED", rejectedAt: nowOf(deps) } });
  await agentEvent(deps, "agents.algo.recommendation_rejected", { recommendationId: id });
  await agentAudit(deps, { userId: actor.userId ?? null, action: "agents.algo.recommendation_rejected", entityType: "Recommendation", entityId: id, metadata: { via: actor.via } });
  return { ok: true, message: "Recommandation refusée." };
}

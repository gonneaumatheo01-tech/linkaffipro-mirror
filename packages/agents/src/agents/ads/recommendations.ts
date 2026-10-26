/**
 * Recommandations de l'Agent Ads (`Recommendation` `teamKey = "ads"`) : jamais appliquées par le code. Le client les
 * fait lui-même chez Meta / TikTok puis les marque « Fait » (ou « Refusé »), avec un commentaire.
 * - une proposition ouverte sur la même cible et la même action est mise à jour, pas doublée ;
 * - une cible que le client vient de traiter (Fait / Refusé depuis moins de 7 jours) n'est pas re-proposée ;
 * - une proposition ouverte que les chiffres ne justifient plus est close (refusée par l'agent, commentaire dit).
 */
import type { ActorRef } from "../../admin/team";
import { agentAudit, agentEvent, nowOf } from "../../admin/journal";
import { ADS_ACTION_LABELS, ADS_TARGETS, type AdsAction, type AdsProposal } from "../../rules/ads";
import { parisDay } from "../../rules/time";
import type { AgentsDeps } from "../../types";
import { recommendationNotApproved } from "../../qa-gates/recommendations";

export const ADS_TEAM_KEY = "ads";
export const ADS_RECENT_DECISION_DAYS = 7;
export const ADS_OUTDATED_COMMENT = "Plus d'actualité : les chiffres ne la justifient plus (close par l'agent).";
const FIELD = "action";

type RecRow = { id: string; target: string; targetId: string; action: string | null; status: string; doneAt: Date | null; rejectedAt: Date | null; teamKey: string; comment: string | null };

export type SavedAdsRecommendations = { created: string[]; updated: string[]; closed: string[]; skipped: number; open: number };

const keyOf = (target: string, targetId: string, action: string | null) => `${target}:${targetId}:${action ?? ""}`;
const json = (v: unknown) => JSON.parse(JSON.stringify(v));

export async function saveAdsRecommendations(deps: AgentsDeps, proposals: readonly AdsProposal[]): Promise<SavedAdsRecommendations> {
  const now = nowOf(deps);
  const since = new Date(now.getTime() - ADS_RECENT_DECISION_DAYS * 86_400_000);
  const existing = (await deps.prisma.recommendation.findMany({
    where: { teamKey: ADS_TEAM_KEY, OR: [{ status: "PROPOSED" }, { doneAt: { gte: since } }, { rejectedAt: { gte: since } }] },
  })) as RecRow[];
  const open = new Map(existing.filter((r) => r.status === "PROPOSED").map((r) => [keyOf(r.target, r.targetId, r.action), r]));
  const recent = new Set(existing.filter((r) => r.status !== "PROPOSED" && r.comment !== ADS_OUTDATED_COMMENT).map((r) => keyOf(r.target, r.targetId, r.action)));
  const out: SavedAdsRecommendations = { created: [], updated: [], closed: [], skipped: 0, open: 0 };
  const wanted = new Set<string>();
  for (const p of proposals) {
    const target = ADS_TARGETS[p.level];
    const k = keyOf(target, p.targetId, p.action);
    wanted.add(k);
    const after = { action: p.action, label: ADS_ACTION_LABELS[p.action], name: p.evidence.name };
    const o = open.get(k);
    if (o) {
      await deps.prisma.recommendation.update({ where: { id: o.id }, data: { evidence: json(p.evidence), after: json(after), expectedGain: p.evidence.sentence, weekStart: parisDay(now) } });
      out.updated.push(o.id);
      continue;
    }
    if (recent.has(k)) {
      out.skipped++;
      continue;
    }
    const row = await deps.prisma.recommendation.create({
      data: {
        teamKey: ADS_TEAM_KEY,
        target,
        targetId: p.targetId,
        field: FIELD,
        action: p.action,
        after: json(after),
        evidence: json(p.evidence),
        expectedGain: p.evidence.sentence,
        size: "SMALL",
        status: "PROPOSED",
        weekStart: parisDay(now),
      },
    });
    out.created.push(row.id);
  }
  for (const [k, r] of open) {
    if (wanted.has(k)) continue;
    await deps.prisma.recommendation.update({ where: { id: r.id }, data: { status: "REJECTED", rejectedAt: now, comment: ADS_OUTDATED_COMMENT } });
    out.closed.push(r.id);
  }
  out.open = out.created.length + out.updated.length;
  if (out.created.length || out.closed.length)
    await agentEvent(deps, "agents.ads.recommendations", { created: out.created.length, updated: out.updated.length, closed: out.closed.length, skipped: out.skipped });
  return out;
}

/** Le client marque une recommandation « Fait » ou « Refusé » (commentaire facultatif) ; `AuditLog`. */
export async function markAdsRecommendationImpl(
  deps: AgentsDeps,
  input: { id: string; status: "DONE" | "REJECTED"; comment?: string | null },
  actor: ActorRef,
): Promise<{ ok: boolean; message: string }> {
  const rec = (await deps.prisma.recommendation.findUnique({ where: { id: input.id } })) as RecRow | null;
  if (!rec || rec.teamKey !== ADS_TEAM_KEY) return { ok: false, message: "Recommandation introuvable." };
  if (rec.status !== "PROPOSED") return { ok: false, message: "Cette recommandation n'est plus proposée." };
  if (input.status !== "DONE" && input.status !== "REJECTED") return { ok: false, message: "État inconnu." };
  // Phase 30 : « Fait » seulement sur une recommandation approuvée par le QA Global (refuser reste toujours possible).
  if (input.status === "DONE") {
    const notApproved = await recommendationNotApproved(deps, rec as never);
    if (notApproved) return { ok: false, message: notApproved };
  }
  const now = nowOf(deps);
  const comment = (input.comment ?? "").trim().slice(0, 1000) || null;
  await deps.prisma.recommendation.update({
    where: { id: rec.id },
    data:
      input.status === "DONE"
        ? { status: "DONE", doneAt: now, doneById: actor.userId ?? null, comment }
        : { status: "REJECTED", rejectedAt: now, comment },
  });
  const action = input.status === "DONE" ? "agents.ads.recommendation_done" : "agents.ads.recommendation_rejected";
  await agentAudit(deps, {
    userId: actor.userId ?? null,
    action,
    entityType: "Recommendation",
    entityId: rec.id,
    metadata: { via: actor.via, target: rec.target, targetId: rec.targetId, adsAction: rec.action, comment },
  });
  await agentEvent(deps, action, { recommendationId: rec.id, target: rec.target, targetId: rec.targetId, adsAction: rec.action, via: actor.via });
  const label = rec.action ? ADS_ACTION_LABELS[rec.action as AdsAction] ?? rec.action : "Recommandation";
  return { ok: true, message: input.status === "DONE" ? `« ${label} » noté comme fait ✅` : `« ${label} » refusé.` };
}

/** Message de refus d'`applyRecommendation` sur une recommandation de l'Agent Ads (rien n'est jamais appliqué). */
export const ADS_NEVER_APPLIED =
  "Les recommandations de l'Agent Ads ne s'appliquent jamais depuis la plateforme : faites-le chez Meta ou TikTok, puis marquez-la « Fait ».";

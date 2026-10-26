/**
 * Phase 30, chantier B — QA Global des recommandations (Algorithme, Inspiration, Analystes, Ads) avant présentation au
 * client (Kevin et site) et avant toute application.
 * - Une recommandation PROPOSED n'est montrée comme prête et ne s'applique (« applique 2 », niveau d'autonomie,
 *   bouton du site) que si une approbation existe pour l'empreinte de son contenu actuel ; sinon « en vérification ».
 * - Refusée → statut REJECTED avec le motif du QA (`comment`), jamais appliquée.
 * - File de rattrapage `qa-sweep` (5 min, file `agents-orchestrator`) : vérifie les PROPOSED sans approbation, retente
 *   les alertes des Analystes retenues faute de QA.
 */
import { agentEvent, nowOf } from "../admin/journal";
import { QA_REC_PENDING_TEXT, QA_REC_REFUSED_TEXT } from "../boss/qa-gate-texts";
import type { QaContent, QaDeps } from "../qa/contract";
import { findApproval } from "../qa/index";
import type { AgentsDeps } from "../types";
import { pendingAlerts } from "./analysts";
import { qaGate, shortMotif } from "./gate";

export type RecLike = {
  id: string;
  teamKey: string;
  target: string;
  targetId: string;
  field: string;
  after: unknown;
  evidence?: unknown;
  expectedGain?: string | null;
  size?: string | null;
  action?: string | null;
  source?: string | null;
  referenceChannelId?: string | null;
  status?: string;
};

/** Préfixe du motif écrit dans `Recommendation.comment` quand le QA la refuse. */
export const QA_REC_REJECTED_PREFIX = "Refusée par le contrôle qualité : ";
/** Vérifications au plus par passage de la file de rattrapage (30 s chacune au plus). */
export const QA_SWEEP_MAX_RECS = 10;

/** Contenu vérifié d'une recommandation (ce qui est proposé, jamais son statut ni le commentaire du client). */
/** Champ réglé qui est un identifiant de fiche (même règle de nom que les champs techniques du masquage). */
const ID_FIELD = /(?:Id|Ids)$/;

export function recQaContent(r: RecLike): QaContent {
  // Consigne marquée de l'inspiration : la ligne proposée (`evidence.line`) fait foi ; `after` est recalculé sur la
  // valeur actuelle au moment d'appliquer (même proposition, même empreinte).
  const ev = r.evidence && typeof r.evidence === "object" ? (r.evidence as Record<string, unknown>) : {};
  const tagged = r.field === "styleNotes" && typeof ev.tag === "string" && typeof ev.line === "string";
  return {
    teamKey: r.teamKey,
    target: r.target,
    targetId: r.targetId,
    field: r.field,
    // Réglage qui désigne une fiche (`styleProfileId` de l'inspiration) : l'identifiant est rangé sous son nom de champ,
    // donc lu comme un champ technique par le masquage (jamais pris pour une fuite d'identifiant interne).
    after: tagged ? null : ID_FIELD.test(r.field) ? { [r.field]: r.after ?? null } : (r.after ?? null),
    evidence: r.evidence ?? null,
    expectedGain: r.expectedGain ?? null,
    size: r.size ?? null,
    action: r.action ?? null,
    source: r.source ?? null,
    referenceChannelId: r.referenceChannelId ?? null,
  };
}

/** Recommandation approuvée par le QA pour son contenu actuel (lecture seule, sans appel au modèle) ? */
export async function isRecommendationApproved(deps: QaDeps, r: RecLike): Promise<boolean> {
  try {
    return (await findApproval(deps, "RECOMMENDATION", r.id, recQaContent(r))) !== null;
  } catch {
    return false;
  }
}

/** Sépare les recommandations approuvées (montrables) de celles en vérification (lecture seule). */
export async function splitApproved<T extends RecLike>(deps: QaDeps, recs: readonly T[]): Promise<{ approved: T[]; pending: T[] }> {
  const flags = await Promise.all(recs.map((r) => isRecommendationApproved(deps, r)));
  return { approved: recs.filter((_, i) => flags[i]), pending: recs.filter((_, i) => !flags[i]) };
}

/**
 * Garde de l'application (« applique N », niveau d'autonomie, bouton du site) : rend un message si la recommandation
 * n'est pas approuvée pour son contenu actuel (sinon null). Jamais vérifiée : elle l'est maintenant (refusée → close
 * avec le motif ; QA indisponible → « en vérification ») ; jamais appliquée sans approbation.
 */
export async function recommendationNotApproved(deps: QaDeps, r: RecLike): Promise<string | null> {
  if (await isRecommendationApproved(deps, r)) return null;
  const c = await checkRecommendations(deps, [r], 1);
  if (c.approved.length) return null;
  return c.rejected.length ? QA_REC_REFUSED_TEXT : QA_REC_PENDING_TEXT;
}

/**
 * Vérifie maintenant les recommandations sans approbation (avant de les montrer au client) : refusée → REJECTED avec
 * le motif ; QA indisponible → reste « en vérification ». Rend les approuvées (dans l'ordre des lots).
 */
export async function checkRecommendations<T extends RecLike>(deps: QaDeps, recs: readonly T[], max = QA_SWEEP_MAX_RECS): Promise<{ approved: T[]; rejected: string[]; pending: string[] }> {
  const approved: T[] = [];
  const rejected: string[] = [];
  const pending: string[] = [];
  const toCheck: T[] = [];
  for (const r of recs) {
    if (await isRecommendationApproved(deps, r)) approved.push(r);
    else if (toCheck.length < max) toCheck.push(r);
    else pending.push(r.id);
  }
  // Vérifications par lots de 4 (30 s au plus chacune) : une liste de propositions ne fait pas attendre 5 minutes.
  for (let i = 0; i < toCheck.length; i += 4) {
    const batch = toCheck.slice(i, i + 4);
    const gates = await Promise.all(batch.map((r) => qaGate(deps, { contentType: "RECOMMENDATION", contentId: r.id, teamKey: r.teamKey, content: recQaContent(r) })));
    for (const [j, gate] of gates.entries()) {
      const r = batch[j]!;
      if (gate.kind === "approved") approved.push(r);
      else if (gate.kind === "unavailable") pending.push(r.id);
      else {
        rejected.push(r.id);
        await deps.prisma.recommendation.updateMany({
          where: { id: r.id, status: "PROPOSED" },
          data: { status: "REJECTED", rejectedAt: nowOf(deps), comment: `${QA_REC_REJECTED_PREFIX}${shortMotif(gate.result, 300)}` },
        });
        await agentEvent(deps, "qa.recommendation.rejected", { recommendationId: r.id, teamKey: r.teamKey, checkId: gate.result.checkId });
      }
    }
  }
  return { approved, rejected, pending };
}

/** Passage de la file de rattrapage : recommandations PROPOSED sans approbation, alertes retenues. */
export async function qaSweep(
  deps: QaDeps & AgentsDeps,
  opts: { retryAlert?: (a: { kind: "rule" | "entry"; id: string }) => Promise<boolean> } = {},
): Promise<{ checked: number; approved: number; rejected: number; pending: number; alerts: number }> {
  const recs = (await deps.prisma.recommendation.findMany({ where: { status: "PROPOSED" }, orderBy: { createdAt: "asc" }, take: 200 })) as RecLike[];
  const r = await checkRecommendations(deps, recs, QA_SWEEP_MAX_RECS);
  let alerts = 0;
  if (opts.retryAlert) {
    for (const a of await pendingAlerts(deps, 10)) if (await opts.retryAlert(a).catch(() => false)) alerts++;
  }
  return { checked: recs.length, approved: r.approved.length, rejected: r.rejected.length, pending: r.pending.length, alerts };
}

/**
 * Phase 30, chantier B — réponse du client à la demande « publier quand même / laisser tomber » (après 3 refus du QA
 * Global). Module à part (importé par `qa-gates/index.ts`) : il dépend des demandes au client, que les agents
 * n'importent pas au chargement.
 */
import { agentAudit, agentEvent, nowOf } from "../admin/journal";
import { pick } from "../boss/voice";
import { QA_GATE_VARIANTS } from "../boss/qa-gate-texts";
import { registerAnswerAction } from "../human/respond";
import type { QaContentType } from "../qa/contract";
import { recordClientOverride } from "./gate";
import { qaDecisionHandler, QA_DECISION_ACTION, type QaDecisionRef } from "./registry";

registerAnswerAction(QA_DECISION_ACTION, async (deps, { value, actor, onAnswer }) => {
  const contentType = onAnswer.contentType as QaContentType;
  const contentId = typeof onAnswer.contentId === "string" ? onAnswer.contentId : "";
  const hash = typeof onAnswer.hash === "string" ? onAnswer.hash : "";
  if (!contentId || !hash) return undefined;
  const ref: QaDecisionRef = {
    contentType,
    contentId,
    hash,
    teamKey: typeof onAnswer.teamKey === "string" ? onAnswer.teamKey : "",
    extra: onAnswer.extra && typeof onAnswer.extra === "object" ? (onAnswer.extra as Record<string, unknown>) : {},
  };
  const h = qaDecisionHandler(contentType);
  const approved = value === "oui";
  if (approved) await recordClientOverride(deps, contentType, contentId, hash, "client", nowOf(deps), actor.userId ?? null);
  await agentAudit(deps, {
    userId: actor.userId ?? null,
    action: approved ? "qa.override.approved" : "qa.override.dropped",
    entityType: "QaCheck",
    entityId: contentId,
    metadata: { contentType, via: actor.via },
  });
  await agentEvent(deps, approved ? "qa.human.approved" : "qa.human.dropped", { contentType, contentId, teamKey: ref.teamKey, via: actor.via });
  try {
    if (approved) await h?.onApprove?.(deps, ref);
    else await h?.onDrop?.(deps, ref);
  } catch (err) {
    deps.logger?.error({ err: (err as Error).message, contentId }, "[qa] suite de la décision impossible");
  }
  return pick(approved ? QA_GATE_VARIANTS.decisionYes : QA_GATE_VARIANTS.decisionNo, approved ? "qa.decision.yes" : "qa.decision.no");
});

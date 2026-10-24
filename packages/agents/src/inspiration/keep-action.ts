/**
 * Phase 27, chantier C — réponse au bilan d'une inspiration (« je garde ? ») : oui = on garde, non = réglages d'avant
 * remis. Enregistrée au chargement du paquet (`index.ts`), à part de `apply.ts` pour éviter un cycle d'import avec
 * `human/respond.ts`.
 */
import { agentAudit } from "../admin/journal";
import { registerAnswerAction } from "../human/respond";
import { INSPIRATION_KEEP_ACTION, undoInspiration } from "./apply";

registerAnswerAction(INSPIRATION_KEEP_ACTION, async (deps, { value, actor, onAnswer }) => {
  const ids = Array.isArray(onAnswer.recommendationIds) ? onAnswer.recommendationIds.filter((x): x is string => typeof x === "string") : [];
  if (value === "oui") {
    await agentAudit(deps, { userId: actor.userId ?? null, action: "inspiration.kept", entityType: "Experiment", entityId: String(onAnswer.experimentId ?? ""), metadata: { via: actor.via, recommendationIds: ids } });
    return "D'accord, je garde ces réglages 👍";
  }
  const r = await undoInspiration(deps, ids, actor);
  return r.message;
});

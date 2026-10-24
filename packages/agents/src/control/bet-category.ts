/**
 * Activation d'une catégorie de paris (`BetCategory.active`, phase 23) depuis le Boss (phase 26). Même journal que
 * l'enregistrement par la fiche Paris sportifs (`agents.bet_category_saved`, champ changé `active`). Une catégorie
 * activée sert au prochain passage du Chef Paris (simulation par défaut inchangée).
 */
import { agentAudit } from "../admin/journal";
import type { ActorRef } from "../admin/team";
import type { AgentsDeps } from "../types";

export async function setBetCategoryActive(
  deps: AgentsDeps,
  categoryId: string,
  active: boolean,
  actor: ActorRef,
): Promise<{ ok: boolean; message: string; changed: boolean }> {
  const before = (await deps.prisma.betCategory.findUnique({ where: { id: categoryId } })) as {
    id: string;
    key: string;
    name: string;
    active: boolean;
  } | null;
  if (!before) return { ok: false, message: "Catégorie de paris introuvable.", changed: false };
  if (before.active === active)
    return { ok: true, message: `La catégorie « ${before.name} » est déjà ${active ? "active" : "désactivée"}.`, changed: false };
  await deps.prisma.betCategory.update({ where: { id: before.id }, data: { active, updatedById: actor.userId ?? null } });
  await agentAudit(deps, {
    userId: actor.userId ?? null,
    action: "agents.bet_category_saved",
    entityType: "BetCategory",
    entityId: before.id,
    metadata: { key: before.key, name: before.name, changed: ["active"], active, via: actor.via },
  });
  return {
    ok: true,
    changed: true,
    message: active
      ? `Catégorie « ${before.name} » activée ✅ : elle sert dès le prochain passage de l'équipe Paris sportifs.`
      : `Catégorie « ${before.name} » désactivée ⏸.`,
  };
}

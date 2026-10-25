/**
 * Phase 34, lot D — cœurs de la page Agents → Inspiration (phase 27), administrateurs seulement : « Annuler » une
 * proposition appliquée (ou toutes celles d'une référence : `undoInspiration` remet les réglages d'avant, 30 jours) et
 * « Retirer » une référence (`removeReference` efface ses posts lus et son profil de style). Journal à chaque geste.
 */
import { audit, prisma } from "@linkaffipro/db";
import { buildAgentsDeps } from "@/lib/agents/deps";
import { canManageInspiration, engineResult, referenceName, safeId } from "@/lib/agents/inspiration";
import { loadInspirationEngine } from "@/lib/agents/inspiration-engine";
import { engineActor, errorText, fail, forbidden, formOf, ok, preview, type CoreRun, type Fail } from "./kit";

const NOT_YET = "Pas encore disponible : réessayez après la prochaine mise à jour du site.";

export const runUndoInspiration: CoreRun = async (fd, actor, opts = {}) => {
  const referenceId = safeId(fd.get("referenceId"));
  if (!canManageInspiration(actor.role)) return forbidden("Annuler une inspiration est réservé aux administrateurs.");
  if (!referenceId) return fail("Référence inconnue.", "invalid", "referenceId");
  const recId = fd.get("recommendationId") ? safeId(fd.get("recommendationId")) : null;
  if (fd.get("recommendationId") && !recId) return fail("Proposition inconnue.", "invalid", "recommendationId");
  const applied = await prisma.recommendation.findMany({
    where: { source: "inspiration", referenceChannelId: referenceId, status: "APPLIED", ...(recId ? { id: recId } : {}) },
    select: { id: true },
  });
  if (applied.length === 0)
    return fail(recId ? "Cette proposition n'est plus appliquée : rechargez la page." : "Rien à annuler pour cette référence.", "conflict");
  const ids = applied.map((r) => r.id);
  if (opts.dryRun)
    return preview(
      recId ? "Annuler ce réglage : la valeur d'avant est remise." : `Annuler l'inspiration : ${ids.length} réglage${ids.length > 1 ? "s" : ""} remis comme avant.`,
    );
  let result = { ok: false, message: "" };
  try {
    const engine = await loadInspirationEngine();
    if (!engine.undoInspiration) return fail(NOT_YET, "unavailable");
    const target = recId ? ids : referenceId;
    result = engineResult(
      await engine.undoInspiration(buildAgentsDeps(), target, engineActor(actor)),
      recId ? "Réglage annulé : la valeur d'avant est remise." : "Inspiration annulée : les réglages d'avant sont remis.",
    );
    await audit({
      userId: actor.userId,
      action: "agents.inspiration_undo_requested",
      entityType: recId ? "Recommendation" : "ReferenceChannel",
      entityId: recId ?? referenceId,
      metadata: { referenceChannelId: referenceId, recommendationIds: ids, ok: result.ok, via: actor.via },
    });
  } catch (err) {
    return fail(`Annulation impossible pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  return result.ok ? ok(result.message) : fail(result.message, "conflict");
};

export const runRemoveReference: CoreRun = async (fd, actor, opts = {}) => {
  const referenceId = safeId(fd.get("referenceId"));
  if (!canManageInspiration(actor.role)) return forbidden("Retirer une référence est réservé aux administrateurs.");
  if (!referenceId) return fail("Référence inconnue.", "invalid", "referenceId");
  const ref = await prisma.referenceChannel.findFirst({
    where: { id: referenceId, removedAt: null },
    select: { id: true, username: true, title: true },
  });
  if (!ref) return fail("Cette référence a déjà été retirée.", "not_found");
  const name = referenceName(ref);
  if (opts.dryRun) return preview(`Retirer ${name}.`, { impact: "Ses posts lus et son profil de style sont effacés." });
  let result = { ok: false, message: "" };
  try {
    const engine = await loadInspirationEngine();
    if (!engine.removeReference) return fail(NOT_YET, "unavailable");
    result = engineResult(
      await engine.removeReference(buildAgentsDeps(), referenceId, engineActor(actor)),
      `${name} est retirée : ses posts lus et son profil de style sont effacés.`,
    );
    await audit({
      userId: actor.userId,
      action: "agents.inspiration_reference_removed",
      entityType: "ReferenceChannel",
      entityId: referenceId,
      metadata: { name, ok: result.ok, via: actor.via },
    });
  } catch (err) {
    return fail(`Retrait impossible pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  return result.ok ? ok(result.message) : fail(result.message, "conflict");
};

// ------------------------------------------------------------------------------------------- entrées de Kevin

/** Canal d'inspiration par @nom, lien ou titre ; `proposition` = identifiant d'une proposition (facultatif). */
export async function kevinReferenceForm(input: Record<string, unknown>): Promise<{ ok: true; fd: FormData } | { ok: false; result: Fail }> {
  const { resolveReference } = await import("./resolve");
  const r = await resolveReference(input.reference ?? input.canal ?? input.referenceId);
  if (!r.ok) return r;
  return { ok: true, fd: formOf({ referenceId: r.id, recommendationId: input.proposition ?? input.recommendationId }) };
}

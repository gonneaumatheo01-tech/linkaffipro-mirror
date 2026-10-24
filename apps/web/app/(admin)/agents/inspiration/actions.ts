"use server";

import { revalidatePath } from "next/cache";
import { audit, prisma } from "@linkaffipro/db";
import { buildAgentsDeps } from "@/lib/agents/deps";
import { INSPIRATION_PATH, canManageInspiration, engineResult, referenceHref, referenceName, safeId } from "@/lib/agents/inspiration";
import { loadInspirationEngine } from "@/lib/agents/inspiration-engine";
import { backTo, errorText, isRedirectError } from "@/lib/agents/redirect";
import { requireUser } from "@/lib/session";

/**
 * Actions de la page Agents → Inspiration (phase 27), réservées aux administrateurs :
 * - « Annuler » une proposition appliquée, ou toutes celles d'une référence : `undoInspiration` remet les réglages
 *   d'avant (dans les 30 jours) ;
 * - « Retirer » une référence : `removeReference` efface ses posts lus et son profil de style.
 * Chaque geste est noté dans le journal des actions (`AuditLog`). Les fonctions viennent du moteur de Kevin.
 */

const NOT_YET = "Pas encore disponible : réessayez après la prochaine mise à jour du site.";

export async function undoInspirationAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const referenceId = safeId(formData.get("referenceId"));
  const back = referenceId ? referenceHref(referenceId) : INSPIRATION_PATH;
  const hash = "#propositions";
  if (!canManageInspiration(user.role)) backTo(back, { error: "Annuler une inspiration est réservé aux administrateurs." }, hash);
  if (!referenceId) backTo(INSPIRATION_PATH, { error: "Référence inconnue." });
  const recId = formData.get("recommendationId") ? safeId(formData.get("recommendationId")) : null;
  if (formData.get("recommendationId") && !recId) backTo(back, { error: "Proposition inconnue." }, hash);

  const applied = await prisma.recommendation.findMany({
    where: {
      source: "inspiration",
      referenceChannelId: referenceId,
      status: "APPLIED",
      ...(recId ? { id: recId } : {}),
    },
    select: { id: true },
  });
  if (applied.length === 0)
    backTo(back, { error: recId ? "Cette proposition n'est plus appliquée : rechargez la page." : "Rien à annuler pour cette référence." }, hash);

  const ids = applied.map((r) => r.id);
  let result = { ok: false, message: "" };
  try {
    const engine = await loadInspirationEngine();
    if (!engine.undoInspiration) backTo(back, { error: NOT_YET }, hash);
    const target = recId ? ids : referenceId;
    result = engineResult(
      await engine.undoInspiration(buildAgentsDeps(), target, { userId: user.id, via: "SITE" }),
      recId ? "Réglage annulé : la valeur d'avant est remise." : "Inspiration annulée : les réglages d'avant sont remis.",
    );
    await audit({
      userId: user.id,
      action: "agents.inspiration_undo_requested",
      entityType: recId ? "Recommendation" : "ReferenceChannel",
      entityId: recId ?? referenceId,
      metadata: { referenceChannelId: referenceId, recommendationIds: ids, ok: result.ok },
    });
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(back, { error: `Annulation impossible pour l'instant : ${errorText(err)}.` }, hash);
  }
  revalidatePath(INSPIRATION_PATH);
  revalidatePath(back);
  revalidatePath("/agents/algo");
  if (!result.ok) backTo(back, { error: result.message }, hash);
  backTo(back, { ok: result.message }, hash);
}

export async function removeReferenceAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const referenceId = safeId(formData.get("referenceId"));
  const back = referenceId ? referenceHref(referenceId) : INSPIRATION_PATH;
  if (!canManageInspiration(user.role)) backTo(back, { error: "Retirer une référence est réservé aux administrateurs." });
  if (!referenceId) backTo(INSPIRATION_PATH, { error: "Référence inconnue." });
  const ref = await prisma.referenceChannel.findFirst({
    where: { id: referenceId, removedAt: null },
    select: { id: true, username: true, title: true },
  });
  if (!ref) backTo(INSPIRATION_PATH, { error: "Cette référence a déjà été retirée." });
  const name = referenceName(ref);
  let result = { ok: false, message: "" };
  try {
    const engine = await loadInspirationEngine();
    if (!engine.removeReference) backTo(back, { error: NOT_YET });
    result = engineResult(
      await engine.removeReference(buildAgentsDeps(), referenceId, { userId: user.id, via: "SITE" }),
      `${name} est retirée : ses posts lus et son profil de style sont effacés.`,
    );
    await audit({
      userId: user.id,
      action: "agents.inspiration_reference_removed",
      entityType: "ReferenceChannel",
      entityId: referenceId,
      metadata: { name, ok: result.ok },
    });
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(back, { error: `Retrait impossible pour l'instant : ${errorText(err)}.` });
  }
  revalidatePath(INSPIRATION_PATH);
  if (!result.ok) backTo(back, { error: result.message });
  backTo(INSPIRATION_PATH, { ok: result.message });
}

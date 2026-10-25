"use server";

import { revalidatePath } from "next/cache";
import { INSPIRATION_PATH, referenceHref, safeId } from "@/lib/agents/inspiration";
import { backTo } from "@/lib/agents/redirect";
import { runRemoveReference, runUndoInspiration } from "@/lib/site-ops/ops/lot-d/inspiration";
import { siteActor } from "@/lib/site-ops/ops/lot-d/kit";
import { requireUser } from "@/lib/session";

/**
 * Actions de la page Agents → Inspiration (phase 27), réservées aux administrateurs :
 * - « Annuler » une proposition appliquée, ou toutes celles d'une référence : `undoInspiration` remet les réglages
 *   d'avant (dans les 30 jours) ;
 * - « Retirer » une référence : `removeReference` efface ses posts lus et son profil de style.
 * Chaque geste est noté dans le journal des actions (`AuditLog`). Les fonctions viennent du moteur de Kevin.
 */

// Phase 34 : logique dans les cœurs uniques (`@/lib/site-ops/ops/lot-d/inspiration`), que Kevin appelle aussi.

export async function undoInspirationAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const referenceId = safeId(formData.get("referenceId"));
  const back = referenceId ? referenceHref(referenceId) : INSPIRATION_PATH;
  const hash = "#propositions";
  const r = await runUndoInspiration(formData, siteActor(user));
  if (!r.ok && r.field === "referenceId") backTo(INSPIRATION_PATH, { error: r.error });
  if (r.ok || r.code === "conflict") {
    revalidatePath(INSPIRATION_PATH);
    revalidatePath(back);
    revalidatePath("/agents/algo");
  }
  backTo(back, r.ok ? { ok: r.message } : { error: r.error }, hash);
}

export async function removeReferenceAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const referenceId = safeId(formData.get("referenceId"));
  const back = referenceId ? referenceHref(referenceId) : INSPIRATION_PATH;
  const r = await runRemoveReference(formData, siteActor(user));
  if (!r.ok && (r.field === "referenceId" || r.code === "not_found")) backTo(INSPIRATION_PATH, { error: r.error });
  if (r.ok || r.code === "conflict") revalidatePath(INSPIRATION_PATH);
  if (!r.ok) backTo(back, { error: r.error });
  backTo(INSPIRATION_PATH, { ok: r.message });
}

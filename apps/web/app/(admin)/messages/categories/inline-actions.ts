"use server";

import { requireUser } from "@/lib/session";
import { webActorOf } from "@/lib/site-ops/ops/lot-b/common";
import { categoryCreateInline } from "@/lib/site-ops/ops/lot-b/categories";

/**
 * Création d'une catégorie depuis le formulaire de message (phase 8), sans quitter la page : nom + couleur.
 * Même nom qu'une catégorie existante : on la réutilise (réactivation par un ADMIN seulement). La logique est dans le
 * cœur partagé avec Kevin : `categoryCreateInline` (`lib/site-ops/ops/lot-b/categories.ts`, phase 34).
 */
export async function createCategoryInlineAction(input: {
  name: string;
  color?: string;
}): Promise<{ ok: true; id: string; name: string; color: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const r = await categoryCreateInline({ name: input?.name, color: input?.color }, webActorOf(user));
  if (!r.ok) return { ok: false, error: r.error };
  const d = r.data as { id: string; name: string; color: string };
  return { ok: true, id: d.id, name: d.name, color: d.color };
}

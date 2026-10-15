"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { LandingFormErrors } from "@/lib/landing/form";
import { deleteLandingPage, retryLandingLinks, saveLandingPage } from "@/lib/landing/save";
import { requireUser } from "@/lib/session";

/**
 * Actions de la rubrique « Pages » (phase 15). Administrateurs et responsables : créer, modifier, « Réessayer » les
 * liens Telegram ; supprimer : administrateurs seulement. Toute la logique est dans `lib/landing/save.ts`.
 */

/** Retour de « Enregistrer » quand l'enregistrement est refusé (le formulaire garde la saisie). */
export type LandingSaveState = { error: string; errors?: LandingFormErrors } | null;

function withMessage(path: string, key: "ok" | "error", message: string): string {
  return `${path}?${new URLSearchParams({ [key]: message }).toString()}`;
}

/** « Créer la page » / « Enregistrer » (formulaire unique, avec `useActionState`). */
export async function saveLandingPageAction(
  _prev: LandingSaveState,
  formData: FormData,
): Promise<LandingSaveState> {
  const user = await requireUser();
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("payload") ?? "null"));
  } catch {
    return { error: "Le formulaire n'a pas pu être lu : rechargez la page, puis recommencez." };
  }
  const r = await saveLandingPage(raw, user.id);
  if (!r.ok) return { error: r.error, errors: r.errors };
  revalidatePath("/pages");
  revalidatePath(`/pages/${r.pageId}`);
  redirect(withMessage(`/pages/${r.pageId}`, "ok", r.message));
}

/** « Réessayer » sur une source dont le lien Telegram n'a pas pu être créé. */
export async function retryLandingLinksAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const pageId = String(formData.get("pageId") ?? "");
  if (!pageId) redirect("/pages");
  const r = await retryLandingLinks(pageId, user.id);
  revalidatePath(`/pages/${pageId}`);
  redirect(withMessage(`/pages/${pageId}`, r.ok ? "ok" : "error", r.message));
}

/** « Supprimer la page » (administrateurs, après confirmation). */
export async function deleteLandingPageAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const pageId = String(formData.get("pageId") ?? "");
  if (user.role !== "ADMIN")
    redirect(
      withMessage(
        pageId ? `/pages/${pageId}` : "/pages",
        "error",
        "Seul un administrateur peut supprimer une page. Vous pouvez la mettre en pause (Avancé → Page en ligne).",
      ),
    );
  const r = await deleteLandingPage(pageId, user.id);
  revalidatePath("/pages");
  redirect(withMessage("/pages", r.ok ? "ok" : "error", r.message));
}

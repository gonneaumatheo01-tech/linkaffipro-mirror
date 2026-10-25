"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { LandingFormErrors } from "@/lib/landing/form";
import { requireUser } from "@/lib/session";
import { webActorOf } from "@/lib/site-ops/ops/lot-b/common";
import { pageDelete, pageRetryLinks, savePageDetailed } from "@/lib/site-ops/ops/lot-b/pages";

/**
 * Actions de la rubrique « Pages » (phase 15). Administrateurs et responsables : créer, modifier, « Réessayer » les
 * liens Telegram ; supprimer : administrateurs seulement. Toute la logique est dans `lib/landing/save.ts`, appelée par
 * les cœurs partagés avec Kevin (`lib/site-ops/ops/lot-b/pages.ts`, phase 34).
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
  const { result: r, errors } = await savePageDetailed({ payload: raw }, webActorOf(user));
  if (!r.ok) return { error: r.error, errors };
  const pageId = String(r.data?.pageId ?? "");
  revalidatePath("/pages");
  revalidatePath(`/pages/${pageId}`);
  redirect(withMessage(`/pages/${pageId}`, "ok", r.message));
}

/** « Réessayer » sur une source dont le lien Telegram n'a pas pu être créé. */
export async function retryLandingLinksAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const pageId = String(formData.get("pageId") ?? "");
  if (!pageId) redirect("/pages");
  const r = await pageRetryLinks({ pageId }, webActorOf(user));
  revalidatePath(`/pages/${pageId}`);
  redirect(withMessage(`/pages/${pageId}`, r.ok ? "ok" : "error", r.ok ? r.message : r.error));
}

/** « Supprimer la page » (administrateurs, après confirmation). */
export async function deleteLandingPageAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const pageId = String(formData.get("pageId") ?? "");
  const r = await pageDelete({ pageId }, webActorOf(user));
  if (!r.ok && r.code === "forbidden")
    redirect(withMessage(pageId ? `/pages/${pageId}` : "/pages", "error", r.error));
  revalidatePath("/pages");
  redirect(withMessage("/pages", r.ok ? "ok" : "error", r.ok ? r.message : r.error));
}

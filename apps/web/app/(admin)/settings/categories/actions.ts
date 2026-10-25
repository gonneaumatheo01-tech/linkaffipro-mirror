"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/session";
import { webActorOf } from "@/lib/site-ops/ops/lot-b/common";
import { categoryCreate, categoryDelete, categoryUpdate } from "@/lib/site-ops/ops/lot-b/categories";

/**
 * Réglages → Catégories (administrateurs). La logique (validations, fusion, journal) est dans le cœur partagé avec
 * Kevin : `lib/site-ops/ops/lot-b/categories.ts` (phase 34).
 */

function back(params: Record<string, string>): never {
  redirect(`/settings/categories?${new URLSearchParams(params).toString()}`);
}

export async function createCategoryAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await categoryCreate(
    {
      name: formData.get("name"),
      color: String(formData.get("color") ?? "#64748b"),
      vertical: String(formData.get("vertical") ?? ""),
    },
    webActorOf(admin),
  );
  if (!r.ok) back({ error: r.error });
  revalidatePath("/settings/categories");
  back({ ok: r.message });
}

export async function updateCategoryAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("id"));
  const r = await categoryUpdate(
    {
      id,
      name: formData.get("name"),
      color: String(formData.get("color") ?? ""),
      sortOrder: formData.get("sortOrder"),
      vertical: String(formData.get("vertical") ?? ""),
      isActive: formData.get("isActive") === "on",
    },
    webActorOf(admin),
  );
  // Catégorie disparue entre-temps : même erreur qu'avant (écriture refusée par la base).
  if (!r.ok && r.code === "not_found") throw new Error(r.error);
  if (!r.ok) back({ error: r.error });
  revalidatePath("/settings/categories");
  back({ ok: r.message });
}

/**
 * Suppression (ADMIN), avec fusion facultative dans une catégorie de remplacement (voir le cœur `categoryDelete`).
 */
export async function deleteCategoryAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("id"));
  const r = await categoryDelete(
    { id, replacementId: String(formData.get("replacementId") ?? "") },
    webActorOf(admin),
  );
  if (!r.ok) back({ error: r.error });
  revalidatePath("/settings/categories");
  back({ ok: r.message });
}

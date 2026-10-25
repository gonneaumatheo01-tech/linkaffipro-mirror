"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/session";
import { webActorOf } from "@/lib/site-ops/ops/lot-b/common";
import { tagCreate, tagDelete, tagUpdate } from "@/lib/site-ops/ops/lot-b/tags";

/**
 * Réglages → Étiquettes. La logique (validations, propagation aux membres, journal) est dans le cœur partagé avec
 * Kevin : `lib/site-ops/ops/lot-b/tags.ts` (phase 34).
 */

function back(params: Record<string, string>): never {
  redirect(`/settings/tags?${new URLSearchParams(params).toString()}`);
}

function revalidate(): void {
  revalidatePath("/settings/tags");
  revalidatePath("/members");
  revalidatePath("/members/broadcasts/new");
}

export async function createTagAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await tagCreate(
    { name: formData.get("name"), color: String(formData.get("color") ?? "gray") },
    webActorOf(admin),
  );
  if (!r.ok) back({ error: r.error });
  revalidate();
  back({ ok: r.message });
}

/**
 * Renommer ou recolorer. Le renommage est propagé à tous les membres qui portent l'étiquette
 * (lecture des membres concernés, remplacement dans `Member.tags`, dans une transaction).
 */
export async function updateTagAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const oldName = z.string().min(1).parse(formData.get("oldName"));
  const r = await tagUpdate(
    { oldName, name: formData.get("name"), color: String(formData.get("color") ?? "gray") },
    webActorOf(admin),
  );
  if (!r.ok) back({ error: r.error });
  revalidate();
  back({ ok: r.message });
}

/** Supprimer : l'étiquette est retirée de tous les membres qui la portent. */
export async function deleteTagAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const name = z.string().min(1).parse(formData.get("name"));
  const r = await tagDelete({ name }, webActorOf(admin));
  if (!r.ok) back({ error: r.error });
  revalidate();
  back({ ok: r.message });
}

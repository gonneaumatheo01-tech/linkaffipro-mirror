"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isVertical } from "@linkaffipro/core";
import { prisma, audit } from "@linkaffipro/db";
import { requireAdmin } from "@/lib/session";
import { slugify, uniqueSlug } from "@/lib/posts/category-stats";

function back(params: Record<string, string>): never {
  redirect(`/settings/categories?${new URLSearchParams(params).toString()}`);
}

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const nameSchema = z.string().trim().min(2).max(40);

export async function createCategoryAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const name = nameSchema.safeParse(formData.get("name"));
  const color = colorSchema.safeParse(String(formData.get("color") ?? "#64748b"));
  const verticalRaw = String(formData.get("vertical") ?? "");
  if (!name.success) back({ error: "Le nom doit faire entre 2 et 40 caractères." });
  if (!color.success)
    back({ error: "La couleur n'est pas valide : choisissez-la avec le sélecteur." });
  const vertical = isVertical(verticalRaw) ? verticalRaw : null;
  const taken = new Set(
    (await prisma.messageCategory.findMany({ select: { slug: true } })).map((c) => c.slug),
  );
  const slug = uniqueSlug(slugify(name.data), taken);
  const max = await prisma.messageCategory.aggregate({ _max: { sortOrder: true } });
  const cat = await prisma.messageCategory.create({
    data: {
      name: name.data,
      slug,
      color: color.data,
      vertical,
      sortOrder: (max._max.sortOrder ?? -1) + 1,
    },
  });
  await audit({
    userId: admin.id,
    action: "category.created",
    entityType: "MessageCategory",
    entityId: cat.id,
    metadata: { name: cat.name, slug },
  });
  revalidatePath("/settings/categories");
  back({ ok: `Catégorie « ${cat.name} » créée.` });
}

export async function updateCategoryAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("id"));
  const name = nameSchema.safeParse(formData.get("name"));
  const color = colorSchema.safeParse(String(formData.get("color") ?? ""));
  const sortOrder = z.coerce.number().int().min(0).max(999).safeParse(formData.get("sortOrder"));
  const verticalRaw = String(formData.get("vertical") ?? "");
  if (!name.success) back({ error: "Le nom doit faire entre 2 et 40 caractères." });
  if (!color.success)
    back({ error: "La couleur n'est pas valide : choisissez-la avec le sélecteur." });
  if (!sortOrder.success) back({ error: "L'ordre doit être un nombre entre 0 et 999." });
  const cat = await prisma.messageCategory.update({
    where: { id },
    data: {
      name: name.data,
      color: color.data,
      sortOrder: sortOrder.data,
      vertical: isVertical(verticalRaw) ? verticalRaw : null,
      isActive: formData.get("isActive") === "on",
    },
  });
  await audit({
    userId: admin.id,
    action: "category.updated",
    entityType: "MessageCategory",
    entityId: id,
    metadata: { name: cat.name, isActive: cat.isActive, sortOrder: cat.sortOrder },
  });
  revalidatePath("/settings/categories");
  back({ ok: `Catégorie « ${cat.name} » enregistrée.` });
}

/** Suppression (ADMIN) : refusée si des messages utilisent la catégorie ; désactivez-la à la place. */
export async function deleteCategoryAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("id"));
  const used = await prisma.post.count({ where: { categoryId: id } });
  if (used > 0)
    back({
      error: `Impossible de supprimer : ${used} message${used > 1 ? "s utilisent" : " utilise"} cette catégorie. Désactivez-la plutôt.`,
    });
  const cat = await prisma.messageCategory.delete({ where: { id } });
  await audit({
    userId: admin.id,
    action: "category.deleted",
    entityType: "MessageCategory",
    entityId: id,
    metadata: { name: cat.name },
  });
  revalidatePath("/settings/categories");
  back({ ok: `Catégorie « ${cat.name} » supprimée.` });
}

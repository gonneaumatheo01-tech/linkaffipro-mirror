"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isVertical } from "@linkaffipro/core";
import { prisma, audit, toJsonValue } from "@linkaffipro/db";
import { requireAdmin } from "@/lib/session";
import { slugify, uniqueSlug } from "@/lib/posts/category-stats";
import { remapBroadcastSegment, remapRuleConditions } from "./remap";

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

/**
 * Suppression (ADMIN), avec fusion facultative dans une catégorie de remplacement. En une seule transaction :
 * les messages passent dans la catégorie choisie (ou sans catégorie), les automatisations et les envois groupés
 * pas encore partis (brouillon, programmé) qui la citent sont mis à jour, puis la catégorie est supprimée.
 * Sans remplacement, une automatisation qui ne visait que cette catégorie est désactivée et un envoi programmé
 * qui ne visait qu'elle repasse en brouillon : leur cible deviendrait sinon « toutes les catégories ».
 * Un brouillon ou une automatisation déjà en pause qui ne visait qu'elle perd son filtre : il est cité dans le
 * message de retour (et dans le journal) pour que la cible soit vérifiée avant un envoi ou une réactivation.
 */
export async function deleteCategoryAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("id"));
  const replacement = String(formData.get("replacementId") ?? "") || null;
  if (replacement === id) back({ error: "La catégorie de remplacement doit être différente." });
  const cat = await prisma.messageCategory.findUnique({ where: { id } });
  if (!cat) back({ error: "Catégorie introuvable : elle a peut-être déjà été supprimée." });
  if (replacement) {
    const target = await prisma.messageCategory.findUnique({ where: { id: replacement } });
    if (!target) back({ error: "Catégorie de remplacement introuvable." });
  }

  const result = await prisma.$transaction(async (tx) => {
    const moved = await tx.post.updateMany({
      where: { categoryId: id },
      data: { categoryId: replacement },
    });
    const rulesChanged: string[] = [];
    const rulesDeactivated: string[] = [];
    const rulesFilterRemoved: string[] = [];
    for (const r of await tx.automationRule.findMany({
      select: { id: true, name: true, isActive: true, conditions: true },
    })) {
      const m = remapRuleConditions(r.conditions, id, replacement);
      if (!m.changed) continue;
      const deactivate = m.deactivate && r.isActive;
      await tx.automationRule.update({
        where: { id: r.id },
        data: { conditions: toJsonValue(m.conditions), ...(deactivate ? { isActive: false } : {}) },
      });
      rulesChanged.push(r.id);
      if (deactivate) rulesDeactivated.push(r.name);
      else if (m.deactivate) rulesFilterRemoved.push(r.name);
    }
    const broadcastsChanged: string[] = [];
    const broadcastsToDraft: string[] = [];
    const broadcastsFilterRemoved: string[] = [];
    for (const b of await tx.broadcast.findMany({
      where: { status: { in: ["DRAFT", "SCHEDULED"] } },
      select: { id: true, name: true, status: true, segment: true },
    })) {
      const m = remapBroadcastSegment(b.segment, id, replacement);
      if (!m.changed) continue;
      const toDraft = m.backToDraft && b.status === "SCHEDULED";
      await tx.broadcast.update({
        where: { id: b.id },
        data: { segment: toJsonValue(m.segment), ...(toDraft ? { status: "DRAFT" as const } : {}) },
      });
      broadcastsChanged.push(b.id);
      if (toDraft) broadcastsToDraft.push(b.name);
      else if (m.backToDraft) broadcastsFilterRemoved.push(b.name);
    }
    await tx.messageCategory.delete({ where: { id } });
    return {
      moved: moved.count,
      rulesChanged,
      rulesDeactivated,
      rulesFilterRemoved,
      broadcastsChanged,
      broadcastsToDraft,
      broadcastsFilterRemoved,
    };
  });

  if (result.moved > 0 || result.rulesChanged.length > 0 || result.broadcastsChanged.length > 0)
    await audit({
      userId: admin.id,
      action: "category.merged",
      entityType: "MessageCategory",
      entityId: id,
      metadata: {
        name: cat.name,
        into: replacement,
        posts: result.moved,
        rules: result.rulesChanged,
        rulesDeactivated: result.rulesDeactivated,
        rulesFilterRemoved: result.rulesFilterRemoved,
        broadcasts: result.broadcastsChanged,
        broadcastsBackToDraft: result.broadcastsToDraft,
        broadcastsFilterRemoved: result.broadcastsFilterRemoved,
      },
    });
  await audit({
    userId: admin.id,
    action: "category.deleted",
    entityType: "MessageCategory",
    entityId: id,
    metadata: { name: cat.name },
  });
  revalidatePath("/settings/categories");
  const names = (list: string[]) => list.map((n) => `« ${n} »`).join(", ");
  const notes = [
    result.rulesDeactivated.length
      ? `Relance automatique désactivée (elle ne visait que cette catégorie) : ${names(result.rulesDeactivated)}.`
      : "",
    result.broadcastsToDraft.length
      ? `Message à un groupe repassé en brouillon (il ne visait que cette catégorie) : ${names(result.broadcastsToDraft)}.`
      : "",
    result.rulesFilterRemoved.length
      ? `Filtre de catégorie retiré, vérifiez la cible avant de réactiver la relance automatique : ${names(result.rulesFilterRemoved)}.`
      : "",
    result.broadcastsFilterRemoved.length
      ? `Filtre de catégorie retiré, vérifiez la cible avant d'envoyer : ${names(result.broadcastsFilterRemoved)}.`
      : "",
  ].filter(Boolean);
  back({ ok: [`Catégorie « ${cat.name} » supprimée.`, ...notes].join(" ") });
}

"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, audit, type Prisma } from "@linkaffipro/db";
import { requireAdmin } from "@/lib/session";
import {
  getTagRegistry,
  isTagColor,
  memberTags,
  normalizeTagName,
  saveTagRegistry,
  TAG_NAME_MAX,
} from "@/lib/members/tags";

function back(params: Record<string, string>): never {
  redirect(`/settings/tags?${new URLSearchParams(params).toString()}`);
}

const NAME_ERROR = `Le nom doit faire entre 1 et ${TAG_NAME_MAX} caractères (lettres, chiffres, espaces, tirets).`;

function revalidate(): void {
  revalidatePath("/settings/tags");
  revalidatePath("/members");
  revalidatePath("/broadcasts/new");
}

export async function createTagAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const name = normalizeTagName(formData.get("name"));
  const color = String(formData.get("color") ?? "gray");
  if (!name) back({ error: NAME_ERROR });
  if (!isTagColor(color)) back({ error: "Choisissez une couleur dans la liste." });
  const registry = await getTagRegistry();
  if (registry.some((t) => t.name.toLowerCase() === name.toLowerCase()))
    back({ error: `L'étiquette « ${name} » existe déjà.` });
  await saveTagRegistry([...registry, { name, color }]);
  await audit({
    userId: admin.id,
    action: "tag.created",
    entityType: "Setting",
    entityId: "members.tags",
    metadata: { name, color },
  });
  revalidate();
  back({ ok: `Étiquette « ${name} » créée.` });
}

/**
 * Renommer ou recolorer. Le renommage est propagé à tous les membres qui portent l'étiquette
 * (lecture des membres concernés, remplacement dans `Member.tags`, dans une transaction).
 */
export async function updateTagAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const oldName = z.string().min(1).parse(formData.get("oldName"));
  const name = normalizeTagName(formData.get("name"));
  const color = String(formData.get("color") ?? "gray");
  if (!name) back({ error: NAME_ERROR });
  if (!isTagColor(color)) back({ error: "Choisissez une couleur dans la liste." });
  const registry = await getTagRegistry();
  const idx = registry.findIndex((t) => t.name === oldName);
  if (idx < 0) back({ error: "Cette étiquette n'existe plus." });
  if (
    name !== oldName &&
    registry.some((t, i) => i !== idx && t.name.toLowerCase() === name.toLowerCase())
  )
    back({ error: `L'étiquette « ${name} » existe déjà.` });
  const next = registry.map((t, i) => (i === idx ? { name, color } : t));
  let propagated = 0;
  if (name !== oldName) {
    const members = await prisma.member.findMany({
      where: { tags: { array_contains: [oldName] } },
      select: { id: true, tags: true },
    });
    const updates = members.map((m) =>
      prisma.member.update({
        where: { id: m.id },
        data: {
          tags: [
            ...new Set(memberTags(m.tags).map((t) => (t === oldName ? name : t))),
          ] as Prisma.InputJsonValue,
        },
      }),
    );
    await prisma.$transaction(updates);
    propagated = members.length;
  }
  await saveTagRegistry(next);
  await audit({
    userId: admin.id,
    action: "tag.updated",
    entityType: "Setting",
    entityId: "members.tags",
    metadata: { from: oldName, name, color, propagated },
  });
  revalidate();
  back({
    ok:
      name !== oldName
        ? `Étiquette renommée en « ${name} » (${propagated} membre${propagated > 1 ? "s" : ""} mis à jour).`
        : `Étiquette « ${name} » enregistrée.`,
  });
}

/** Supprimer : l'étiquette est retirée de tous les membres qui la portent. */
export async function deleteTagAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const name = z.string().min(1).parse(formData.get("name"));
  const registry = await getTagRegistry();
  if (!registry.some((t) => t.name === name)) back({ error: "Cette étiquette n'existe plus." });
  const members = await prisma.member.findMany({
    where: { tags: { array_contains: [name] } },
    select: { id: true, tags: true },
  });
  await prisma.$transaction(
    members.map((m) =>
      prisma.member.update({
        where: { id: m.id },
        data: { tags: memberTags(m.tags).filter((t) => t !== name) as Prisma.InputJsonValue },
      }),
    ),
  );
  await saveTagRegistry(registry.filter((t) => t.name !== name));
  await audit({
    userId: admin.id,
    action: "tag.deleted",
    entityType: "Setting",
    entityId: "members.tags",
    metadata: { name, removedFrom: members.length },
  });
  revalidate();
  back({
    ok: `Étiquette « ${name} » supprimée et retirée de ${members.length} membre${members.length > 1 ? "s" : ""}.`,
  });
}

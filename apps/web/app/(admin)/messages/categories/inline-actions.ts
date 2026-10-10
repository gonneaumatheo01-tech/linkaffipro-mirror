"use server";

import { z } from "zod";
import { prisma, audit } from "@linkaffipro/db";
import { requireUser } from "@/lib/session";

/** Couleurs proposées par défaut (même palette que le sélecteur du formulaire de message). */
const COLORS = [
  "#16a34a",
  "#ca8a04",
  "#9333ea",
  "#2563eb",
  "#64748b",
  "#dc2626",
  "#0891b2",
  "#db2777",
];

/**
 * Création d'une catégorie depuis le formulaire de message (phase 8), sans quitter la page : nom + couleur.
 * Même nom (ou même identifiant court) qu'une catégorie existante : on la réutilise. Si elle est désactivée, seul un
 * ADMIN la réactive ici (comme dans Réglages → Catégories, réservé à l'ADMIN) ; un MANAGER reçoit un message d'aide.
 * Position : après la dernière (max + 1), comme dans Réglages → Catégories.
 */
export async function createCategoryInlineAction(input: {
  name: string;
  color?: string;
}): Promise<{ ok: true; id: string; name: string; color: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(40),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
    })
    .safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: "Donnez un nom (40 caractères maximum) et choisissez une couleur valide.",
    };
  const name = parsed.data.name;
  const slugBase =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "categorie";
  const existing = await prisma.messageCategory.findFirst({
    where: { OR: [{ slug: slugBase }, { name: { equals: name, mode: "insensitive" } }] },
    select: { id: true, name: true, color: true, isActive: true },
  });
  if (existing) {
    if (!existing.isActive) {
      if (user.role !== "ADMIN")
        return {
          ok: false,
          error: `La catégorie « ${existing.name} » existe mais est désactivée : un administrateur peut la réactiver dans Réglages → Catégories.`,
        };
      await prisma.messageCategory.update({ where: { id: existing.id }, data: { isActive: true } });
      await audit({
        userId: user.id,
        action: "category.updated",
        entityType: "MessageCategory",
        entityId: existing.id,
        metadata: { name: existing.name, isActive: true, inline: true },
      });
    } else {
      // Trace de réutilisation : la catégorie appartient désormais au client (garde-fou de `pnpm db:phase8`).
      await audit({
        userId: user.id,
        action: "category.updated",
        entityType: "MessageCategory",
        entityId: existing.id,
        metadata: { name: existing.name, reused: true, inline: true },
      });
    }
    return { ok: true, id: existing.id, name: existing.name, color: existing.color };
  }
  const [count, max] = await Promise.all([
    prisma.messageCategory.count(),
    prisma.messageCategory.aggregate({ _max: { sortOrder: true } }),
  ]);
  const color = parsed.data.color ?? COLORS[count % COLORS.length]!;
  const cat = await prisma.messageCategory.create({
    data: { name, slug: slugBase, color, sortOrder: (max._max.sortOrder ?? -1) + 1 },
    select: { id: true, name: true, color: true },
  });
  await audit({
    userId: user.id,
    action: "category.created",
    entityType: "MessageCategory",
    entityId: cat.id,
    metadata: { name, color, inline: true },
  });
  return { ok: true, ...cat };
}

"use server";

import { z } from "zod";
import { prisma, audit } from "@linkaffipro/db";
import { requireUser } from "@/lib/session";

const COLORS = ["#16a34a", "#ca8a04", "#9333ea", "#2563eb", "#64748b", "#dc2626", "#0891b2", "#db2777"];

/** Création d'une catégorie depuis le formulaire de message (phase 8), sans quitter la page. */
export async function createCategoryInlineAction(input: { name: string; color?: string }): Promise<{ ok: true; id: string; name: string; color: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const parsed = z.object({ name: z.string().trim().min(1).max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Donnez un nom (40 caractères maximum)." };
  const name = parsed.data.name;
  const slugBase = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "categorie";
  const existing = await prisma.messageCategory.findFirst({ where: { OR: [{ slug: slugBase }, { name: { equals: name, mode: "insensitive" } }] }, select: { id: true, name: true, color: true } });
  if (existing) return { ok: true, id: existing.id, name: existing.name, color: existing.color };
  const count = await prisma.messageCategory.count();
  const color = parsed.data.color ?? COLORS[count % COLORS.length]!;
  const cat = await prisma.messageCategory.create({ data: { name, slug: slugBase, color, sortOrder: count }, select: { id: true, name: true, color: true } });
  await audit({ userId: user.id, action: "category.created", entityType: "MessageCategory", entityId: cat.id, metadata: { name, inline: true } });
  return { ok: true, ...cat };
}

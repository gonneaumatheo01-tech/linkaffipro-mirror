/**
 * Modèles de messages casino (`Post.isTemplate`, univers CASINO) : inspiration de la Rédaction, jamais recopiés (le
 * Contrôle qualité compare le texte aux modèles comme aux derniers posts du canal).
 */
import type { Db as PrismaClient } from "@linkaffipro/db";
import { stripHtml } from "@linkaffipro/core";

export const TEMPLATE_INSPIRATIONS = 3;
const TEMPLATE_POOL = 60;

export async function casinoTemplateTexts(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.post.findMany({
    where: { isTemplate: true, vertical: "CASINO" },
    orderBy: { createdAt: "asc" },
    take: TEMPLATE_POOL,
    select: { text: true },
  });
  return rows.map((r) => r.text).filter((t): t is string => typeof t === "string" && stripHtml(t).trim() !== "");
}

/** Quelques modèles pour une mission (pur) : tirage stable par mission, pour varier d'un post à l'autre. */
export function inspirationsFor(templates: readonly string[], seed: string, n = TEMPLATE_INSPIRATIONS): string[] {
  if (templates.length <= n) return [...templates];
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const start = h % templates.length;
  return Array.from({ length: n }, (_, i) => templates[(start + i * 7) % templates.length]!).filter((t, i, a) => a.indexOf(t) === i);
}

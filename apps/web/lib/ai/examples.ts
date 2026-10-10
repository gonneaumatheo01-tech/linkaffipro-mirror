/**
 * « Ce qui marche chez vous » : jusqu'à 3 messages envoyés de l'équipe, même univers et même catégorie,
 * les mieux classés par FTD puis taux de clic (au moins 1 clic). Texte seulement : jamais de donnée personnelle
 * (les messages de canal ne contiennent pas de nom de membre ; les repères {prenom} restent des repères).
 */
import { prisma } from "@linkaffipro/db";
import type { AiExample, AiVertical } from "@linkaffipro/ai";

export async function loadBestExamples(input: { vertical?: AiVertical | null; categoryId?: string | null; excludeText?: string | null }, take = 3): Promise<AiExample[]> {
  if (!input.vertical) return [];
  const posts = await prisma.post.findMany({
    where: {
      status: "SENT",
      isTemplate: false,
      text: { not: "" },
      NOT: { templateName: { startsWith: "broadcast:" } },
      OR: [{ vertical: input.vertical }, { channel: { vertical: input.vertical } }, { bot: { vertical: input.vertical } }],
      ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      stats: { is: { clicks: { gte: 1 } } },
    },
    orderBy: [{ stats: { ftds: "desc" } }, { stats: { clicks: "desc" } }, { sentAt: "desc" }],
    take: 12,
    select: { text: true, stats: { select: { views: true, clicks: true, ftds: true, registrations: true } } },
  });
  const out: AiExample[] = [];
  const seen = new Set<string>();
  for (const p of posts) {
    const text = p.text.trim();
    if (!text || seen.has(text) || (input.excludeText && text === input.excludeText.trim())) continue;
    seen.add(text);
    const s = p.stats;
    const parts: string[] = [];
    if (s) {
      if (s.views > 0) parts.push(`${(Math.round((s.clicks / s.views) * 1000) / 10).toString().replace(".", ",")} % de clics`);
      else parts.push(`${s.clicks} clic${s.clicks > 1 ? "s" : ""}`);
      if (s.ftds > 0) parts.push(`${s.ftds} premier${s.ftds > 1 ? "s" : ""} dépôt${s.ftds > 1 ? "s" : ""}`);
      else if (s.registrations > 0) parts.push(`${s.registrations} inscription${s.registrations > 1 ? "s" : ""}`);
    }
    out.push({ text: text.slice(0, 1500), note: parts.join(", ") || undefined });
    if (out.length >= take) break;
  }
  return out;
}

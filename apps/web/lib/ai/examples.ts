/**
 * « Ce qui marche chez vous » : jusqu'à 3 messages envoyés de l'équipe pour le même univers (et la même catégorie
 * en priorité), seulement s'il y a assez de données (au moins 5 clics, ou au moins 100 vues et un clic).
 * Tri par taux de clic (cliqueurs uniques / vues ; sans vues connues : clics du message), puis premiers dépôts.
 * Si la catégorie manque de données, on complète avec l'univers sans catégorie.
 * Texte seulement : jamais de donnée personnelle (les messages de canal ne contiennent pas de nom de membre ;
 * les repères {prenom} restent des repères).
 */
import { prisma, type Prisma } from "@linkaffipro/db";
import type { AiExample, AiVertical } from "@linkaffipro/ai";

export const MIN_EXAMPLE_CLICKS = 5;
export const MIN_EXAMPLE_VIEWS = 100;

export type ExampleStats = {
  views: number;
  clicks: number;
  uniqueClickers: number;
  ftds: number;
  registrations: number;
};
export type ExampleCandidate = { text: string; stats: ExampleStats | null };

/** Assez de données pour servir d'exemple : au moins 5 clics, ou au moins 100 vues avec au moins un clic. */
export function hasEnoughData(s: ExampleStats | null): boolean {
  if (!s) return false;
  return s.clicks >= MIN_EXAMPLE_CLICKS || (s.views >= MIN_EXAMPLE_VIEWS && s.clicks >= 1);
}

/** Taux de clic (cliqueurs uniques / vues ; repli sur les clics si les cliqueurs uniques manquent), ou null sans vues. */
function clickRate(s: ExampleStats): number | null {
  if (s.views <= 0) return null;
  const clickers = s.uniqueClickers > 0 ? s.uniqueClickers : s.clicks;
  return clickers / s.views;
}

/** Tri : messages avec vues par taux décroissant, puis messages sans vues par clics ; à égalité, plus de FTD d'abord. */
export function rankExamples<T extends ExampleCandidate>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const sa = a.stats!;
    const sb = b.stats!;
    const ra = clickRate(sa);
    const rb = clickRate(sb);
    if (ra !== null && rb === null) return -1;
    if (ra === null && rb !== null) return 1;
    const primary = ra !== null && rb !== null ? rb - ra : sb.clicks - sa.clicks;
    if (Math.abs(primary) > 1e-9) return primary;
    return sb.ftds - sa.ftds;
  });
}

function noteFor(s: ExampleStats): string | undefined {
  const parts: string[] = [];
  const rate = clickRate(s);
  if (rate !== null)
    parts.push(`${(Math.round(rate * 1000) / 10).toString().replace(".", ",")} % de clics`);
  else parts.push(`${s.clicks} clic${s.clicks > 1 ? "s" : ""}`);
  if (s.ftds > 0)
    parts.push(`${s.ftds} premier${s.ftds > 1 ? "s" : ""} dépôt${s.ftds > 1 ? "s" : ""}`);
  else if (s.registrations > 0)
    parts.push(`${s.registrations} inscription${s.registrations > 1 ? "s" : ""}`);
  return parts.join(", ") || undefined;
}

async function candidates(
  vertical: AiVertical,
  categoryId: string | null,
): Promise<ExampleCandidate[]> {
  const where: Prisma.PostWhereInput = {
    status: "SENT",
    isTemplate: false,
    text: { not: "" },
    AND: [
      { OR: [{ vertical }, { channel: { vertical } }, { bot: { vertical } }] },
      // Conteneurs d'envois groupés exclus. `NOT startsWith` seul écarterait aussi les templateName NULL
      // (NOT (NULL LIKE …) vaut NULL en SQL), c'est-à-dire tous les messages de canal normaux.
      { OR: [{ templateName: null }, { NOT: { templateName: { startsWith: "broadcast:" } } }] },
    ],
    ...(categoryId ? { categoryId } : {}),
    stats: {
      is: {
        OR: [
          { clicks: { gte: MIN_EXAMPLE_CLICKS } },
          { views: { gte: MIN_EXAMPLE_VIEWS }, clicks: { gte: 1 } },
        ],
      },
    },
  };
  const rows = await prisma.post.findMany({
    where,
    orderBy: [{ stats: { clicks: "desc" } }, { sentAt: "desc" }],
    take: 60,
    select: {
      text: true,
      stats: {
        select: {
          views: true,
          clicks: true,
          uniqueClickers: true,
          ftds: true,
          registrations: true,
        },
      },
    },
  });
  return rows.filter((r) => hasEnoughData(r.stats));
}

export async function loadBestExamples(
  input: { vertical?: AiVertical | null; categoryId?: string | null; excludeText?: string | null },
  take = 3,
): Promise<AiExample[]> {
  if (!input.vertical) return [];
  const out: AiExample[] = [];
  const seen = new Set<string>();
  const exclude = input.excludeText?.trim() ?? null;
  const push = (rows: ExampleCandidate[]) => {
    for (const p of rankExamples(rows)) {
      if (out.length >= take) return;
      const text = p.text.trim();
      if (!text || seen.has(text) || text === exclude) continue;
      seen.add(text);
      out.push({ text: text.slice(0, 1500), note: p.stats ? noteFor(p.stats) : undefined });
    }
  };
  if (input.categoryId) push(await candidates(input.vertical, input.categoryId));
  // Repli : même univers, toutes catégories (catégorie neuve ou pas encore assez de données).
  if (out.length < take) push(await candidates(input.vertical, null));
  return out;
}

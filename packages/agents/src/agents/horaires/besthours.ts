/**
 * Meilleurs horaires de publication par canal et par catégorie (Europe/Paris) : format historique de `Setting`
 * `besthours.<channelId>`, lu par le site (`apps/web/lib/besthours/types.ts`, onglet de la fiche canal) et par
 * Planification. Repris tel quel du worker (phase 6) : depuis la phase 21, l'agent Horaires en est la seule source ;
 * il ajoute `source: "algo"` et ses fenêtres (`windows`), champs ignorés par l'ancienne lecture. Fonctions pures.
 */
import { parisParts, parisWeekday } from "../../rules/time";

export const BEST_HOURS_WEEKS = 8;
/** Messages minimum dans un créneau pour le recommander. */
export const BEST_HOURS_MIN_POSTS = 3;
/** Clé « toutes catégories ». */
export const ALL_CATEGORIES = "all";

export type BestHoursPost = {
  channelId: string;
  categoryId: string | null;
  sentAt: Date;
  views: number;
  clicks: number;
  uniqueClickers: number;
  reactionsTotal: number;
};

/** Une case jour × heure. `day` : 1 = lundi … 7 = dimanche ; `hour` : 0–23, heure de Paris. */
export type BestHoursCell = {
  day: number;
  hour: number;
  posts: number;
  views: number;
  clicks: number;
  uniqueClickers: number;
  reactions: number;
  /** Cliqueurs uniques / vues (null si aucune vue dans la case). */
  ctr: number | null;
  clicksPerPost: number;
  reactionsPerPost: number;
};

export type BestHoursRecommendation = {
  day: number;
  hour: number;
  posts: number;
  metric: "ctr" | "clicksPerPost";
  value: number;
  reactionsPerPost: number;
};

export type CategoryBestHours = {
  posts: number;
  cells: BestHoursCell[];
  /** Meilleur créneau avec au moins `BEST_HOURS_MIN_POSTS` messages ; null = pas assez de données. */
  recommendation: BestHoursRecommendation | null;
};

export type ChannelBestHours = {
  channelId: string;
  weeks: number;
  minPosts: number;
  posts: number;
  computedAt: string;
  categories: Record<string, CategoryBestHours>;
};

/** Jour (1 = lundi … 7 = dimanche) et heure (0–23) en heure de Paris. */
export function parisDayHour(d: Date): { day: number; hour: number } {
  return { day: parisWeekday(d), hour: parisParts(d).hour % 24 };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Agrège une liste de messages (d'un même canal et d'une même catégorie) en cases jour × heure. */
export function buildCells(posts: BestHoursPost[]): BestHoursCell[] {
  const map = new Map<string, BestHoursCell>();
  for (const p of posts) {
    const { day, hour } = parisDayHour(p.sentAt);
    const key = `${day}:${hour}`;
    const cell = map.get(key) ?? { day, hour, posts: 0, views: 0, clicks: 0, uniqueClickers: 0, reactions: 0, ctr: null, clicksPerPost: 0, reactionsPerPost: 0 };
    cell.posts += 1;
    cell.views += Math.max(0, p.views);
    cell.clicks += Math.max(0, p.clicks);
    cell.uniqueClickers += Math.max(0, p.uniqueClickers);
    cell.reactions += Math.max(0, p.reactionsTotal);
    map.set(key, cell);
  }
  return [...map.values()]
    .map((c) => ({
      ...c,
      ctr: c.views > 0 ? round3(c.uniqueClickers / c.views) : null,
      clicksPerPost: round3(c.clicks / c.posts),
      reactionsPerPost: round3(c.reactions / c.posts),
    }))
    .sort((a, b) => a.day - b.day || a.hour - b.hour);
}

/**
 * Meilleur créneau : parmi les cases avec au moins `minPosts` messages, classement par taux de clic si des vues
 * existent dans ces cases, sinon par clics par message ; départage par réactions par message puis par nombre de messages.
 */
export function recommend(cells: BestHoursCell[], minPosts = BEST_HOURS_MIN_POSTS): BestHoursRecommendation | null {
  const eligible = cells.filter((c) => c.posts >= minPosts);
  if (eligible.length === 0) return null;
  const withViews = eligible.filter((c) => c.ctr !== null);
  const metric: "ctr" | "clicksPerPost" = withViews.length > 0 ? "ctr" : "clicksPerPost";
  const pool = metric === "ctr" ? withViews : eligible;
  const value = (c: BestHoursCell) => (metric === "ctr" ? (c.ctr ?? 0) : c.clicksPerPost);
  const best = [...pool].sort((a, b) => value(b) - value(a) || b.reactionsPerPost - a.reactionsPerPost || b.posts - a.posts || a.day - b.day || a.hour - b.hour)[0]!;
  return { day: best.day, hour: best.hour, posts: best.posts, metric, value: value(best), reactionsPerPost: best.reactionsPerPost };
}

/** Carte complète d'un canal : « all » + une entrée par catégorie rencontrée. */
export function buildBestHours(channelId: string, posts: BestHoursPost[], now: Date = new Date(), minPosts = BEST_HOURS_MIN_POSTS): ChannelBestHours {
  const mine = posts.filter((p) => p.channelId === channelId);
  const groups = new Map<string, BestHoursPost[]>();
  groups.set(ALL_CATEGORIES, mine);
  for (const p of mine) {
    if (!p.categoryId) continue;
    groups.set(p.categoryId, [...(groups.get(p.categoryId) ?? []), p]);
  }
  const categories: Record<string, CategoryBestHours> = {};
  for (const [key, list] of groups) {
    const cells = buildCells(list);
    categories[key] = { posts: list.length, cells, recommendation: recommend(cells, minPosts) };
  }
  return { channelId, weeks: BEST_HOURS_WEEKS, minPosts, posts: mine.length, computedAt: now.toISOString(), categories };
}

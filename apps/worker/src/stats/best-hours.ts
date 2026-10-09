import { prisma } from "@linkaffipro/db";
import { logger } from "../logger";

/**
 * Meilleurs horaires de publication, par canal et par catégorie (Europe/Paris).
 * Fonction pure `buildBestHours` (testée) + chargement `recomputeBestHours` (8 dernières semaines de messages envoyés).
 * Résultat stocké dans `Setting` : clé `besthours.<channelId>` (JSON `ChannelBestHours`) et `besthours.updatedAt` (ISO).
 * Le site lit ce JSON dans `apps/web/lib/besthours/` (mêmes formes que ci-dessous).
 */

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
  /** Clics par message. */
  clicksPerPost: number;
  /** Réactions par message. */
  reactionsPerPost: number;
};

export type BestHoursRecommendation = {
  day: number;
  hour: number;
  posts: number;
  /** Mesure qui a servi au classement : taux de clic (vues disponibles) ou clics par message. */
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
  /** Par catégorie (`categoryId`) et « all » pour toutes catégories confondues. */
  categories: Record<string, CategoryBestHours>;
};

const parisFmt = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", weekday: "short", hour: "2-digit", hourCycle: "h23" });
const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Jour (1 = lundi … 7 = dimanche) et heure (0–23) en heure de Paris. */
export function parisDayHour(d: Date): { day: number; hour: number } {
  const parts = parisFmt.formatToParts(d);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  return { day: WEEKDAYS[wd] ?? 1, hour };
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

/** Carte complète d'un canal : « all » + une entrée par catégorie rencontrée. Fonction pure. */
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

/** Charge les messages envoyés des 8 dernières semaines et écrit une entrée `Setting` par canal actif. */
export async function recomputeBestHours(now: Date = new Date()): Promise<{ channels: number; posts: number }> {
  const since = new Date(now.getTime() - BEST_HOURS_WEEKS * 7 * 86_400_000);
  const [channels, rows] = await Promise.all([
    prisma.channel.findMany({ where: { isActive: true }, select: { id: true } }),
    prisma.post.findMany({
      where: { status: "SENT", isTemplate: false, sentAt: { gte: since } },
      select: { channelId: true, categoryId: true, sentAt: true, stats: { select: { views: true, clicks: true, uniqueClickers: true, reactionsTotal: true } } },
    }),
  ]);
  const posts: BestHoursPost[] = rows
    .filter((r): r is typeof r & { sentAt: Date } => r.sentAt !== null)
    .map((r) => ({
      channelId: r.channelId,
      categoryId: r.categoryId,
      sentAt: r.sentAt,
      views: r.stats?.views ?? 0,
      clicks: r.stats?.clicks ?? 0,
      uniqueClickers: r.stats?.uniqueClickers ?? 0,
      reactionsTotal: r.stats?.reactionsTotal ?? 0,
    }));
  for (const c of channels) {
    const value = buildBestHours(c.id, posts, now);
    await prisma.setting.upsert({ where: { key: `besthours.${c.id}` }, create: { key: `besthours.${c.id}`, value }, update: { value } });
  }
  const stamp = now.toISOString();
  await prisma.setting.upsert({ where: { key: "besthours.updatedAt" }, create: { key: "besthours.updatedAt", value: stamp }, update: { value: stamp } });
  logger.info({ channels: channels.length, posts: posts.length }, "meilleurs horaires recalculés");
  return { channels: channels.length, posts: posts.length };
}

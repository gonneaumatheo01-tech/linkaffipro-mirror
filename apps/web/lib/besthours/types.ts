/**
 * Meilleurs horaires de publication : formes du JSON écrit par le worker (`apps/worker/src/stats/best-hours.ts`)
 * dans `Setting` `besthours.<channelId>`, lecture tolérante et libellés français. Fonctions pures, testées.
 */

export const ALL_CATEGORIES = "all";

export type BestHoursCell = {
  day: number;
  hour: number;
  posts: number;
  views: number;
  clicks: number;
  uniqueClickers: number;
  reactions: number;
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

/** Créneau recommandé, prêt à afficher dans le formulaire de message. */
export type BestSlot = { day: number; hour: number; posts: number; label: string };

const DAY_NAMES = ["", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const DAY_SHORT = ["", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];

/** « mardi 19 h ». */
export function slotLabel(day: number, hour: number): string {
  return `${DAY_NAMES[day] ?? "?"} ${hour} h`;
}

/** « mar. ». */
export function dayShort(day: number): string {
  return DAY_SHORT[day] ?? "?";
}

/** « mardi ». */
export function dayName(day: number): string {
  return DAY_NAMES[day] ?? "?";
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Lit le JSON stocké ; null si la forme n'est pas celle attendue. */
export function parseChannelBestHours(value: unknown): ChannelBestHours | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.channelId !== "string" || typeof v.computedAt !== "string") return null;
  if (!v.categories || typeof v.categories !== "object") return null;
  const categories: Record<string, CategoryBestHours> = {};
  for (const [key, raw] of Object.entries(v.categories as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const cells = Array.isArray(c.cells)
      ? (c.cells as unknown[]).filter(
          (x): x is BestHoursCell =>
            !!x &&
            typeof x === "object" &&
            isNum((x as BestHoursCell).day) &&
            isNum((x as BestHoursCell).hour) &&
            isNum((x as BestHoursCell).posts),
        )
      : [];
    const rec = c.recommendation as BestHoursRecommendation | null | undefined;
    categories[key] = {
      posts: isNum(c.posts) ? c.posts : cells.reduce((s, x) => s + x.posts, 0),
      cells,
      recommendation:
        rec && typeof rec === "object" && isNum(rec.day) && isNum(rec.hour)
          ? {
              day: rec.day,
              hour: rec.hour,
              posts: isNum(rec.posts) ? rec.posts : 0,
              metric: rec.metric === "ctr" ? "ctr" : "clicksPerPost",
              value: isNum(rec.value) ? rec.value : 0,
              reactionsPerPost: isNum(rec.reactionsPerPost) ? rec.reactionsPerPost : 0,
            }
          : null,
    };
  }
  return {
    channelId: v.channelId,
    weeks: isNum(v.weeks) ? v.weeks : 8,
    minPosts: isNum(v.minPosts) ? v.minPosts : 3,
    posts: isNum(v.posts) ? v.posts : 0,
    computedAt: v.computedAt,
    categories,
  };
}

/** Créneau recommandé pour une catégorie (repli sur « toutes catégories » si la catégorie n'en a pas). */
export function bestSlotFor(
  data: ChannelBestHours | null,
  categoryId: string | null | undefined,
  opts: { fallbackToAll?: boolean } = {},
): BestSlot | null {
  if (!data) return null;
  const keys = [categoryId || ALL_CATEGORIES];
  if ((opts.fallbackToAll ?? true) && categoryId) keys.push(ALL_CATEGORIES);
  for (const key of keys) {
    const rec = data.categories[key]?.recommendation;
    if (rec)
      return {
        day: rec.day,
        hour: rec.hour,
        posts: rec.posts,
        label: slotLabel(rec.day, rec.hour),
      };
  }
  return null;
}

/** Phrase de recommandation en français simple. */
export function recommendationSentence(
  cat: CategoryBestHours | undefined,
  minPosts: number,
): string {
  if (!cat || cat.posts === 0) return "Pas encore de message envoyé sur cette période.";
  const r = cat.recommendation;
  if (!r)
    return `Pas assez de données : il faut au moins ${minPosts} messages envoyés dans un même créneau (jour et heure) pour le recommander.`;
  const measure =
    r.metric === "ctr"
      ? `${(r.value * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} % de taux de clic`
      : `${r.value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} clic(s) par message`;
  return `Meilleur créneau : ${slotLabel(r.day, r.hour)} (${r.posts} messages, ${measure}, ${r.reactionsPerPost.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} réaction(s) par message).`;
}

/** Intensité 0–4 d'une case par rapport au maximum de la carte (pour les couleurs). */
export function intensity(cell: BestHoursCell | undefined, max: number): number {
  if (!cell || max <= 0) return 0;
  const v = cell.ctr !== null ? cell.ctr : cell.clicksPerPost;
  if (v <= 0) return cell.posts > 0 ? 1 : 0;
  return Math.min(4, Math.max(1, Math.ceil((v / max) * 4)));
}

/** Valeur maximale (taux de clic si disponible, sinon clics par message) pour la mise à l'échelle. */
export function maxValue(cells: BestHoursCell[]): number {
  const withViews = cells.filter((c) => c.ctr !== null);
  const pool =
    withViews.length > 0 ? withViews.map((c) => c.ctr ?? 0) : cells.map((c) => c.clicksPerPost);
  return pool.length ? Math.max(...pool) : 0;
}

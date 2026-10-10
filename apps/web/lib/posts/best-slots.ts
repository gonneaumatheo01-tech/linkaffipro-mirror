/**
 * Meilleurs créneaux affichés dans le calendrier des messages, à partir des meilleurs horaires calculés chaque jour
 * par le worker (`Setting` `besthours.<channelId>`, `apps/worker/src/stats/best-hours.ts`, lus par
 * `lib/besthours/types.ts`). Même règle de classement que la recommandation du worker : cases d'au moins
 * `minPosts` messages envoyés, taux de clic quand des vues existent, sinon clics par message ; départage par
 * réactions par message, puis nombre de messages. Fonctions pures, testées dans best-slots.test.ts.
 */
import {
  ALL_CATEGORIES,
  dayName,
  type BestHoursCell,
  type ChannelBestHours,
} from "@/lib/besthours/types";
import { addDayKey, hourLabel, type DayKey, type DaySlot } from "./calendar";

export type RankedSlot = {
  /** 1 = lundi … 7 = dimanche. */
  day: number;
  hour: number;
  /** 1, 2, 3… */
  rank: number;
  posts: number;
  metric: "ctr" | "clicksPerPost";
  value: number;
  /** « mardi 19 h ». */
  label: string;
  /** « 4 clics par message » ou « 15,3 % de taux de clic ». */
  detail: string;
};

export type CalendarBestSlots = {
  slots: RankedSlot[];
  /** Canaux dont les données ont servi. */
  channels: number;
  /** Messages envoyés analysés (8 dernières semaines). */
  posts: number;
  /** Seuil de messages par case pour être retenue. */
  minPosts: number;
  /** La catégorie filtrée avait ses propres données (sinon : toutes catégories). */
  byCategory: boolean;
};

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Additionne des cases jour × heure (plusieurs canaux) et recalcule taux de clic et moyennes par message. */
export function mergeCells(lists: BestHoursCell[][]): BestHoursCell[] {
  const map = new Map<string, BestHoursCell>();
  for (const list of lists)
    for (const c of list) {
      const key = `${c.day}:${c.hour}`;
      const cur = map.get(key) ?? {
        day: c.day,
        hour: c.hour,
        posts: 0,
        views: 0,
        clicks: 0,
        uniqueClickers: 0,
        reactions: 0,
        ctr: null,
        clicksPerPost: 0,
        reactionsPerPost: 0,
      };
      cur.posts += Math.max(0, c.posts);
      cur.views += Math.max(0, c.views ?? 0);
      cur.clicks += Math.max(0, c.clicks ?? 0);
      cur.uniqueClickers += Math.max(0, c.uniqueClickers ?? 0);
      cur.reactions += Math.max(0, c.reactions ?? 0);
      map.set(key, cur);
    }
  return [...map.values()]
    .filter((c) => c.posts > 0)
    .map((c) => ({
      ...c,
      ctr: c.views > 0 ? round3(c.uniqueClickers / c.views) : null,
      clicksPerPost: round3(c.clicks / c.posts),
      reactionsPerPost: round3(c.reactions / c.posts),
    }))
    .sort((a, b) => a.day - b.day || a.hour - b.hour);
}

const pctFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const numFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

/** « 4 clics par message », « 1 clic par message », « 15,3 % de taux de clic ». */
export function slotDetail(metric: "ctr" | "clicksPerPost", value: number): string {
  if (metric === "ctr") return `${pctFmt.format(value * 100)}\u00a0% de taux de clic`;
  return `${numFmt.format(value)} ${value >= 2 ? "clics" : "clic"} par message`;
}

/** Les `n` meilleurs créneaux d'une liste de cases (règle du worker), du meilleur au moins bon. */
export function rankSlots(cells: BestHoursCell[], minPosts: number, n = 3): RankedSlot[] {
  const eligible = cells.filter((c) => c.posts >= minPosts);
  if (eligible.length === 0) return [];
  const withViews = eligible.filter((c) => c.ctr !== null);
  const metric: "ctr" | "clicksPerPost" = withViews.length > 0 ? "ctr" : "clicksPerPost";
  const pool = metric === "ctr" ? withViews : eligible;
  const value = (c: BestHoursCell) => (metric === "ctr" ? (c.ctr ?? 0) : c.clicksPerPost);
  return [...pool]
    .sort(
      (a, b) =>
        value(b) - value(a) ||
        b.reactionsPerPost - a.reactionsPerPost ||
        b.posts - a.posts ||
        a.day - b.day ||
        a.hour - b.hour,
    )
    .slice(0, n)
    .map((c, i) => ({
      day: c.day,
      hour: c.hour,
      rank: i + 1,
      posts: c.posts,
      metric,
      value: value(c),
      label: `${dayName(c.day)} ${hourLabel(c.hour)}`,
      detail: slotDetail(metric, value(c)),
    }));
}

/**
 * Meilleurs créneaux du calendrier : ceux du canal filtré, sinon de tous les canaux réunis. Avec un filtre de
 * catégorie, les cases de cette catégorie quand elles existent (sinon toutes catégories).
 */
export function calendarBestSlots(
  data: ChannelBestHours[],
  opts: { channelId?: string; categoryId?: string; n?: number } = {},
): CalendarBestSlots {
  const scope = opts.channelId ? data.filter((d) => d.channelId === opts.channelId) : data;
  const minPosts = scope.length > 0 ? Math.min(...scope.map((d) => d.minPosts || 3)) : 3;
  const byCategory = Boolean(
    opts.categoryId && scope.some((d) => (d.categories[opts.categoryId!]?.cells.length ?? 0) > 0),
  );
  const key = byCategory ? opts.categoryId! : ALL_CATEGORIES;
  const used = scope.filter((d) => (d.categories[key]?.cells.length ?? 0) > 0);
  const cells = mergeCells(used.map((d) => d.categories[key]!.cells));
  return {
    slots: rankSlots(cells, minPosts, opts.n ?? 3),
    channels: used.length,
    posts: used.reduce((s, d) => s + (d.categories[key]?.posts ?? 0), 0),
    minPosts,
    byCategory,
  };
}

/** Créneaux conseillés placés sur les jours de la semaine affichée (lundi donné). */
export function slotsInWeek(slots: RankedSlot[], monday: DayKey): DaySlot[] {
  return slots.map((s) => ({
    day: addDayKey(monday, s.day - 1),
    hour: s.hour,
    rank: s.rank,
    label: s.label,
    detail: s.detail,
  }));
}

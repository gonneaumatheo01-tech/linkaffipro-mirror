/**
 * Classements « ce qui marche » de l'agent Posts (purs) : par canal ou par univers, pour chaque dimension (format,
 * thème, heure, tranche de longueur, persona), les chiffres de chaque cas et son verdict. Aucune conclusion sans assez
 * de données : un cas compte s'il a `minPosts` posts ou `minViews` vues cumulées, et il faut au moins deux cas
 * comparables. Mesure principale : taux de clic sur l'offre (clics offre ÷ vues) ; sans aucun clic offre, vues à 24 h.
 */
import { median, ratio, round } from "../../algo/math";
import { lengthBucket } from "./features";

export type InsightRow = {
  postId: string;
  channelId: string;
  vertical: string | null;
  format: string;
  theme: string | null;
  personaId: string | null;
  hourParis: number;
  weekdayParis: number;
  textLength: number;
  views2h: number | null;
  views24h: number | null;
  viewsFinal: number;
  offerClicks: number;
  clicks: number;
  registrations: number;
  ftds: number;
  sentAt: Date;
};

export const DIMENSIONS = ["format", "theme", "hour", "length", "persona"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const DIMENSION_LABELS: Record<Dimension, string> = {
  format: "type de post",
  theme: "thème",
  hour: "heure",
  length: "longueur",
  persona: "persona",
};

export const FORMAT_LABELS: Record<string, string> = { VIDEO: "vidéo", PHOTO: "photo", ALBUM: "album", TEXT: "texte" };

export type Verdict = "works" | "weak" | "median" | "insufficient";

export type RankingCase = {
  key: string;
  label: string;
  posts: number;
  views: number;
  offerClicks: number;
  registrations: number;
  /** Clics offre ÷ vues. */
  ctr: number | null;
  views24hMedian: number | null;
  regsPer1000: number | null;
  enoughData: boolean;
  verdict: Verdict;
};

export type DimensionRanking = {
  dimension: Dimension;
  metric: "ctr" | "views24h";
  cases: RankingCase[];
  /** Clés des cas au-dessus / au-dessous de la médiane (assez de données). */
  works: string[];
  weak: string[];
  /** « pas encore assez de données » quand moins de deux cas sont comparables. */
  note: string | null;
};

export type ScopeRanking = {
  scope: "channel" | "vertical";
  id: string;
  posts: number;
  views: number;
  dimensions: Record<Dimension, DimensionRanking>;
};

export type RankThresholds = { minPosts: number; minViews: number };

export const NOT_ENOUGH_DATA = "pas encore assez de données";

function keyOf(row: InsightRow, dim: Dimension): string | null {
  switch (dim) {
    case "format":
      return row.format;
    case "theme":
      return row.theme;
    case "hour":
      return String(row.hourParis);
    case "length":
      return lengthBucket(row.textLength);
    case "persona":
      return row.personaId;
  }
}

function labelOf(dim: Dimension, key: string, names: ReadonlyMap<string, string>): string {
  if (dim === "format") return FORMAT_LABELS[key] ?? key.toLowerCase();
  if (dim === "hour") return `${key} h`;
  return names.get(key) ?? key;
}

/** Classement d'une dimension (pur). `names` : libellés des personas et thèmes connus. */
export function rankDimension(
  rows: readonly InsightRow[],
  dim: Dimension,
  t: RankThresholds,
  names: ReadonlyMap<string, string> = new Map(),
): DimensionRanking {
  const groups = new Map<string, InsightRow[]>();
  for (const r of rows) {
    const k = keyOf(r, dim);
    if (k === null || k === "") continue;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const cases: RankingCase[] = [...groups.entries()].map(([key, list]) => {
    const views = list.reduce((s, r) => s + r.viewsFinal, 0);
    const offerClicks = list.reduce((s, r) => s + r.offerClicks, 0);
    const registrations = list.reduce((s, r) => s + r.registrations, 0);
    const v24 = median(list.map((r) => r.views24h).filter((x): x is number => x !== null));
    const ctr = ratio(offerClicks, views);
    const per1000 = ratio(registrations * 1000, views);
    return {
      key,
      label: labelOf(dim, key, names),
      posts: list.length,
      views,
      offerClicks,
      registrations,
      ctr: ctr === null ? null : round(ctr, 5),
      views24hMedian: v24,
      regsPer1000: per1000 === null ? null : round(per1000, 3),
      enoughData: list.length >= t.minPosts || views >= t.minViews,
      verdict: "insufficient" as Verdict,
    };
  });
  const enough = cases.filter((c) => c.enoughData);
  const metric: "ctr" | "views24h" = enough.some((c) => c.offerClicks > 0) ? "ctr" : "views24h";
  const value = (c: RankingCase): number | null => (metric === "ctr" ? c.ctr : c.views24hMedian);
  const comparable = enough.filter((c) => value(c) !== null);
  const works: string[] = [];
  const weak: string[] = [];
  let note: string | null = null;
  if (comparable.length < 2) note = NOT_ENOUGH_DATA;
  else {
    const med = median(comparable.map((c) => value(c)!))!;
    for (const c of comparable) {
      const v = value(c)!;
      c.verdict = v > med ? "works" : v < med ? "weak" : "median";
      if (c.verdict === "works") works.push(c.key);
      if (c.verdict === "weak") weak.push(c.key);
    }
  }
  const sorted = [...cases].sort(
    (a, b) => Number(b.enoughData) - Number(a.enoughData) || (value(b) ?? -1) - (value(a) ?? -1) || b.posts - a.posts,
  );
  return { dimension: dim, metric, cases: sorted, works, weak, note };
}

/** Classements d'un ensemble de posts (un canal ou un univers). */
export function rankScope(
  scope: "channel" | "vertical",
  id: string,
  rows: readonly InsightRow[],
  t: RankThresholds,
  names: ReadonlyMap<string, string> = new Map(),
): ScopeRanking {
  const dimensions = {} as Record<Dimension, DimensionRanking>;
  for (const d of DIMENSIONS) dimensions[d] = rankDimension(rows, d, t, names);
  return { scope, id, posts: rows.length, views: rows.reduce((s, r) => s + r.viewsFinal, 0), dimensions };
}

/** Classements par canal et par univers. */
export function rankAll(
  rows: readonly InsightRow[],
  t: RankThresholds,
  names: ReadonlyMap<string, string> = new Map(),
): { channels: ScopeRanking[]; verticals: ScopeRanking[] } {
  const byChannel = new Map<string, InsightRow[]>();
  const byVertical = new Map<string, InsightRow[]>();
  for (const r of rows) {
    byChannel.set(r.channelId, [...(byChannel.get(r.channelId) ?? []), r]);
    if (r.vertical) byVertical.set(r.vertical, [...(byVertical.get(r.vertical) ?? []), r]);
  }
  return {
    channels: [...byChannel.entries()].map(([id, list]) => rankScope("channel", id, list, t, names)),
    verticals: [...byVertical.entries()].map(([id, list]) => rankScope("vertical", id, list, t, names)),
  };
}

/** Meilleur cas d'une dimension (« ce qui marche »), ou null. */
export function bestCase(r: DimensionRanking): RankingCase | null {
  return r.cases.find((c) => r.works.includes(c.key)) ?? null;
}

/**
 * « Ce qui marche » (phase 21) : lecture des fiches de résultats `PostInsight` écrites par l'agent Posts. Le site ne
 * fait que regrouper et classer, à l'image du moteur : un cas (un type de post, une heure, une persona…) n'est conclu
 * qu'avec assez de données (20 posts OU 1 000 vues par défaut, réglables), « ce qui marche » = au-dessus de la valeur
 * du milieu des cas comparables, « ce qui ne marche pas » = en dessous. Fonctions pures, testées (insights.test.ts).
 */

export type InsightRow = {
  channelId: string;
  personaId: string | null;
  format: string;
  theme: string | null;
  hourParis: number;
  weekdayParis: number;
  textLength: number;
  views24h: number | null;
  viewsFinal: number;
  offerClicks: number;
  registrations: number;
};

export type Thresholds = { minPosts: number; minViews: number };

export type GroupStats = {
  key: string;
  posts: number;
  views: number;
  offerClicks: number;
  registrations: number;
  /** Clics sur l'offre ÷ vues (null sans vue relevée). */
  offerCtr: number | null;
  /** Moyenne des vues à 24 h des posts qui en ont une (null sinon). */
  avgViews24h: number | null;
  /** Inscriptions pour 1 000 vues (null sans vue). */
  registrationsPer1000: number | null;
  enoughData: boolean;
};

export type Dimension = "format" | "hour" | "weekday" | "persona" | "channel" | "theme" | "length";

export const FORMAT_LABELS: Record<string, string> = {
  VIDEO: "Vidéo",
  PHOTO: "Photo",
  ALBUM: "Album",
  TEXT: "Texte",
};

/** Tranches de longueur du texte (caractères). */
export const LENGTH_BUCKETS: ReadonlyArray<{ key: string; label: string; max: number }> = [
  { key: "xs", label: "Très court (moins de 80 caractères)", max: 79 },
  { key: "s", label: "Court (80 à 199)", max: 199 },
  { key: "m", label: "Moyen (200 à 499)", max: 499 },
  { key: "l", label: "Long (500 et plus)", max: Number.POSITIVE_INFINITY },
];

export function lengthBucket(len: number): string {
  return LENGTH_BUCKETS.find((b) => len <= b.max)?.key ?? "l";
}

export function enoughData(posts: number, views: number, t: Thresholds): boolean {
  return posts >= t.minPosts || views >= t.minViews;
}

function keyOf(r: InsightRow, dim: Dimension): string | null {
  switch (dim) {
    case "format":
      return r.format;
    case "hour":
      return String(r.hourParis);
    case "weekday":
      return String(r.weekdayParis);
    case "persona":
      return r.personaId;
    case "channel":
      return r.channelId;
    case "theme":
      return r.theme;
    case "length":
      return lengthBucket(r.textLength);
  }
}

/** Regroupe les fiches selon une dimension (les fiches sans valeur pour la dimension sont laissées de côté). */
export function groupBy(rows: readonly InsightRow[], dim: Dimension, t: Thresholds): GroupStats[] {
  const acc = new Map<string, { posts: number; views: number; clicks: number; regs: number; v24: number; n24: number }>();
  for (const r of rows) {
    const k = keyOf(r, dim);
    if (k === null || k === "") continue;
    const g = acc.get(k) ?? { posts: 0, views: 0, clicks: 0, regs: 0, v24: 0, n24: 0 };
    g.posts += 1;
    g.views += Math.max(0, r.viewsFinal);
    g.clicks += Math.max(0, r.offerClicks);
    g.regs += Math.max(0, r.registrations);
    if (r.views24h !== null) {
      g.v24 += r.views24h;
      g.n24 += 1;
    }
    acc.set(k, g);
  }
  return [...acc.entries()].map(([key, g]) => ({
    key,
    posts: g.posts,
    views: g.views,
    offerClicks: g.clicks,
    registrations: g.regs,
    offerCtr: g.views > 0 ? g.clicks / g.views : null,
    avgViews24h: g.n24 > 0 ? g.v24 / g.n24 : null,
    registrationsPer1000: g.views > 0 ? (g.regs / g.views) * 1000 : null,
    enoughData: enoughData(g.posts, g.views, t),
  }));
}

/** Valeur du milieu (médiane) d'une liste ; null si vide. */
export function middleValue(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? null) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}

export type Ranking = {
  /** Cas comparables (assez de données et une mesure), du meilleur au moins bon. */
  ranked: GroupStats[];
  works: GroupStats[];
  doesNotWork: GroupStats[];
  /** Cas pas encore concluants (sous les seuils, ou sans vue relevée). */
  notEnough: GroupStats[];
  middle: number | null;
};

/**
 * Classement par taux de clic sur l'offre. Il faut au moins deux cas comparables pour parler de « ce qui marche » :
 * avec un seul, il reste classé mais n'est ni au-dessus ni en dessous.
 */
export function rank(groups: readonly GroupStats[]): Ranking {
  const comparable = groups.filter((g) => g.enoughData && g.offerCtr !== null);
  const notEnough = groups.filter((g) => !comparable.includes(g)).sort((a, b) => b.posts - a.posts);
  const ranked = [...comparable].sort((a, b) => (b.offerCtr ?? 0) - (a.offerCtr ?? 0) || b.posts - a.posts);
  const middle = middleValue(ranked.map((g) => g.offerCtr ?? 0));
  if (ranked.length < 2 || middle === null) return { ranked, works: [], doesNotWork: [], notEnough, middle };
  return {
    ranked,
    works: ranked.filter((g) => (g.offerCtr ?? 0) > middle),
    doesNotWork: ranked.filter((g) => (g.offerCtr ?? 0) < middle),
    notEnough,
    middle,
  };
}

/** Une valeur par heure de Paris (0 à 23) : taux de clic sur l'offre, 0 sans données. */
export function hourSeries(groups: readonly GroupStats[]): { values: number[]; posts: number[] } {
  const values = Array.from({ length: 24 }, () => 0);
  const posts = Array.from({ length: 24 }, () => 0);
  for (const g of groups) {
    const h = Number(g.key);
    if (!Number.isInteger(h) || h < 0 || h > 23) continue;
    values[h] = g.offerCtr ?? 0;
    posts[h] = g.posts;
  }
  return { values, posts };
}

/** Une valeur par jour (lundi = 1 … dimanche = 7), rangée de 0 à 6. */
export function weekdaySeries(groups: readonly GroupStats[]): { values: number[]; posts: number[] } {
  const values = Array.from({ length: 7 }, () => 0);
  const posts = Array.from({ length: 7 }, () => 0);
  for (const g of groups) {
    const d = Number(g.key);
    if (!Number.isInteger(d) || d < 1 || d > 7) continue;
    values[d - 1] = g.offerCtr ?? 0;
    posts[d - 1] = g.posts;
  }
  return { values, posts };
}

export type Summary = {
  posts: number;
  views: number;
  offerClicks: number;
  registrations: number;
  format: Ranking;
  hour: Ranking;
  weekday: Ranking;
  persona: Ranking;
  channel: Ranking;
  theme: Ranking;
  length: Ranking;
  hours: { values: number[]; posts: number[] };
  weekdays: { values: number[]; posts: number[] };
};

export function summarize(rows: readonly InsightRow[], t: Thresholds): Summary {
  const by = (d: Dimension) => groupBy(rows, d, t);
  const hourGroups = by("hour");
  const weekdayGroups = by("weekday");
  return {
    posts: rows.length,
    views: rows.reduce((s, r) => s + Math.max(0, r.viewsFinal), 0),
    offerClicks: rows.reduce((s, r) => s + Math.max(0, r.offerClicks), 0),
    registrations: rows.reduce((s, r) => s + Math.max(0, r.registrations), 0),
    format: rank(by("format")),
    hour: rank(hourGroups),
    weekday: rank(weekdayGroups),
    persona: rank(by("persona")),
    channel: rank(by("channel")),
    theme: rank(by("theme")),
    length: rank(by("length")),
    hours: hourSeries(hourGroups),
    weekdays: weekdaySeries(weekdayGroups),
  };
}

/** « pas encore assez de données : 12 posts et 340 vues, il en faut 20 ou 1 000 vues ». */
export function notEnoughSentence(g: Pick<GroupStats, "posts" | "views">, t: Thresholds): string {
  return `Pas encore assez de données : ${fmtInt(g.posts)} post${g.posts > 1 ? "s" : ""} et ${fmtInt(g.views)} vue${g.views > 1 ? "s" : ""}, il faut ${fmtInt(t.minPosts)} posts ou ${fmtInt(t.minViews)} vues.`;
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("fr-FR");
}

/** Taux en pourcentage français : « 2,4 % » ; « — » si absent. */
export function pctText(r: number | null | undefined, digits = 1): string {
  if (r === null || r === undefined || !Number.isFinite(r)) return "—";
  return `${(r * 100).toLocaleString("fr-FR", { maximumFractionDigits: digits })} %`;
}

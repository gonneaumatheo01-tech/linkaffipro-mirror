/**
 * Fenêtres de publication (règles pures de l'agent Horaires) : par canal, jour de la semaine et heure de Paris, médiane
 * des vues à 2 h et taux de clic sur l'offre ; score = moyenne des deux mesures ramenées au meilleur du canal. Une
 * fenêtre = heures contiguës d'un même jour dont le score atteint `ratio` (80 %) du meilleur score du jour, avec au moins
 * `minPostsPerCell` posts par heure. Par type de post quand il a assez de posts, sinon toutes confondues.
 */
import { median, ratio as safeRatio, round } from "../../algo/math";
import type { InsightRow } from "../posts/rank";

export type WindowCell = {
  day: number;
  hour: number;
  posts: number;
  medianViews2h: number | null;
  ctr: number | null;
  score: number;
};

/** Forme de `ChannelAgentPlan.suggestedWindows` : `{ day, start, end, score }` (+ `format`, `posts`). */
export type SuggestedWindow = { day: number; start: string; end: string; score: number; posts: number; format?: string };

export type ChannelWindows = { all: SuggestedWindow[]; byFormat: Record<string, SuggestedWindow[]>; cells: WindowCell[] };

export type WindowOptions = { ratio: number; minPostsPerCell: number; minPosts: number };

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** Cases jour × heure notées. */
export function buildWindowCells(rows: readonly InsightRow[]): WindowCell[] {
  const map = new Map<string, InsightRow[]>();
  for (const r of rows) {
    const k = `${r.weekdayParis}:${r.hourParis}`;
    map.set(k, [...(map.get(k) ?? []), r]);
  }
  const raw = [...map.entries()].map(([k, list]) => {
    const [day, hour] = k.split(":").map(Number) as [number, number];
    const views = list.reduce((s, r) => s + r.viewsFinal, 0);
    return {
      day,
      hour,
      posts: list.length,
      medianViews2h: median(list.map((r) => r.views2h).filter((x): x is number => x !== null)),
      ctr: safeRatio(list.reduce((s, r) => s + r.offerClicks, 0), views),
      score: 0,
    };
  });
  const maxV = Math.max(0, ...raw.map((c) => c.medianViews2h ?? 0));
  const maxC = Math.max(0, ...raw.map((c) => c.ctr ?? 0));
  for (const c of raw) {
    const parts: number[] = [];
    if (maxV > 0) parts.push((c.medianViews2h ?? 0) / maxV);
    if (maxC > 0) parts.push((c.ctr ?? 0) / maxC);
    c.score = parts.length ? round(parts.reduce((s, x) => s + x, 0) / parts.length, 4) : 0;
  }
  return raw.sort((a, b) => a.day - b.day || a.hour - b.hour);
}

/** Fenêtres d'un ensemble de cases (pur). */
export function windowsFromCells(cells: readonly WindowCell[], o: Pick<WindowOptions, "ratio" | "minPostsPerCell">, format?: string): SuggestedWindow[] {
  const out: SuggestedWindow[] = [];
  for (let day = 1; day <= 7; day++) {
    const eligible = new Map(cells.filter((c) => c.day === day && c.posts >= o.minPostsPerCell).map((c) => [c.hour, c]));
    const best = Math.max(0, ...[...eligible.values()].map((c) => c.score));
    if (best <= 0) continue;
    let run: WindowCell[] = [];
    const flush = () => {
      if (run.length) {
        out.push({
          day,
          start: hh(run[0]!.hour),
          end: hh(run[run.length - 1]!.hour + 1),
          score: Math.max(...run.map((c) => c.score)),
          posts: run.reduce((s, c) => s + c.posts, 0),
          ...(format ? { format } : {}),
        });
      }
      run = [];
    };
    for (let h = 0; h < 24; h++) {
      const c = eligible.get(h);
      if (c && c.score >= o.ratio * best) run.push(c);
      else flush();
    }
    flush();
  }
  return out;
}

/** Fenêtres d'un canal : toutes confondues, et par type de post quand il a `minPosts` posts. */
export function buildChannelWindows(rows: readonly InsightRow[], o: WindowOptions): ChannelWindows {
  const cells = buildWindowCells(rows);
  const byFormat: Record<string, SuggestedWindow[]> = {};
  const formats = new Map<string, InsightRow[]>();
  for (const r of rows) formats.set(r.format, [...(formats.get(r.format) ?? []), r]);
  for (const [format, list] of formats) {
    if (list.length < o.minPosts) continue;
    const w = windowsFromCells(buildWindowCells(list), o, format);
    if (w.length) byFormat[format] = w;
  }
  return { all: windowsFromCells(cells, o), byFormat, cells };
}

/** Valeur JSON de `ChannelAgentPlan.suggestedWindows` (toutes confondues d'abord). */
export function suggestedWindowsJson(w: ChannelWindows): SuggestedWindow[] {
  return [...w.all, ...Object.values(w.byFormat).flat()];
}

/**
 * Plage quotidienne conseillée (fenêtre du plan) : profil heure par heure tous jours confondus, heures contiguës
 * autour de la meilleure dont le score atteint `ratio` du meilleur. Null sans case notée.
 */
export function dailyRange(cells: readonly WindowCell[], o: Pick<WindowOptions, "ratio" | "minPostsPerCell">): { start: number; end: number } | null {
  const byHour = new Map<number, { posts: number; score: number }>();
  for (const c of cells) {
    const h = byHour.get(c.hour) ?? { posts: 0, score: 0 };
    // Moyenne pondérée par les posts : une heure très chargée pèse plus qu'une case isolée.
    h.score = (h.score * h.posts + c.score * c.posts) / (h.posts + c.posts);
    h.posts += c.posts;
    byHour.set(c.hour, h);
  }
  const eligible = [...byHour.entries()].filter(([, v]) => v.posts >= o.minPostsPerCell);
  if (!eligible.length) return null;
  const [bestHour, best] = eligible.sort((a, b) => b[1].score - a[1].score || a[0] - b[0])[0]!;
  if (best.score <= 0) return null;
  const ok = (h: number) => {
    const v = byHour.get(h);
    return !!v && v.posts >= o.minPostsPerCell && v.score >= o.ratio * best.score;
  };
  let start = bestHour;
  let end = bestHour + 1;
  while (start > 0 && ok(start - 1)) start--;
  while (end < 24 && ok(end)) end++;
  return { start, end };
}

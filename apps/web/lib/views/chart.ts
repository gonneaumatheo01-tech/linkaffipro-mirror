/**
 * Préparation d'une courbe de relevés (SVG maison, sans dépendance). Fonctions pures, testées.
 * Une courbe par mesure (vues, transferts : échelles différentes → deux petits graphiques, jamais deux axes).
 */
export type ViewSample = { at: Date; views: number; forwards: number };
export type ViewMetric = "views" | "forwards";

export type ChartPoint = { x: number; y: number; at: Date; value: number };

export type ChartSeries = {
  metric: ViewMetric;
  points: ChartPoint[];
  /** Attribut `points` d'une polyline. */
  polyline: string;
  yTicks: Array<{ value: number; y: number }>;
  xTicks: Array<{ label: string; x: number }>;
  max: number;
  first: ChartPoint;
  last: ChartPoint;
  width: number;
  height: number;
  padding: { left: number; right: number; top: number; bottom: number };
};

export const CHART_WIDTH = 640;
export const CHART_HEIGHT = 150;
const PAD = { left: 46, right: 14, top: 10, bottom: 22 };

/** Arrondi « joli » du maximum pour l'axe (1, 2, 5 × 10^n). */
export function niceMax(n: number): number {
  if (n <= 0) return 1;
  const exp = Math.floor(Math.log10(n));
  const base = 10 ** exp;
  const m = n / base;
  const step = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
  return step * base;
}

/** Libellé court d'un instant pour l'axe du temps (Europe/Paris) : heure si la série tient dans 2 jours, sinon date. */
export function tickLabel(d: Date, spanMs: number): string {
  const tz = "Europe/Paris";
  if (spanMs <= 2 * 24 * 3600 * 1000) {
    return new Intl.DateTimeFormat("fr-FR", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  }
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
  }).format(d);
}

/** Construit la série d'une mesure ; null s'il n'y a aucun relevé valide. */
export function buildSeries(
  samples: ReadonlyArray<ViewSample>,
  metric: ViewMetric,
  width = CHART_WIDTH,
  height = CHART_HEIGHT,
): ChartSeries | null {
  const sorted = [...samples]
    .map((s) => ({ at: s.at, value: Math.max(0, s[metric]) }))
    .filter((s) => Number.isFinite(s.value))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  if (sorted.length === 0) return null;
  const max = Math.max(...sorted.map((s) => s.value));
  const yMax = niceMax(max);
  const t0 = sorted[0]!.at.getTime();
  const span = Math.max(1, sorted[sorted.length - 1]!.at.getTime() - t0);
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const fmt = (n: number) => Math.round(n * 10) / 10;
  const x = (d: Date) =>
    fmt(
      sorted.length === 1 ? PAD.left + innerW / 2 : PAD.left + ((d.getTime() - t0) / span) * innerW,
    );
  const y = (v: number) => fmt(PAD.top + innerH - (v / yMax) * innerH);
  const points: ChartPoint[] = sorted.map((s) => ({
    x: x(s.at),
    y: y(s.value),
    at: s.at,
    value: s.value,
  }));
  const yTicks = [0, 0.5, 1].map((r) => ({ value: Math.round(yMax * r), y: y(yMax * r) }));
  const xCount = sorted.length === 1 ? 1 : Math.min(4, sorted.length);
  const xTicks = Array.from({ length: xCount }, (_, i) => {
    const d = new Date(t0 + (xCount === 1 ? 0 : (span * i) / (xCount - 1)));
    return { label: tickLabel(d, span), x: x(d) };
  });
  return {
    metric,
    points,
    polyline: points.map((p) => `${p.x},${p.y}`).join(" "),
    yTicks,
    xTicks,
    max,
    first: points[0]!,
    last: points[points.length - 1]!,
    width,
    height,
    padding: PAD,
  };
}

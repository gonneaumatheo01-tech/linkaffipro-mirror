/** Phase 27, chantier B : petits calculs de l'analyse (purs). */
import { mean, median } from "../../algo/math";

export { mean, median };

/** Quantile par interpolation linéaire (méthode usuelle des tableurs : position (n − 1) × p). */
export function quantile(values: readonly number[], p: number): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo]! + (v[hi]! - v[lo]!) * (pos - lo);
}

/** Écart-type de population (division par n). */
export function stdev(values: readonly number[]): number | null {
  const m = mean(values);
  if (m === null) return null;
  return Math.sqrt(values.reduce((s, x) => s + (x - m) ** 2, 0) / values.length);
}

/** Coefficient de corrélation de Pearson (null si moins de 2 couples ou une série constante). */
export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const mx = mean(xs.slice(0, n))!;
  const my = mean(ys.slice(0, n))!;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

export function roundTo(n: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Part en % (arrondie à l'unité) ; 0 si aucun post. */
export function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

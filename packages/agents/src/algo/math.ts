/** Petits calculs communs de l'équipe Algorithme (purs). */

export function median(values: readonly number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

export function mean(values: readonly number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

/** Variance d'échantillon (n − 1). */
export function variance(values: readonly number[]): number | null {
  const m = mean(values);
  if (m === null || values.length < 2) return null;
  return values.reduce((s, x) => s + (x - m) ** 2, 0) / (values.length - 1);
}

export function ratio(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

export function round(n: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Évolution en % de `before` à `after` (null si la base est nulle). */
export function changePct(before: number, after: number): number | null {
  return before > 0 ? ((after - before) / before) * 100 : null;
}

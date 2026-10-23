/**
 * Tests statistiques des tests A/B (purs) : comparaison de deux proportions (test z, variance groupée) et de deux
 * moyennes (test t de Welch), bilatéraux. Lois normale et de Student calculées ici (aucune dépendance).
 */

/** Fonction d'erreur (Abramowitz et Stegun 7.1.26, erreur < 1,5e-7). */
function erf(x: number): number {
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

/** Fonction de répartition de la loi normale centrée réduite. */
export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function logGamma(x: number): number {
  // Lanczos (g = 7, n = 9).
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const xx = x - 1;
  let a = c[0]!;
  const t = xx + 7.5;
  for (let i = 1; i < 9; i++) a += c[i]! / (xx + i);
  return 0.5 * Math.log(2 * Math.PI) + (xx + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Fraction continue de la bêta incomplète (Numerical Recipes, betacf). */
function betacf(a: number, b: number, x: number): number {
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Bêta incomplète régularisée I_x(a, b). */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** p bilatéral d'une statistique t à `df` degrés de liberté. */
export function studentTwoSidedP(t: number, df: number): number {
  if (!Number.isFinite(t)) return 0;
  return incompleteBeta(df / (df + t * t), df / 2, 0.5);
}

export type TestResult = { stat: number; p: number; diff: number };

/** Deux proportions x1/n1 et x2/n2 (test z, variance groupée). `diff` = p1 − p2. */
export function twoProportionTest(x1: number, n1: number, x2: number, n2: number): TestResult | null {
  if (n1 <= 0 || n2 <= 0) return null;
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const pool = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pool * (1 - pool) * (1 / n1 + 1 / n2));
  if (se === 0) return { stat: 0, p: 1, diff: p1 - p2 };
  const z = (p1 - p2) / se;
  return { stat: z, p: 2 * (1 - normalCdf(Math.abs(z))), diff: p1 - p2 };
}

/** Deux moyennes (test t de Welch). `diff` = moyenne A − moyenne B. */
export function twoMeanTest(a: readonly number[], b: readonly number[]): TestResult | null {
  if (a.length < 2 || b.length < 2) return null;
  const m = (v: readonly number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const va = (v: readonly number[], mu: number) => v.reduce((s, x) => s + (x - mu) ** 2, 0) / (v.length - 1);
  const ma = m(a);
  const mb = m(b);
  const sa = va(a, ma) / a.length;
  const sb = va(b, mb) / b.length;
  const se = Math.sqrt(sa + sb);
  if (se === 0) return { stat: 0, p: ma === mb ? 1 : 0, diff: ma - mb };
  const t = (ma - mb) / se;
  const df = (sa + sb) ** 2 / (sa ** 2 / (a.length - 1) + sb ** 2 / (b.length - 1));
  return { stat: t, p: studentTwoSidedP(t, df), diff: ma - mb };
}

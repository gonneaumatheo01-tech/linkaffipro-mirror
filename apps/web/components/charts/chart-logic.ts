/**
 * Graphiques maison (SVG, sans bibliothèque) : échelles, tracés, repères, valeurs et texte alternatif.
 * Fonctions pures, sans React ni DOM : testées dans chart-logic.test.ts (environnement node).
 * Règles visuelles : docs/DESIGN-SYSTEM.md (jetons du thème, ligne 2 px, barres ≤ 24 px à bout arrondi de 4 px,
 * grille en traits fins pleins, zéro toujours visible quand des valeurs sont négatives).
 */
import { exactMoney, groupMoney, groupMoneyDigits } from "@/lib/campaigns/cards";
import { fmtNum } from "@/lib/format";

/** Nature des valeurs : nombre (compte), montant en euros, rapport (« 1,80× »). */
export type ChartFormat = "number" | "money" | "ratio";

export type Point = { x: number; y: number };
export type PlotBox = { left: number; right: number; top: number; bottom: number };
export type Ticks = { min: number; max: number; ticks: number[] };

const EPS = 1e-9;

function clean(n: number): number {
  // Évite « 0,30000000000000004 » et « −0 ».
  const r = Number(n.toFixed(10));
  return Object.is(r, -0) ? 0 : r;
}

/**
 * Pas « rond » d'un axe (1, 2, 2,5, 5 × 10ⁿ) pour couvrir `span` en environ `target` intervalles.
 * `integer` : jamais de pas décimal (des membres, des clics), et pas de 2,5.
 */
export function niceStep(span: number, target = 4, integer = false): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const raw = span / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const steps = integer && mag < 10 ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  const nice = steps.find((s) => norm <= s + EPS) ?? 10;
  const step = clean(nice * mag);
  return integer ? Math.max(1, Math.round(step)) : step;
}

/**
 * Graduations de l'axe vertical : le zéro est toujours compris (barres et surfaces partent de zéro), bornes
 * arrondies au pas. Série vide ou nulle : 0 à 1.
 */
export function niceTicks(values: readonly number[], target = 4, integer = false): Ticks {
  let lo = 0;
  let hi = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (hi - lo < EPS) hi = lo + 1;
  const step = niceStep(hi - lo, target, integer);
  const min = clean(Math.floor(lo / step + EPS) * step);
  const max = clean(Math.ceil(hi / step - EPS) * step);
  const ticks: number[] = [];
  const count = Math.round((max - min) / step);
  for (let k = 0; k <= count; k++) ticks.push(clean(min + k * step));
  return { min, max, ticks };
}

/** Zone de tracé dans un dessin de `width` × `height` px, une fois retirées les marges (axes, libellés). */
export function plotBox(
  width: number,
  height: number,
  pad: { left: number; right: number; top: number; bottom: number },
): PlotBox {
  const left = Math.min(pad.left, width);
  const top = Math.min(pad.top, height);
  return {
    left,
    top,
    right: Math.max(left, width - pad.right),
    bottom: Math.max(top, height - pad.bottom),
  };
}

/**
 * Abscisse du point `i` sur `n` : `point` (courbe) va du bord gauche au bord droit ; `band` (barres) place chaque
 * valeur au milieu de sa bande. Un seul point : au milieu.
 */
export function xAt(i: number, n: number, box: PlotBox, mode: "point" | "band" = "point"): number {
  const w = box.right - box.left;
  if (n <= 0) return box.left;
  if (mode === "band") return box.left + ((i + 0.5) * w) / n;
  if (n === 1) return box.left + w / 2;
  return box.left + (i * w) / (n - 1);
}

/** Ordonnée d'une valeur (la plus haute en haut). */
export function yAt(v: number, ticks: Ticks, box: PlotBox): number {
  const span = ticks.max - ticks.min || 1;
  return box.bottom - ((v - ticks.min) / span) * (box.bottom - box.top);
}

/** Points d'une série (valeurs non finies comptées comme 0). */
export function seriesPoints(
  values: readonly number[],
  ticks: Ticks,
  box: PlotBox,
  mode: "point" | "band" = "point",
): Point[] {
  return values.map((v, i) => ({
    x: round1(xAt(i, values.length, box, mode)),
    y: round1(yAt(Number.isFinite(v) ? v : 0, ticks, box)),
  }));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function n1(v: number): string {
  return String(round1(v));
}

/** Tracé de la courbe (attribut `d`) ; vide sous deux points. */
export function linePath(points: readonly Point[]): string {
  if (points.length < 2) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${n1(p.x)},${n1(p.y)}`).join("");
}

/** Surface sous la courbe, refermée sur la ligne du zéro (`baseY`). */
export function areaPath(points: readonly Point[], baseY: number): string {
  const line = linePath(points);
  if (!line) return "";
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return `${line}L${n1(last.x)},${n1(baseY)}L${n1(first.x)},${n1(baseY)}Z`;
}

/** Largeur d'une barre : 70 % de sa bande, entre 2 et 24 px (jamais une bande pleine). */
export function barWidth(band: number, max = 24): number {
  return round1(Math.max(2, Math.min(max, band * 0.7)));
}

/**
 * Barre verticale centrée sur `cx`, de la ligne du zéro (`zeroY`) à la valeur (`valueY`) : bout arrondi (4 px au
 * plus) côté valeur, angles droits sur la ligne du zéro ; vers le bas pour une valeur négative. Vide si nulle.
 */
export function barPath(
  cx: number,
  width: number,
  zeroY: number,
  valueY: number,
  radius = 4,
): string {
  const h = Math.abs(zeroY - valueY);
  if (h < 0.5) return "";
  const x0 = cx - width / 2;
  const x1 = cx + width / 2;
  const r = Math.min(radius, width / 2, h);
  if (valueY < zeroY) {
    // Vers le haut : arrondi en haut.
    return `M${n1(x0)},${n1(zeroY)}V${n1(valueY + r)}Q${n1(x0)},${n1(valueY)} ${n1(x0 + r)},${n1(valueY)}H${n1(x1 - r)}Q${n1(x1)},${n1(valueY)} ${n1(x1)},${n1(valueY + r)}V${n1(zeroY)}Z`;
  }
  // Vers le bas : arrondi en bas.
  return `M${n1(x0)},${n1(zeroY)}V${n1(valueY - r)}Q${n1(x0)},${n1(valueY)} ${n1(x0 + r)},${n1(valueY)}H${n1(x1 - r)}Q${n1(x1)},${n1(valueY)} ${n1(x1)},${n1(valueY - r)}V${n1(zeroY)}Z`;
}

/**
 * Libellés de l'axe horizontal : au plus `max`, régulièrement espacés, le premier et le dernier toujours montrés.
 */
export function xLabelIndices(n: number, max: number): number[] {
  if (n <= 0) return [];
  const cap = Math.max(1, Math.floor(max));
  if (n <= cap) return Array.from({ length: n }, (_, i) => i);
  if (cap === 1) return [n - 1];
  const every = Math.ceil((n - 1) / (cap - 1));
  const out: number[] = [];
  for (let i = 0; i < n - 1; i += every) out.push(i);
  // Le dernier : remplace l'avant-dernier s'il est trop près.
  if (out.length > 1 && n - 1 - out[out.length - 1]! < every * 0.75) out.pop();
  out.push(n - 1);
  return out;
}

/** Index de la valeur la plus proche d'une abscisse du pointeur (réticule, bulle). */
export function nearestIndex(
  px: number,
  n: number,
  box: PlotBox,
  mode: "point" | "band" = "point",
): number {
  if (n <= 1) return 0;
  const w = box.right - box.left || 1;
  const t = (px - box.left) / w;
  const i = mode === "band" ? Math.floor(t * n) : Math.round(t * (n - 1));
  return Math.min(n - 1, Math.max(0, i));
}

/**
 * La bulle se ferme-t-elle quand le pointeur quitte le graphique ? Oui pour la souris seulement : au toucher, lever
 * le doigt envoie aussi « pointerleave » (spécification Pointer Events) ; la bulle reste alors jusqu'au prochain
 * appui, dans le graphique ou ailleurs sur la page.
 */
export function closesOnPointerLeave(pointerType: string): boolean {
  return pointerType === "mouse";
}

/**
 * Position horizontale de la bulle : à droite du réticule, ou à gauche s'il n'y a pas la place, toujours dans le
 * cadre du graphique.
 */
export function tooltipLeft(
  x: number,
  tooltipWidth: number,
  containerWidth: number,
  gap = 12,
): number {
  const right = x + gap;
  if (right + tooltipWidth <= containerWidth) return Math.round(right);
  const left = x - gap - tooltipWidth;
  if (left >= 0) return Math.round(left);
  return Math.round(Math.max(0, containerWidth - tooltipWidth));
}

/** Marge gauche pour les graduations (environ 7 px par caractère en 12 px, plus l'espace avant l'axe). */
export function axisMargin(labels: readonly string[], charPx = 7, gap = 10): number {
  const longest = labels.reduce((m, l) => Math.max(m, l.length), 0);
  return Math.ceil(longest * charPx + gap);
}

// ——— Valeurs ———

/** Rapport au format français : « 1,80× » (jamais « 1.80× ») ; « — » si absent. */
export function fmtTimes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  // Vrai signe moins (commissions négatives après une annulation) ; jamais « −0,00× ».
  const s = n.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "negative",
  });
  return `${s.replace(/^-/, "\u2212")}×`;
}

/** Valeur affichée (bulle, tableau, texte alternatif) : entiers séparés à la française, euros, rapports. */
export function formatValue(v: number | null | undefined, format: ChartFormat): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (format === "money") return groupMoney(v, groupMoneyDigits([v]));
  if (format === "ratio") return fmtTimes(v);
  return fmtNum(Math.round(v * 100) / 100);
}

/** Graduation compacte : « 1 200 », « 12 k », « 1,5 M », « 300 € », « 12 k € », « −50 € ». */
export function formatAxis(v: number, format: ChartFormat): string {
  if (format === "ratio") return `${v.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}×`;
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  let body: string;
  if (abs >= 1_000_000)
    body = `${(abs / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M`;
  else if (abs >= 10_000)
    body = `${(abs / 1_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} k`;
  else body = abs.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  if (format === "money") body = `${body} €`;
  return `${sign}${body}`;
}

/** Montant exact au centime (bulle d'un graphique d'argent). */
export function exactValue(v: number, format: ChartFormat): string {
  return format === "money" ? exactMoney(v) : formatValue(v, format);
}

// ——— Texte alternatif ———

export type SummarySeries = { label: string; values: readonly number[] };

/** Vrai si au moins une valeur est non nulle (sinon : « rien sur cette période »). */
export function hasData(series: ReadonlyArray<{ values: readonly number[] }>): boolean {
  return series.some((s) => s.values.some((v) => Number.isFinite(v) && v !== 0));
}

/**
 * Résumé d'une série pour les lecteurs d'écran et le texte alternatif : total (pour un compte ou un montant),
 * point le plus haut et le plus bas avec leur jour, dernière valeur.
 * Ex. « Membres entrés : 1 240 au total ; le plus haut : 312 le 8 oct. ; le plus bas : 80 le 5 oct. ».
 */
export function seriesSummary(
  s: SummarySeries,
  labels: readonly string[],
  format: ChartFormat,
  opts: { total?: boolean } = {},
): string {
  const vals = s.values.map((v) => (Number.isFinite(v) ? v : 0));
  if (vals.length === 0) return `${s.label} : aucune valeur`;
  if (!vals.some((v) => v !== 0)) return `${s.label} : aucune valeur sur la période`;
  const parts: string[] = [];
  const withTotal = opts.total ?? format !== "ratio";
  if (withTotal) {
    const total = vals.reduce((a, b) => a + b, 0);
    parts.push(`${formatValue(total, format)} au total`);
  }
  if (vals.length > 1) {
    let hi = 0;
    let lo = 0;
    vals.forEach((v, i) => {
      if (v > vals[hi]!) hi = i;
      if (v < vals[lo]!) lo = i;
    });
    parts.push(`le plus haut : ${formatValue(vals[hi]!, format)} le ${labels[hi] ?? ""}`.trim());
    parts.push(`le plus bas : ${formatValue(vals[lo]!, format)} le ${labels[lo] ?? ""}`.trim());
  } else {
    parts.push(`${formatValue(vals[0]!, format)} le ${labels[0] ?? ""}`.trim());
  }
  return `${s.label} : ${parts.join(" ; ")}`;
}

/** Texte alternatif complet d'un graphique : titre, période, puis le résumé de chaque série. */
export function chartAltText(
  title: string,
  series: readonly SummarySeries[],
  labels: readonly string[],
  format: ChartFormat,
  opts: { period?: string; total?: boolean; previousLabels?: readonly string[] } = {},
): string {
  const head = opts.period ? `${title}, ${opts.period}.` : `${title}.`;
  const body = series.map((s, i) =>
    seriesSummary(s, i > 0 && opts.previousLabels ? opts.previousLabels : labels, format, {
      total: opts.total,
    }),
  );
  return [head, ...body.map((b) => (b.endsWith(".") ? b : `${b}.`))].join(" ");
}

// ——— Barres horizontales (parcours, catégories) ———

/** Longueur d'une barre en % de la plus grande (au moins 0,5 % pour qu'une petite valeur reste visible). */
export function barPercent(value: number, max: number): number {
  if (!(value > 0) || !(max > 0)) return 0;
  return Math.max(0.5, Math.min(100, Math.round((value / max) * 1000) / 10));
}

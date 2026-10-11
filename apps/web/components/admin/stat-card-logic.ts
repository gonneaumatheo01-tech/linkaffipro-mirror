/**
 * Règles pures de StatCard (variation et mini-courbe), sans React : testées à part.
 * La variation est un pourcentage déjà calculé (ex. `deltaPct` de lib/dashboard/metrics : 12,5 = +12,5 %).
 */

/** Sens favorable d'un chiffre : « up » (plus c'est haut, mieux c'est), « down » (coûts), « none » (neutre). */
export type Favorable = "up" | "down" | "none";
export type VariationTone = "positive" | "negative" | "neutral";

function rounded(pct: number): number {
  const digits = Math.abs(pct) >= 100 ? 0 : 1;
  const f = 10 ** digits;
  return Math.round(pct * f) / f;
}

function valid(pct: number | null | undefined): pct is number {
  return typeof pct === "number" && Number.isFinite(pct);
}

/**
 * Plafond d'affichage d'une variation : au-delà, « > +999 % » (un « +18 661 % » n'apprend rien de plus et casse la
 * carte). Le calcul ne change pas ; seule la présentation est bornée. Il ne s'applique que sur une base non nulle :
 * depuis 0, la variation s'écrit « nouveau » (`variationBetween`).
 */
export const VARIATION_CAP = 999;

function capped(r: number): boolean {
  return Math.abs(r) > VARIATION_CAP;
}

/**
 * « +12,5 % », « −3 % », « 0 % » ; sans décimale au-delà de 100 % ; « > +999 % » / « < −999 % » au-delà du
 * plafond ; « — » sans comparaison.
 */
export function formatVariation(pct: number | null | undefined): string {
  if (!valid(pct)) return "—";
  const r = rounded(pct);
  if (r === 0) return "0 %";
  if (capped(r)) return r > 0 ? `> +${VARIATION_CAP} %` : `< −${VARIATION_CAP} %`;
  const abs = Math.abs(r).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  return `${r > 0 ? "+" : "−"}${abs} %`;
}

/** Couleur de la variation : verte si favorable, rouge sinon, neutre si nulle, absente ou sans sens. */
export function variationTone(pct: number | null | undefined, favorable: Favorable): VariationTone {
  if (!valid(pct) || favorable === "none") return "neutral";
  const r = rounded(pct);
  if (r === 0) return "neutral";
  const good = favorable === "up" ? r > 0 : r < 0;
  return good ? "positive" : "negative";
}

/**
 * Phrase lue par les lecteurs d'écran : « En hausse de 12,5 % vs hier » ; au-delà du plafond, « En hausse de plus
 * de 999 % vs hier ».
 */
export function variationSummary(pct: number | null | undefined, comparison: string): string {
  if (!valid(pct)) return "Pas de comparaison possible";
  const r = rounded(pct);
  const tail = comparison ? ` ${comparison}` : "";
  if (r === 0) return `Stable${tail}`;
  const direction = r > 0 ? "En hausse" : "En baisse";
  if (capped(r)) return `${direction} de plus de ${VARIATION_CAP} %${tail}`;
  const abs = Math.abs(r).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  return `${direction} de ${abs} %${tail}`;
}

/**
 * Variation prête à afficher, d'après la valeur ET sa base (hier, période précédente). Règle unique des cartes de
 * chiffres (accueil, campagnes, statistiques) :
 * - base non nulle : pourcentage (`pct`), affiché plafonné à ±999 % (`formatVariation`) ;
 * - base nulle, valeur non nulle : « nouveau » (`new`) : un pourcentage depuis 0 n'a pas de sens (« > +999 % ») ;
 * - les deux nulles : rien à afficher (`none`) ;
 * - valeur ou base inconnue, ou pourcentage écarté par la page : « Pas de comparaison possible » (`unknown`).
 */
export type Variation =
  | { kind: "pct"; pct: number }
  | { kind: "new"; direction: "up" | "down" }
  | { kind: "none" }
  | { kind: "unknown" };

/**
 * En dessous d'un demi-centime, une valeur compte comme nulle : elle s'affiche « 0 € » (ou « 0 ») et un pourcentage
 * calculé dessus serait énorme. Sans effet sur les nombres entiers (membres, premiers dépôts…).
 */
export const ZERO_EPSILON = 0.005;

function isZero(v: number): boolean {
  return Math.abs(v) < ZERO_EPSILON;
}

/**
 * Variation de `previous` à `current`. `pct` : pourcentage déjà calculé par la page (ex. `deltaPct`, ou null quand
 * la page l'écarte, comme une base négative) ; absent, il est calculé ici sur la valeur absolue de la base (des gains
 * qui passent de −50 € à +20 € montent : +140 %), à une décimale. La base nulle prime toujours sur `pct`.
 */
export function variationBetween(
  current: number | null | undefined,
  previous: number | null | undefined,
  pct?: number | null,
): Variation {
  if (!valid(current) || !valid(previous)) return { kind: "unknown" };
  if (isZero(previous)) {
    if (isZero(current)) return { kind: "none" };
    return { kind: "new", direction: current > 0 ? "up" : "down" };
  }
  const p =
    pct === undefined ? Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10 : pct;
  if (!valid(p)) return { kind: "unknown" };
  return { kind: "pct", pct: p };
}

/** Texte visible : « +12,5 % », « > +999 % », « nouveau », « — » (pas de comparaison), « » (rien à afficher). */
export function variationLabel(v: Variation): string {
  if (v.kind === "pct") return formatVariation(v.pct);
  if (v.kind === "new") return "nouveau";
  if (v.kind === "none") return "";
  return "—";
}

/** Couleur : celle du pourcentage ; « nouveau » suit le même sens favorable (une dépense qui apparaît est en rouge). */
export function variationToneOf(v: Variation, favorable: Favorable): VariationTone {
  if (v.kind === "pct") return variationTone(v.pct, favorable);
  if (v.kind !== "new" || favorable === "none") return "neutral";
  const good = favorable === "up" ? v.direction === "up" : v.direction === "down";
  return good ? "positive" : "negative";
}

/** Flèche à dessiner : hausse, baisse, stable (« 0 % »), aucune (rien à afficher, pas de comparaison). */
export function variationArrow(v: Variation): "up" | "down" | "flat" | null {
  if (v.kind === "new") return v.direction;
  if (v.kind !== "pct") return null;
  const r = rounded(v.pct);
  return r === 0 ? "flat" : r > 0 ? "up" : "down";
}

/**
 * « rien hier », « rien la période précédente »… d'après la fin de phrase de la comparaison (« vs hier »,
 * « vs période précédente »). Sans comparaison : « rien avant ».
 */
export function nothingBefore(comparison: string): string {
  const rest = comparison.replace(/^\s*vs\.?\s+/i, "").trim();
  if (!rest) return "rien avant";
  if (/^(période|semaine|journée|veille)\b/i.test(rest)) return `rien la ${rest}`;
  if (/^mois\b/i.test(rest)) return `rien le ${rest}`;
  return `rien ${rest}`;
}

/**
 * Phrase des lecteurs d'écran : « En hausse de 12,5 % vs hier », « Nouveau : rien hier », « Pas de comparaison
 * possible » ; vide quand il n'y a rien à afficher.
 */
export function variationSentence(v: Variation, comparison: string): string {
  if (v.kind === "pct") return variationSummary(v.pct, comparison);
  if (v.kind === "new") return `Nouveau : ${nothingBefore(comparison)}`;
  if (v.kind === "none") return "";
  return "Pas de comparaison possible";
}

export type SparklinePath = {
  /** Tracé de la ligne (attribut `d`). */
  line: string;
  /** Surface sous la ligne, fermée sur le bas (attribut `d`). */
  area: string;
  /** Dernier point (repère rond). */
  last: { x: number; y: number };
};

function n(v: number): string {
  return String(Math.round(v * 10) / 10);
}

/**
 * Une mini-courbe mérite d'être dessinée : au moins deux valeurs, dont une non nulle. Une ligne plate à zéro
 * n'apprend rien et ajoute du bruit (période sans activité). Règle unique des cartes de chiffres.
 */
export function hasTrend(values: readonly number[] | null | undefined): values is number[] {
  if (!values) return false;
  const pts = values.filter((v) => Number.isFinite(v));
  return pts.length >= 2 && pts.some((v) => v !== 0);
}

/** La série si elle mérite une mini-courbe (`hasTrend`), rien sinon (pour la prop `trend` d'une carte). */
export function trendOrNone(values: readonly number[] | null | undefined): number[] | undefined {
  return hasTrend(values) ? [...values] : undefined;
}

/**
 * Tracé SVG d'une mini-courbe (sans dépendance) : points répartis de gauche à droite, valeur la plus haute
 * en haut, marge verticale `pad`. Valeurs négatives acceptées ; série plate au milieu ; null sous deux points
 * ou quand toutes les valeurs sont nulles (`hasTrend`).
 */
export function sparklinePath(
  values: readonly number[],
  width: number,
  height: number,
  pad = 2,
): SparklinePath | null {
  if (!hasTrend(values)) return null;
  const pts = values.filter((v) => Number.isFinite(v));
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const step = width / (pts.length - 1);
  const inner = height - 2 * pad;
  const coords = pts.map((v, i) => ({
    x: i * step,
    y: max === min ? height / 2 : pad + (1 - (v - min) / (max - min)) * inner,
  }));
  const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${n(c.x)},${n(c.y)}`).join("");
  const first = coords[0]!;
  const last = coords[coords.length - 1]!;
  const area = `${line}L${n(last.x)},${n(height)}L${n(first.x)},${n(height)}Z`;
  return { line, area, last: { x: Math.round(last.x * 10) / 10, y: Math.round(last.y * 10) / 10 } };
}

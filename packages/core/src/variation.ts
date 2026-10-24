/**
 * Variation d'un chiffre entre deux périodes, RÈGLE UNIQUE du site (cartes, campagnes, statistiques), des rapports
 * Telegram et de l'Agent Ads (phase 24 : extraite du site, comportement inchangé).
 */

/**
 * - base non nulle : pourcentage (`pct`) ;
 * - base nulle, valeur non nulle : « nouveau » (`new`) : un pourcentage depuis 0 n'a pas de sens ;
 * - les deux nulles : rien à afficher (`none`) ;
 * - valeur ou base inconnue, ou pourcentage écarté : « Pas de comparaison possible » (`unknown`).
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

function valid(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function isZero(v: number): boolean {
  return Math.abs(v) < ZERO_EPSILON;
}

/**
 * Variation de `previous` à `current`. `pct` : pourcentage déjà calculé par l'appelant (ou null quand il l'écarte,
 * comme une base négative) ; absent, il est calculé ici sur la valeur absolue de la base (des gains qui passent de
 * −50 € à +20 € montent : +140 %), à une décimale. La base nulle prime toujours sur `pct`.
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

/**
 * Variation affichée d'un chiffre : `variationBetween`, sans pourcentage sur une base négative (passer de −1,74 € à
 * 323 € donnerait « −18 661 % », trompeur) ; valeur absente : pas de comparaison.
 */
export function comparableVariation(
  current: number | null | undefined,
  previous: number | null | undefined,
): Variation {
  return variationBetween(
    current,
    previous,
    typeof previous === "number" && previous < 0 ? null : undefined,
  );
}

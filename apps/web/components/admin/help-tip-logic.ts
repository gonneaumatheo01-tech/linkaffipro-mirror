/**
 * Règles pures des bulles d'aide (`Term`, `HelpTip`), testées à part (environnement de test sans DOM).
 */

/**
 * Éléments interactifs dans lesquels `Term` ne doit pas devenir lui-même un bouton (bouton dans un bouton,
 * dans un lien ou dans un libellé de champ : HTML invalide, clic ambigu). Il reste alors un simple texte,
 * avec le terme technique lu par les lecteurs d'écran.
 */
export const INTERACTIVE_ANCESTORS =
  "a[href],button,label,summary,select,textarea,input,[role=button],[role=link],[role=menuitem],[role=tab],[role=option],[contenteditable=true]";

/** Le minimum d'un élément du DOM dont on a besoin (un faux élément suffit dans les tests). */
export type ClosestCapable = {
  parentElement: { closest(selector: string): unknown } | null;
};

/** Vrai si un ancêtre de l'élément est déjà interactif (bouton, lien, libellé…). */
export function isInsideInteractive(el: ClosestCapable): boolean {
  return Boolean(el.parentElement?.closest(INTERACTIVE_ANCESTORS));
}

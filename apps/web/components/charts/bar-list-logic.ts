/**
 * Règles pures de `BarList` (sans React ni DOM) : colonnes de la grille selon la largeur des noms et la présence de
 * précisions, couleur de chaque barre. Testées dans bar-list-logic.test.ts. La longueur des barres : `barPercent`
 * (chart-logic.ts).
 */

/** Colonne des noms : « wide » (catégories, étapes du parcours) ou « narrow » (« Version A »). */
export type BarLabelWidth = "wide" | "narrow";

/**
 * Grille d'une ligne sur ordinateur (nom | barre | valeur) : avec des précisions sous les valeurs (`note`), la
 * colonne des valeurs est large et alignée à gauche (la valeur suit la barre) ; sans précision, elle prend juste la
 * place des chiffres, alignés à droite. Classes écrites en entier pour que Tailwind les trouve.
 */
export function barListLayout(
  labelWidth: BarLabelWidth,
  hasNotes: boolean,
): { columns: string; valueAlign: string } {
  const columns = {
    "wide-notes": "md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_minmax(0,15rem)]",
    "wide-plain": "md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto]",
    "narrow-notes": "md:grid-cols-[6rem_minmax(0,1fr)_minmax(0,15rem)]",
    "narrow-plain": "md:grid-cols-[6rem_minmax(0,1fr)_auto]",
  } as const;
  return {
    columns: columns[`${labelWidth}-${hasNotes ? "notes" : "plain"}`],
    valueAlign: hasNotes ? "md:text-left" : "",
  };
}

/**
 * Couleur d'une barre : orange de marque, sauf quand une autre ligne est mise en avant (gagnant d'un test A/B) :
 * les lignes non mises en avant passent alors en gris.
 */
export function barTone(emphasis: boolean | undefined, anyEmphasis: boolean): "brand" | "muted" {
  return anyEmphasis && !emphasis ? "muted" : "brand";
}

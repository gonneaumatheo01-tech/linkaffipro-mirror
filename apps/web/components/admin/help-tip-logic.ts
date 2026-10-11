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

/**
 * Cartes rendues entièrement cliquables par un lien « étiré » (le lien du titre porte `after:absolute after:inset-0`) :
 * le lien couvre toute la carte sans être un ancêtre du terme, `isInsideInteractive` ne le voit donc pas.
 * Toute nouvelle carte de ce genre porte `data-stretched-link` ; la carte de campagne est reconnue par son `data-slot`.
 */
export const STRETCHED_LINK_CONTAINERS = "[data-stretched-link],[data-slot=campaign-card]";

/** Vrai si l'élément est dans une carte entièrement cliquable par un lien « étiré ». */
export function isInsideStretchedLink(el: ClosestCapable): boolean {
  return Boolean(el.parentElement?.closest(STRETCHED_LINK_CONTAINERS));
}

/**
 * Rendu d'un `Term` selon sa place :
 * - `text` : dans un bouton, un lien ou un libellé, simple texte (terme en `title` et lu par les lecteurs d'écran) ;
 * - `card` : dans une carte à lien étiré, bulle au survol sur ordinateur, mais sur téléphone le toucher ouvre la
 *   carte (pas de petite cible posée sur le lien de la carte, pas de zone qui mord sur les chiffres voisins) ;
 * - `bubble` : partout ailleurs, bouton avec bulle au survol, au toucher et au focus clavier.
 */
export type TermMode = "text" | "card" | "bubble";

export function termMode(el: ClosestCapable): TermMode {
  if (isInsideInteractive(el)) return "text";
  return isInsideStretchedLink(el) ? "card" : "bubble";
}

/**
 * Zone de toucher d'un `Term` devenu bouton, sur téléphone (cible ≥ 40 px, docs/DESIGN-SYSTEM.md) : un
 * pseudo-élément invisible de 40 px de haut et d'au moins 40 px de large, centré sur le mot. L'allure du mot ne
 * change pas (ni marge, ni hauteur de ligne) ; sur ordinateur, rien n'est ajouté.
 */
export const TERM_TOUCH_TARGET =
  "relative max-md:after:absolute max-md:after:top-1/2 max-md:after:left-1/2 max-md:after:h-10 max-md:after:w-full max-md:after:min-w-10 max-md:after:-translate-x-1/2 max-md:after:-translate-y-1/2";

/**
 * `Term` dans une carte à lien étiré : sur ordinateur, posé au-dessus du lien de la carte (survolable) ; sur
 * téléphone, transparent au toucher (le doigt atteint le lien de la carte, qui ouvre la fiche). Aucune zone ajoutée.
 */
export const TERM_IN_CARD = "md:relative md:z-10 max-md:pointer-events-none";

/** Classes du bouton d'un `Term` selon sa place (`text` n'est pas un bouton). */
export function termTriggerClass(mode: Exclude<TermMode, "text">): string {
  return mode === "card" ? TERM_IN_CARD : TERM_TOUCH_TARGET;
}

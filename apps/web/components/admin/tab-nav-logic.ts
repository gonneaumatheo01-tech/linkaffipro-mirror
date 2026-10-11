/**
 * Règles pures de la barre d'onglets partagée (`TabNav`) : dessin des onglets selon la présentation choisie sur
 * téléphone, libellé court, pastille de nombre. Sans React ni DOM : testées dans tab-nav-logic.test.ts.
 *
 * Ordinateur (≥ 768 px), toujours le même dessin : onglets soulignés, l'onglet ouvert souligné d'orange et en
 * semi-gras ; si la fenêtre est étroite, la rangée défile (dégradé sur le bord, onglet ouvert ramené au centre).
 * Téléphone, deux présentations :
 * - `scroll` : une seule rangée d'onglets soulignés de 40 px qui défile (Statistiques, Journal) ;
 * - `grid` : tous les onglets visibles d'un coup, en boutons bordés d'au moins 44 px sur 2 ou 3 colonnes, libellé
 *   court (`short`) ou sur deux lignes, sans défilement (fiche campagne, fiche canal, Membres).
 * Jamais de fond orange plein : le seul bouton orange de l'écran reste celui du `PageHeader`.
 */

export type TabNavPhoneLayout = "scroll" | "grid";
export type TabNavColumns = 2 | 3;

export type TabNavItem = {
  key: string;
  href: string;
  /** Libellé complet (ordinateur, et téléphone sans `short`). */
  label: string;
  /** Libellé court sur téléphone (« Résumé » pour « Vue d'ensemble »). */
  short?: string;
  /** Nombre à signaler (pastille ambre) ; rien à 0. Le nom accessible doit le dire : voir `ariaLabel`. */
  count?: number | null;
  /** Nom accessible de l'onglet quand le texte visible ne suffit pas (« Demandes, 3 en attente »). */
  ariaLabel?: string;
};

/** Contour de focus clavier, à l'intérieur de l'onglet ; `outline-solid` : visible même à côté d'un `outline-none`. */
const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-ring";

const GRID_COLUMNS: Record<TabNavColumns, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
};

/** Trait sous la barre : partout en rangée qui défile, seulement sur ordinateur en grille. */
export function tabNavBorderClass(phone: TabNavPhoneLayout): string {
  return phone === "grid" ? "md:border-b md:border-border" : "border-b border-border";
}

/** Classes de la liste (`<ul>`, premier enfant de `ScrollFade` : c'est elle qui défile). */
export function tabListClass(phone: TabNavPhoneLayout, columns: TabNavColumns = 2): string {
  return phone === "grid"
    ? `grid ${GRID_COLUMNS[columns]} gap-2 md:-mb-px md:flex md:gap-1 md:overflow-x-auto`
    : "-mb-px flex gap-1 overflow-x-auto";
}

/** Classes d'un élément de la liste (`<li>`). */
export function tabItemClass(phone: TabNavPhoneLayout): string {
  return phone === "grid" ? "min-w-0 md:shrink-0" : "shrink-0";
}

/** Classes du lien d'un onglet. */
export function tabLinkClass(phone: TabNavPhoneLayout, active: boolean): string {
  const base = `inline-flex items-center justify-center gap-2 text-body transition-colors ${FOCUS}`;
  if (phone === "grid") {
    // Téléphone : bouton bordé (44 px, deux lignes au besoin) ; ordinateur : onglet souligné, une ligne.
    const shape =
      "min-h-11 w-full rounded-lg border px-2 py-1 text-center leading-tight md:h-10 md:min-h-0 md:w-auto md:rounded-none md:border-x-0 md:border-t-0 md:border-b-2 md:px-3 md:py-0 md:whitespace-nowrap";
    const state = active
      ? "border-brand bg-brand-soft font-semibold text-foreground md:bg-transparent"
      : "border-border bg-surface text-muted-foreground hover:text-foreground md:border-transparent md:bg-transparent md:hover:border-border";
    return `${base} ${shape} ${state}`;
  }
  const state = active
    ? "border-brand font-semibold text-foreground"
    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground";
  return `${base} h-10 border-b-2 px-3 whitespace-nowrap ${state}`;
}

/** Libellé court du téléphone, seulement s'il diffère du libellé complet (sinon un seul libellé). */
export function tabShortLabel(item: Pick<TabNavItem, "label" | "short">): string | null {
  const short = item.short?.trim();
  return short && short !== item.label ? short : null;
}

/** Nombre à afficher dans la pastille, ou null (absent, nul, négatif ou invalide). */
export function tabCount(item: Pick<TabNavItem, "count">): number | null {
  const n = item.count;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

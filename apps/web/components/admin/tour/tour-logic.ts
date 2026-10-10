/**
 * Visite guidée de la première connexion (logique pure, testée dans tour-logic.test.ts) : étapes, repères dans la page,
 * navigation au clavier et placement de la bulle. Composant : `guided-tour.tsx`.
 *
 * Les repères sont les attributs `data-tour` posés sur les entrées du menu (`nav-<clé>`, voir `navTourId` dans
 * nav-logic.ts), sur « Plus » de la barre du téléphone (`nav-more`) et sur le bouton « ? » de l'en-tête (`help`).
 * Une entrée existe deux fois (barre de menu de l'ordinateur et barre du bas du téléphone, l'une cachée) : on prend
 * la première visible. Sur téléphone, Canaux et Statistiques sont rangés sous « Plus » : la bulle montre « Plus ».
 */

export type TourStep = {
  key: string;
  /** Repères `data-tour` essayés dans l'ordre ; le premier visible est mis en lumière. */
  anchors: readonly string[];
  title: string;
  body: string;
  /** Phrase ajoutée quand le repère trouvé n'est pas le premier (rubrique rangée sous « Plus » sur téléphone). */
  fallbackNote?: string;
};

export const TOUR_STEPS: readonly TourStep[] = [
  {
    key: "home",
    anchors: ["nav-home"],
    title: "Bienvenue sur LinkAffi Pro",
    body: "En deux minutes, voici où trouver chaque chose. L'Accueil vous dit si tout marche : les chiffres du jour et ce qu'il reste à faire.",
  },
  {
    key: "campaigns",
    anchors: ["nav-campaigns"],
    title: "Campagnes",
    body: "Ce que vous promouvez et ce que ça rapporte : vos pubs, leurs liens et leurs offres, réunis par campagne.",
  },
  {
    key: "channels",
    anchors: ["nav-channels", "nav-more"],
    title: "Canaux",
    body: "Vos canaux Telegram : qui peut entrer, quand, et ce que le bot dit aux nouveaux membres.",
    fallbackNote: "Sur téléphone, vous le trouvez sous « Plus ».",
  },
  {
    key: "messages",
    anchors: ["nav-messages"],
    title: "Messages",
    body: "Le calendrier de ce qui part dans vos canaux, et quand. Un message programmé part tout seul à l'heure dite.",
  },
  {
    key: "members",
    anchors: ["nav-members"],
    title: "Membres",
    body: "Qui sont vos membres et d'où ils viennent. C'est aussi ici que vous écrivez à un groupe et réglez les relances automatiques.",
  },
  {
    key: "stats",
    anchors: ["nav-stats", "nav-more"],
    title: "Statistiques",
    body: "Le détail des chiffres : pubs, parcours des membres, canaux et membres dans le temps.",
    fallbackNote: "Sur téléphone, vous les trouvez sous « Plus ».",
  },
  {
    key: "help",
    anchors: ["help"],
    title: "Une question ?",
    body: "Ce bouton ouvre l'aide de la page où vous êtes. Vous pouvez revoir cette visite à tout moment depuis l'aide ou les Réglages.",
  },
];

/** Sélecteur CSS d'un repère. */
export function tourSelector(anchor: string): string {
  return `[data-tour="${anchor}"]`;
}

/** Premier repère visible parmi les candidats ; `fallback` : ce n'est pas le premier de la liste. */
export function pickAnchor(
  anchors: readonly string[],
  isVisible: (anchor: string) => boolean,
): { anchor: string; fallback: boolean } | null {
  const i = anchors.findIndex((a) => isVisible(a));
  return i < 0 ? null : { anchor: anchors[i]!, fallback: i > 0 };
}

/** « Étape 2 sur 7 ». */
export function stepLabel(index: number, total: number): string {
  return `Étape ${index + 1} sur ${total}`;
}

export function isLastStep(index: number, total: number): boolean {
  return index >= total - 1;
}

export type TourCommand = "next" | "prev" | "skip" | "finish";

/** Touche du clavier → commande (Échap passe la visite ; flèches droite / gauche : suivante / précédente). */
export function keyCommand(key: string, index: number, total: number): TourCommand | null {
  if (key === "Escape") return "skip";
  if (key === "ArrowRight") return isLastStep(index, total) ? null : "next";
  if (key === "ArrowLeft") return index > 0 ? "prev" : null;
  return null;
}

/** Étape suivante après une commande ; null = visite finie (terminée ou passée). */
export function applyCommand(index: number, total: number, command: TourCommand): number | null {
  if (command === "skip" || command === "finish") return null;
  if (command === "prev") return Math.max(0, index - 1);
  return isLastStep(index, total) ? null : index + 1;
}

export type Rect = { top: number; left: number; width: number; height: number };
export type Size = { width: number; height: number };
export type Placement = "right" | "left" | "bottom" | "top" | "center";

/** Largeur d'écran sous laquelle on se comporte comme sur téléphone (même seuil que `md:`). */
export const PHONE_MAX_WIDTH = 768;
const MARGIN = 12;
const GAP = 12;

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), Math.max(min, max));
}

/** Zone mise en lumière : le repère agrandi de `pad` pixels, gardée dans l'écran. */
export function spotlightRect(anchor: Rect, viewport: Size, pad = 6): Rect {
  const left = clamp(anchor.left - pad, 2, viewport.width - 2);
  const top = clamp(anchor.top - pad, 2, viewport.height - 2);
  const right = clamp(anchor.left + anchor.width + pad, 2, viewport.width - 2);
  const bottom = clamp(anchor.top + anchor.height + pad, 2, viewport.height - 2);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * Position de la bulle (coin haut gauche, en pixels de la fenêtre) :
 * - sans repère : au centre ;
 * - téléphone : pleine largeur (marges de 12 px), au-dessus du repère s'il est dans la moitié basse (barre du bas),
 *   sinon en dessous (bouton « ? » de l'en-tête) ;
 * - ordinateur : à droite du repère (barre de menu à gauche), sinon en dessous, au-dessus, à gauche ; un repère dans
 *   la moitié droite de l'écran (bouton « ? ») prend la bulle en dessous d'abord ; toujours gardée dans l'écran.
 */
export function placeBubble(
  anchor: Rect | null,
  bubble: Size,
  viewport: Size,
): { top: number; left: number; placement: Placement } {
  const maxLeft = viewport.width - bubble.width - MARGIN;
  const maxTop = viewport.height - bubble.height - MARGIN;
  if (!anchor)
    return {
      top: clamp((viewport.height - bubble.height) / 2, MARGIN, maxTop),
      left: clamp((viewport.width - bubble.width) / 2, MARGIN, maxLeft),
      placement: "center",
    };
  const centerX = anchor.left + anchor.width / 2;
  const centerY = anchor.top + anchor.height / 2;

  if (viewport.width < PHONE_MAX_WIDTH) {
    const left = clamp(centerX - bubble.width / 2, MARGIN, maxLeft);
    if (centerY > viewport.height / 2)
      return {
        top: clamp(anchor.top - GAP - bubble.height, MARGIN, maxTop),
        left,
        placement: "top",
      };
    return {
      top: clamp(anchor.top + anchor.height + GAP, MARGIN, maxTop),
      left,
      placement: "bottom",
    };
  }

  const right = {
    fits: anchor.left + anchor.width + GAP + bubble.width + MARGIN <= viewport.width,
    top: clamp(centerY - bubble.height / 2, MARGIN, maxTop),
    left: anchor.left + anchor.width + GAP,
    placement: "right" as const,
  };
  const below = {
    fits: anchor.top + anchor.height + GAP + bubble.height + MARGIN <= viewport.height,
    top: anchor.top + anchor.height + GAP,
    left: clamp(anchor.left + anchor.width - bubble.width, MARGIN, maxLeft),
    placement: "bottom" as const,
  };
  const above = {
    fits: anchor.top - GAP - bubble.height >= MARGIN,
    top: anchor.top - GAP - bubble.height,
    left: clamp(anchor.left + anchor.width - bubble.width, MARGIN, maxLeft),
    placement: "top" as const,
  };
  // Repère dans la moitié droite (bouton « ? » de l'en-tête) : en dessous d'abord, sans masquer le menu du compte.
  const order = centerX > viewport.width / 2 ? [below, above, right] : [right, below, above];
  const chosen = order.find((o) => o.fits);
  if (chosen) return { top: chosen.top, left: chosen.left, placement: chosen.placement };
  return {
    top: clamp(centerY - bubble.height / 2, MARGIN, maxTop),
    left: clamp(anchor.left - GAP - bubble.width, MARGIN, maxLeft),
    placement: "left",
  };
}

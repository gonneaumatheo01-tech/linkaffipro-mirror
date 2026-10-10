import type { Vertical } from "@linkaffipro/core";

/**
 * Univers d'affiliation à l'écran : libellés du client et couleurs (docs/DESIGN-SYSTEM.md, « Univers »).
 * Une couleur d'univers s'affiche toujours en pastille, en bordure fine ou en étiquette, jamais en fond plein.
 * Fichier sans dépendance serveur : utilisable dans les composants client.
 */
export const UNIVERSES = ["CASINO", "SPORTS", "DATING"] as const satisfies readonly Vertical[];
export type Universe = (typeof UNIVERSES)[number];

export const UNIVERSE_LABELS: Record<Universe, string> = {
  CASINO: "Casino",
  SPORTS: "Paris sportifs",
  DATING: "Rencontres",
};

export type UniverseClasses = {
  /** Fond de la pastille ronde (petit point). */
  dot: string;
  /** Texte coloré lisible sur fond clair (contraste AA). */
  ink: string;
  /** Bordure fine d'une étiquette. */
  border: string;
};

// Classes écrites en entier pour que Tailwind les détecte.
const CLASSES: Record<Universe, UniverseClasses> = {
  CASINO: { dot: "bg-casino", ink: "text-casino-ink", border: "border-casino/40" },
  SPORTS: { dot: "bg-sports", ink: "text-sports-ink", border: "border-sports/40" },
  DATING: { dot: "bg-dating", ink: "text-dating-ink", border: "border-dating/40" },
};

const NONE: UniverseClasses = {
  dot: "bg-muted-foreground/50",
  ink: "text-muted-foreground",
  border: "border-border",
};

/** Couleur CSS de chaque univers (graphiques SVG) : variables du thème. */
export const UNIVERSE_CSS_VARS: Record<Universe, string> = {
  CASINO: "var(--universe-casino)",
  SPORTS: "var(--universe-sports)",
  DATING: "var(--universe-dating)",
};

/** Univers à partir d'une valeur quelconque (« CASINO », « casino », « Sports »…) ; null sinon. */
export function toUniverse(value: unknown): Universe | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toUpperCase();
  return (UNIVERSES as readonly string[]).includes(v) ? (v as Universe) : null;
}

/** Libellé affiché ; « Sans univers » si la valeur est absente ou inconnue. */
export function universeLabel(value: unknown): string {
  const u = toUniverse(value);
  return u ? UNIVERSE_LABELS[u] : "Sans univers";
}

/** Classes de pastille, de texte et de bordure ; gris neutre sans univers. */
export function universeClasses(value: unknown): UniverseClasses {
  const u = toUniverse(value);
  return u ? CLASSES[u] : NONE;
}

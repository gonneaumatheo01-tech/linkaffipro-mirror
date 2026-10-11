/** Galerie de modèles (vue Modèles de la page Messages) : fonctions pures, testées dans templates.test.ts. */
import type { PostButton } from "./buttons";

/**
 * Titre d'une carte : les modèles de la bibliothèque s'appellent « Univers · Thème · titre » ; l'univers et le thème
 * sont déjà affichés en pastilles, la carte ne garde que le titre. Un autre nom est rendu tel quel.
 */
export function templateCardTitle(name: string): string {
  const parts = name.split(" · ");
  return parts.length >= 3 ? parts.slice(2).join(" · ") : name.trim() || "Modèle sans nom";
}

/** Adresse de la galerie avec ses filtres (univers, thème, catégorie) ; les vides sont omis. */
export function templatesHref(f: {
  vertical?: string;
  theme?: string;
  categoryId?: string;
}): string {
  const p = new URLSearchParams({ view: "templates" });
  if (f.vertical) p.set("vertical", f.vertical);
  if (f.theme) p.set("theme", f.theme);
  if (f.categoryId) p.set("category", f.categoryId);
  return `/messages?${p.toString()}`;
}

/**
 * Boutons « Offre (campagne) » d'un modèle dont la campagne reste à choisir : les modèles fournis en ont un, sans
 * campagne, et un nouveau message exige la sienne (`lib/campaigns/offer-button.ts`). La carte le dit à l'avance.
 */
export function offerButtonsToChoose(rows: ReadonlyArray<ReadonlyArray<PostButton>>): number {
  return rows.flat().filter((b) => b.type === "OFFER" && !b.campaignId).length;
}

/**
 * Règles pures du sélecteur d'emojis animés de l'éditeur (testées dans picker-logic.test.ts) : onglets (récents de
 * l'équipe, puis un par pack), recherche, déplacement au clavier dans la grille et dans les onglets.
 */
import {
  groupByPack,
  packLabel,
  recentEmojis,
  searchEmojis,
  type PickerEmoji,
} from "@/lib/custom-emoji/library";

/** Onglet « Récents de l'équipe » (les emojis utilisés dernièrement dans un texte enregistré). */
export const RECENT_TAB = "__recent";
/** Onglet des emojis dont le pack n'est pas connu. */
export const NO_PACK_TAB = "__none";
/** Colonnes de la grille (40 px chacune : 8 tiennent dans la fenêtre, téléphone compris). */
export const GRID_COLUMNS = 8;

export type PickerTab = { key: string; label: string; count: number };

/** Onglets : « Récents de l'équipe » s'il y en a, puis un par pack (ordre alphabétique), sans pack en dernier. */
export function pickerTabs(items: readonly PickerEmoji[]): PickerTab[] {
  const tabs: PickerTab[] = [];
  const recent = recentEmojis(items);
  if (recent.length > 0)
    tabs.push({ key: RECENT_TAB, label: "Récents de l'équipe", count: recent.length });
  for (const g of groupByPack(items))
    tabs.push({ key: g.key || NO_PACK_TAB, label: g.label, count: g.items.length });
  return tabs;
}

/** Emojis d'un onglet ; avec une recherche, tous les emojis qui y répondent (les onglets ne comptent plus). */
export function pickerItems(
  items: readonly PickerEmoji[],
  tab: string,
  query: string,
): PickerEmoji[] {
  if (query.trim()) return searchEmojis(items, query);
  if (tab === RECENT_TAB) return recentEmojis(items);
  const group = groupByPack(items).find((g) => (g.key || NO_PACK_TAB) === tab);
  return group ? group.items : [];
}

/** Onglet ouvert au départ : le dernier ouvert s'il existe encore, sinon le premier. */
export function initialTab(tabs: readonly PickerTab[], last: string | null): string {
  if (last && tabs.some((t) => t.key === last)) return last;
  return tabs[0]?.key ?? RECENT_TAB;
}

/** Nom lu par les lecteurs d'écran pour un emoji de la grille. */
export function emojiButtonLabel(e: PickerEmoji): string {
  return `Emoji animé ${e.fallback} (${packLabel(e)})`;
}

/**
 * Déplacement au clavier dans la grille : flèches (haut et bas d'une ligne), Début / Fin (premier, dernier),
 * Page précédente / suivante (4 lignes). Renvoie le nouvel indice, `-1` pour remonter au champ de recherche (flèche
 * haut sur la première ligne), ou null si la touche ne concerne pas la grille.
 */
export function gridMove(
  current: number,
  key: string,
  count: number,
  columns: number = GRID_COLUMNS,
): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  switch (key) {
    case "ArrowRight":
      return Math.min(current + 1, last);
    case "ArrowLeft":
      return Math.max(current - 1, 0);
    case "ArrowDown":
      return current + columns <= last ? current + columns : current;
    case "ArrowUp":
      return current - columns >= 0 ? current - columns : -1;
    case "Home":
      return 0;
    case "End":
      return last;
    case "PageDown":
      return Math.min(current + columns * 4, last);
    case "PageUp":
      return Math.max(current - columns * 4, 0);
    default:
      return null;
  }
}

/** Déplacement dans la barre d'onglets (flèches gauche / droite en boucle, Début, Fin), ou null. */
export function tabMove(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

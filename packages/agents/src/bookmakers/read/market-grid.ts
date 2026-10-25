/**
 * Phase 35 (suite) — MARCHÉS EN GRILLE. Sur les widgets modernes (Betby), un marché « Total » s'affiche en tableau :
 * des en-têtes de colonne (« plus de », « moins de ») puis des cases qui ne portent que la ligne (« 3.5 ») et la cote.
 * Lu case par case, le libellé serait « 3.5 » pour les deux colonnes : ambigu, et faux. Ici, pour une sélection dont le
 * libellé n'est qu'un nombre (ou vide), on retrouve le bloc du marché, ses en-têtes de colonne (textes courts, sans
 * cote, avant la première sélection, hors titre du marché) et la colonne de la case (rang modulo le nombre de
 * colonnes) : le libellé devient « plus de 3.5 ». Même règle pour la lecture par recette et pour la référence de la
 * validation (les deux chemins doivent dire la même chose). Règles pures sur l'arbre HTML.
 */
import { descendants, textOf, type HtmlNode } from "./html";

/** Texte qui n'est qu'une cote (même règle que `learn/page-odds`, recopiée pour éviter un import circulaire). */
const ODDS_ONLY = /^\s*(\d{1,3}[.,]\d{1,3}|\d{1,4}\s*\/\s*\d{1,4}|[+-]\d{3,4}|evs|evens)\s*$/i;

/** Libellé réduit à un nombre, une ligne (« 3.5 », « -1,5 », « +2 ») ou rien. */
export const NUMERIC_LABEL = /^\s*[+-]?\d{1,3}([.,]\d{1,2})?\s*$/;

function isAncestor(a: HtmlNode, b: HtmlNode): boolean {
  for (let p = b.parent; p; p = p.parent) if (p === a) return true;
  return false;
}

/**
 * Bloc d'un marché pour une sélection : le plus proche ancêtre qui contient au moins deux sélections ET un texte
 * hors sélections (les en-têtes), sans contenir un titre de marché autre que le premier rencontré. Pur.
 */
function marketBlockOf(sel: HtmlNode, sels: readonly HtmlNode[], titles: readonly HtmlNode[]): HtmlNode | null {
  for (let p = sel.parent; p && p.tag !== "#root" && p.tag !== "body"; p = p.parent) {
    const inside = sels.filter((s) => isAncestor(p!, s));
    if (inside.length < 2) continue;
    const titlesInside = titles.filter((t) => isAncestor(p!, t));
    // Un bloc qui englobe plusieurs marchés (plusieurs titres) est trop large.
    if (titlesInside.length > 1) return null;
    return p;
  }
  return null;
}

/** Feuilles de texte d'un bloc, dans l'ordre, hors sélections et hors titres. */
function headerLeaves(block: HtmlNode, sels: readonly HtmlNode[], titles: readonly HtmlNode[]): HtmlNode[] {
  const out: HtmlNode[] = [];
  for (const n of descendants(block)) {
    if (n.children.some((c) => c.tag !== "#text")) continue;
    const t = textOf(n);
    if (!t || t.length > 30 || ODDS_ONLY.test(t) || NUMERIC_LABEL.test(t)) continue;
    if (sels.some((s) => s === n || isAncestor(s, n))) continue;
    if (titles.some((x) => x === n || isAncestor(x, n) || isAncestor(n, x))) continue;
    out.push(n);
  }
  return out;
}

/**
 * Libellé complet d'une sélection d'un marché en grille (« plus de 3.5 »), ou null si la sélection n'est pas dans une
 * grille (libellé déjà parlant, pas d'en-têtes, colonnes incohérentes). `label` : libellé lu (sans la cote). Pur.
 */
export function gridLabelFor(sel: HtmlNode, label: string, sels: readonly HtmlNode[], titles: readonly HtmlNode[]): string | null {
  if (!NUMERIC_LABEL.test(label) && label.trim() !== "") return null;
  const block = marketBlockOf(sel, sels, titles);
  if (!block) return null;
  const cells = sels.filter((s) => isAncestor(block, s));
  const firstCell = cells[0]!;
  const headers = headerLeaves(block, sels, titles).filter((h) => h.order < firstCell.order);
  if (headers.length < 2 || headers.length > 6 || cells.length % headers.length !== 0) return null;
  const i = cells.indexOf(sel);
  if (i < 0) return null;
  const header = textOf(headers[i % headers.length]!);
  return `${header} ${label.trim()}`.trim();
}

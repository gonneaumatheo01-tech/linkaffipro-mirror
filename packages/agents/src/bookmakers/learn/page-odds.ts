/**
 * Phase 35 (chantier B) — cotes LUES SUR LA PAGE pendant l'enregistrement (`SiteRecording.pageOdds`), sans recette :
 * référence indépendante pour valider une recette (comparaison API ↔ page). Règles pures, sur le HTML affiché (les
 * éléments cachés — onglet fermé, `hidden`, `display:none` — ne comptent pas, comme à l'écran) :
 * - une cote = un élément feuille dont le texte n'est qu'une cote (« 1,85 », « 2.10 », « 5/4 », « +150 », « EVS ») ;
 * - sa ligne de sélection = le premier ancêtre qui affiche autre chose que des cotes ; la cote retenue est la DERNIÈRE
 *   de la ligne (les autres nombres, comme une ligne « 2.5 », font partie du libellé) ;
 * - son marché = le titre de marché qui précède la ligne dans la page (titre h2-h6 / rôle « heading », sinon un élément
 *   dont la classe dit titre / nom de marché) ; jamais le titre du match (h1) ;
 * - la ligne (2,5 ; -1,5) = nombre à virgule ou signé du libellé, sinon du titre du marché.
 * La page est une DONNÉE : rien de ce qu'elle dit n'est exécuté.
 */
import { toDecimalOdds } from "../read/odds-format";
import { descendants, foldText, parseHtml, textOf, type HtmlNode } from "../read/html";
import type { SiteRecording } from "../contract";

export type PageOdd = SiteRecording["pageOdds"][number];

/** Texte qui n'est qu'une cote. */
export const ODDS_ONLY = /^\s*(\d{1,3}[.,]\d{1,3}|\d{1,4}\s*\/\s*\d{1,4}|[+-]\d{3,4}|evs|evens)\s*$/i;

/** Cote affichée → décimale exacte (format reconnu à sa forme). */
export function parseDisplayedOdds(raw: string): number | null {
  const t = raw.trim();
  if (/^\d{1,4}\s*\/\s*\d{1,4}$/.test(t) || /^(evs|evens)$/i.test(t)) return toDecimalOdds(t, "fractional");
  if (/^[+-]\d{3,4}$/.test(t)) return toDecimalOdds(t, "american");
  return toDecimalOdds(t, "decimal");
}

/** Ligne d'un libellé : nombre à virgule (« 2,5 ») ou signé (« -1 »), le dernier ; sinon null. */
export function lineInText(s: string): number | null {
  const all = [...s.replace(/\s+/g, " ").matchAll(/(?:^|[\s(])([+-]?\d{1,3}[.,]\d{1,2}|[+-]\d{1,2})(?=$|[\s)])/g)];
  const last = all[all.length - 1];
  if (!last) return null;
  const n = Number(last[1]!.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function isHiddenNode(n: HtmlNode): boolean {
  for (let p: HtmlNode | null = n; p; p = p.parent) {
    if (p.attrs.hidden !== undefined || p.attrs["aria-hidden"] === "true" || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(p.attrs.style ?? "")) return true;
  }
  return false;
}

const HEADING_TAG = /^h[2-6]$/;
const TITLE_CLASS = /(market|mkt|group|grp).*(title|name|head|label|h\b)|(^|[\s_-])(title|heading|header)([\s_-]|$)/i;

function isTitleNode(n: HtmlNode): boolean {
  if (n.tag === "h1" || n.tag === "title" || n.tag === "header") return false;
  if (HEADING_TAG.test(n.tag) || n.attrs.role === "heading") return true;
  return TITLE_CLASS.test(n.attrs.class ?? "");
}

function isAncestorOf(a: HtmlNode, b: HtmlNode): boolean {
  for (let p = b.parent; p; p = p.parent) if (p === a) return true;
  return false;
}

/** Titre du match affiché sur la page (premier h1, sinon le titre du document). */
export function eventLabelOf(root: HtmlNode): string {
  const all = descendants(root);
  const h1 = all.find((n) => n.tag === "h1" && !isHiddenNode(n) && textOf(n));
  if (h1) return textOf(h1);
  const title = all.find((n) => n.tag === "title");
  return title ? textOf(title) : "";
}

const strip = (full: string, part: string) => {
  const i = full.lastIndexOf(part);
  return (i >= 0 ? full.slice(0, i) + full.slice(i + part.length) : full).replace(/\s+/g, " ").trim();
};

/** Cotes visibles d'une page de marchés (HTML affiché), dans l'ordre de la page. */
export function pageOddsFromHtml(html: string): PageOdd[] {
  const root = parseHtml(html);
  const eventLabel = eventLabelOf(root);
  const all = descendants(root);
  const leaves = all.filter((n) => {
    const t = textOf(n);
    if (!t || !ODDS_ONLY.test(t) || isHiddenNode(n)) return false;
    // La plus profonde : aucun enfant élément qui porte le même texte.
    return !n.children.some((c) => c.tag !== "#text" && textOf(c) === t);
  });
  // Ligne de sélection de chaque cote.
  const rowOf = new Map<HtmlNode, HtmlNode>();
  for (const leaf of leaves) {
    let row: HtmlNode | null = leaf.parent;
    for (let depth = 0; row && depth < 6; depth++, row = row.parent) {
      const inside = leaves.filter((l) => l === row || isAncestorOf(row!, l));
      let rest = textOf(row);
      for (const l of inside) rest = strip(rest, textOf(l));
      if (/[\p{L}\p{N}]/u.test(rest)) break;
    }
    if (row && row.tag !== "#root" && row.tag !== "body" && row.tag !== "html") rowOf.set(leaf, row);
  }
  const titles = all.filter((n) => isTitleNode(n) && !isHiddenNode(n) && textOf(n) && !ODDS_ONLY.test(textOf(n)));
  const out: PageOdd[] = [];
  const seenRows = new Set<HtmlNode>();
  for (const leaf of leaves) {
    const row = rowOf.get(leaf);
    if (!row || seenRows.has(row)) continue;
    const inRow = leaves.filter((l) => rowOf.get(l) === row);
    const oddsNode = inRow[inRow.length - 1]!;
    seenRows.add(row);
    const oddsText = textOf(oddsNode);
    const odds = parseDisplayedOdds(oddsText);
    if (odds === null) continue;
    const selection = strip(textOf(row), oddsText);
    if (!selection) continue;
    const title = [...titles].reverse().find((t) => t.order < row.order && !isAncestorOf(t, row) && !isAncestorOf(row, t));
    if (!title) continue;
    const market = textOf(title);
    out.push({ eventLabel, market, selection, line: lineInText(selection) ?? lineInText(market), odds });
  }
  return out;
}

/** Libellé de sélection sans sa ligne ni ponctuation (comparaison entre chemins). */
export function selectionKey(selection: string, line: number | null): string {
  let s = selection;
  if (line !== null) {
    const abs = Math.abs(line);
    for (const v of [String(line), String(abs), abs.toFixed(1), abs.toFixed(2)]) {
      s = s.split(v).join(" ").split(v.replace(".", ",")).join(" ");
    }
  }
  return foldText(s.replace(/[()[\]+]/g, " ")).replace(/[^a-z0-9/ ]/g, " ").replace(/\s+/g, " ").trim();
}

/** Nom de marché sans ligne (« Total Goals 2.5 » ≡ « Total Goals »). */
export function marketKey(market: string): string {
  return foldText(market.replace(/[+-]?\d+[.,]\d+/g, " ")).replace(/[^a-z0-9/ ]/g, " ").replace(/\s+/g, " ").trim();
}

/** Un libellé de match (« A - B », « A v B ») désigne-t-il ces deux équipes ? */
export function labelHasTeams(label: string, home: string, away: string): boolean {
  const l = foldText(label);
  return !!home && !!away && l.includes(foldText(home)) && l.includes(foldText(away));
}

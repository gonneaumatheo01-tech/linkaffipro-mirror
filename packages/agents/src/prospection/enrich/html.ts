/**
 * Phase 31, chantier B — petits outils de lecture du HTML public de Telegram (`t.me/<nom>`, `t.me/s/<nom>`), sans
 * dépendance. Le décodage du texte est celui du lecteur de la phase 27 (`previewHtmlToText`).
 */
export { decodeHtmlEntities, parsePreviewViews, previewHtmlToText } from "../../inspiration/sources/web-preview";

/** Position du `<` de l'élément dont l'attribut class contient exactement le jeton `cls` (−1 sinon). */
export function classIndexOf(html: string, cls: string, from = 0): number {
  const re = new RegExp(`class="(?:[^"]*\\s)?${cls}(?:\\s[^"]*)?"`, "g");
  re.lastIndex = from;
  const m = re.exec(html);
  if (!m) return -1;
  return html.lastIndexOf("<", m.index);
}

/** Toutes les positions des éléments portant la classe `cls`. */
export function allClassIndexes(html: string, cls: string): number[] {
  const out: number[] = [];
  const re = new RegExp(`class="(?:[^"]*\\s)?${cls}(?:\\s[^"]*)?"`, "g");
  for (let m = re.exec(html); m; m = re.exec(html)) out.push(html.lastIndexOf("<", m.index));
  return out;
}

export function hasClassToken(html: string, cls: string): boolean {
  return classIndexOf(html, cls) >= 0;
}

/** Contenu de l'élément ouvert à `start` (même nom de balise, profondeur suivie). */
export function innerElement(html: string, start: number): string | null {
  const tag = /^<([a-z0-9]+)/i.exec(html.slice(start))?.[1]?.toLowerCase();
  if (!tag) return null;
  const open = html.indexOf(">", start);
  if (open < 0) return null;
  if (html[open - 1] === "/") return "";
  const re = new RegExp(`<${tag}\\b|</${tag}>`, "gi");
  re.lastIndex = open + 1;
  let depth = 1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(open + 1, m.index);
  }
  return null;
}

/** Balise ouvrante de l'élément à `start` (pour lire ses attributs). */
export function openTagAt(html: string, start: number): string {
  const end = html.indexOf(">", start);
  return end < 0 ? "" : html.slice(start, end + 1);
}

export function attrOf(tag: string, name: string): string | null {
  return new RegExp(`\\b${name}="([^"]*)"`, "i").exec(tag)?.[1] ?? null;
}

/** Contenu de la première occurrence de la classe `cls` (null si absente). */
export function innerByClass(html: string, cls: string): string | null {
  const i = classIndexOf(html, cls);
  return i < 0 ? null : innerElement(html, i);
}

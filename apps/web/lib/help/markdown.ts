/**
 * Convertisseur Markdown → HTML minimal et sûr, sans dépendance, pour la page Aide.
 *
 * Pris en charge : titres (# à ####) avec identifiant d'ancre, paragraphes, listes à puces et numérotées
 * (un niveau d'imbrication par indentation), gras, italique, code en ligne, liens, tableaux simples,
 * séparateurs (---) et citations (>). Tout le reste est échappé : aucun HTML brut ne passe.
 */

export type Heading = { level: number; text: string; id: string };

/**
 * Options de rendu (volet d'aide de la page courante : un extrait du guide affiché dans une autre page) :
 * - `idPrefix` : préfixe des identifiants d'ancre (pas de doublon avec la page /help ouverte derrière le volet) ;
 * - `headingOffset` : décalage des niveaux de titre (1 : `##` devient `<h3>`), plafonné à `<h6>` ;
 * - `anchorBase` : adresse des liens internes `#ancre` (« /help » : ils ouvrent le guide complet au bon endroit).
 */
export type RenderOptions = { idPrefix?: string; headingOffset?: number; anchorBase?: string };

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Identifiant d'ancre stable à partir d'un titre : sans accents, minuscules, tirets. */
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const SAFE_HREF = /^(https?:\/\/|mailto:|#|\/)/i;

function safeHref(url: string, anchorBase = ""): string {
  const trimmed = url.trim();
  if (!SAFE_HREF.test(trimmed)) return "#";
  return escapeHtml(trimmed.startsWith("#") && anchorBase ? `${anchorBase}${trimmed}` : trimmed);
}

/** Mise en forme en ligne : code, liens, gras, italique. Le texte est échappé avant toute transformation. */
export function renderInline(text: string, opts: RenderOptions = {}): string {
  const parts = text.split(/(`[^`]+`)/g);
  return parts
    .map((part) => {
      if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      let out = escapeHtml(part);
      out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => {
        const h = safeHref(href.replace(/&amp;/g, "&"), opts.anchorBase);
        const external = /^https?:\/\//i.test(h) ? ' target="_blank" rel="noopener noreferrer"' : "";
        return `<a href="${h}"${external}>${label}</a>`;
      });
      out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>");
      out = out.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>");
      return out;
    })
    .join("");
}

/** Titres du document (niveaux 1 à 4), avec les mêmes identifiants que ceux rendus. */
export function extractHeadings(markdown: string): Heading[] {
  const seen = new Map<string, number>();
  const out: Heading[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const m = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    out.push({ level: m[1]!.length, text: m[2]!, id: uniqueId(m[2]!, seen) });
  }
  return out;
}

function uniqueId(text: string, seen: Map<string, number>): string {
  const base = slugify(text) || "section";
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return n === 0 ? base : `${base}-${n + 1}`;
}

type ListItem = { indent: number; ordered: boolean; text: string };

function renderList(items: ListItem[], opts: RenderOptions): string {
  // Imbrication par indentation : chaque niveau plus profond ouvre une sous-liste dans le dernier <li>.
  let html = "";
  const stack: Array<{ indent: number; ordered: boolean }> = [];
  const open = (it: ListItem) => {
    stack.push({ indent: it.indent, ordered: it.ordered });
    html += it.ordered ? "<ol>" : "<ul>";
  };
  const close = () => {
    const top = stack.pop()!;
    html += `</li>${top.ordered ? "</ol>" : "</ul>"}`;
  };
  for (const it of items) {
    if (stack.length === 0) {
      open(it);
      html += `<li>${renderInline(it.text, opts)}`;
      continue;
    }
    const top = stack[stack.length - 1]!;
    if (it.indent > top.indent) {
      open(it);
      html += `<li>${renderInline(it.text, opts)}`;
    } else {
      while (stack.length > 1 && it.indent < stack[stack.length - 1]!.indent) close();
      html += `</li><li>${renderInline(it.text, opts)}`;
    }
  }
  while (stack.length > 0) close();
  return html;
}

function renderTable(lines: string[], opts: RenderOptions): string {
  const cells = (l: string) =>
    l
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => renderInline(c.trim(), opts));
  const head = cells(lines[0]!);
  const body = lines.slice(2).map(cells);
  const th = head.map((c) => `<th>${c}</th>`).join("");
  const rows = body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
  return `<table><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table>`;
}

const LIST_RE = /^(\s*)(?:[-*]|\d+[.)])\s+(.*)$/;
const ORDERED_RE = /^\s*\d+[.)]\s/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** Rend le Markdown en HTML. Les identifiants des titres sont ceux de `extractHeadings` (avec `idPrefix`). */
export function renderMarkdown(markdown: string, opts: RenderOptions = {}): string {
  const prefix = opts.idPrefix ?? "";
  const offset = Math.max(0, Math.round(opts.headingOffset ?? 0));
  const lines = markdown.split(/\r?\n/);
  const seen = new Map<string, number>();
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }
    const h = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      const level = Math.min(6, h[1]!.length + offset);
      const id = `${prefix}${uniqueId(h[2]!, seen)}`;
      out.push(`<h${level} id="${id}">${renderInline(h[2]!, opts)}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) {
        buf.push(lines[i]!);
        i++;
      }
      i++;
      out.push(`<pre><code>${escapeHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]!)) {
      const buf: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) {
        buf.push(lines[i]!);
        i++;
      }
      out.push(renderTable(buf, opts));
      continue;
    }
    if (LIST_RE.test(line)) {
      const items: ListItem[] = [];
      while (i < lines.length && LIST_RE.test(lines[i]!)) {
        const m = LIST_RE.exec(lines[i]!)!;
        items.push({ indent: m[1]!.length, ordered: ORDERED_RE.test(lines[i]!), text: m[2]! });
        i++;
        // Ligne de continuation (indentée, sans puce) : rattachée à l'élément précédent.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]!) && !LIST_RE.test(lines[i]!)) {
          items[items.length - 1]!.text += ` ${lines[i]!.trim()}`;
          i++;
        }
      }
      out.push(renderList(items, opts));
      continue;
    }
    if (line.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">")) {
        buf.push(lines[i]!.replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote><p>${renderInline(buf.join(" "), opts)}</p></blockquote>`);
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== "" && !/^(#{1,4})\s/.test(lines[i]!) && !LIST_RE.test(lines[i]!) && !lines[i]!.startsWith(">") && !lines[i]!.startsWith("```")) {
      buf.push(lines[i]!.trim());
      i++;
    }
    out.push(`<p>${renderInline(buf.join(" "), opts)}</p>`);
  }
  return out.join("\n");
}

/**
 * Petit analyseur HTML sans navigateur ni dépendance (lu par les Analystes) : découpe une page en arbre et applique des
 * sélecteurs CSS. Tolérant (balises non fermées, attributs sans guillemets, entités courantes) ; scripts, styles et
 * commentaires ignorés. Sélecteurs pris en charge : balise, `#id`, `.classe`, `[attr]`, `[attr=v]`, `[attr~=v]`, `[attr^=v]`, `[attr$=v]`, `[attr*=v]`,
 * `[attr|=v]` (insensible à la casse avec ` i`), `*`, descendant (espace), enfant (`>`), voisin (`+`, `~`), listes (`,`),
 * `:first-child`, `:last-child`, `:nth-child(n)`, `:not(simple)`. Règles pures : la page est une DONNÉE.
 */
export type HtmlNode = {
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
  parent: HtmlNode | null;
  /** Texte direct (nœud texte : tag « #text »). */
  text?: string;
  /** Rang dans le document (ordre de lecture). */
  order: number;
};

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "noscript", "template"]);
// Fermetures implicites courantes.
const AUTO_CLOSE: Record<string, Set<string>> = {
  li: new Set(["li"]),
  p: new Set(["p"]),
  tr: new Set(["tr"]),
  td: new Set(["td", "th"]),
  th: new Set(["td", "th"]),
  option: new Set(["option"]),
};

const BOUNDARY = new Set(["ul", "ol", "table", "tbody", "thead", "tr", "div", "section"]);

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", hellip: "…", euro: "€" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** HTML → arbre (racine « #root »). */
export function parseHtml(html: string): HtmlNode {
  let order = 0;
  const root: HtmlNode = { tag: "#root", attrs: {}, children: [], parent: null, order: order++ };
  const stack: HtmlNode[] = [root];
  const top = () => stack[stack.length - 1]!;
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\/\s*([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const pushText = (t: string) => {
    if (!t) return;
    const parent = top();
    parent.children.push({ tag: "#text", attrs: {}, children: [], parent, text: decodeEntities(t), order: order++ });
  };
  while ((m = re.exec(html))) {
    pushText(html.slice(last, m.index));
    last = re.lastIndex;
    if (m[1]) {
      const name = m[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--)
        if (stack[i]!.tag === name) {
          stack.length = i;
          break;
        }
      continue;
    }
    if (!m[2]) continue;
    const tag = m[2].toLowerCase();
    const auto = AUTO_CLOSE[tag];
    if (auto)
      for (let i = stack.length - 1; i > 0; i--) {
        const t = stack[i]!.tag;
        if (auto.has(t)) {
          stack.length = i;
          break;
        }
        if (BOUNDARY.has(t)) break;
      }
    const attrs: Record<string, string> = {};
    const attrRe = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(m[3] ?? ""))) attrs[a[1]!.toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? "");
    const parent = top();
    const node: HtmlNode = { tag, attrs, children: [], parent, order: order++ };
    parent.children.push(node);
    if (RAW.has(tag)) {
      const close = new RegExp(`</\\s*${tag}\\s*>`, "i");
      const rest = html.slice(re.lastIndex);
      const end = close.exec(rest);
      const stop = end ? re.lastIndex + end.index + end[0].length : html.length;
      re.lastIndex = stop;
      last = stop;
      continue;
    }
    if (!VOID.has(tag) && m[4] !== "/") stack.push(node);
  }
  pushText(html.slice(last));
  return root;
}

export function elementChildren(n: HtmlNode): HtmlNode[] {
  return n.children.filter((c) => c.tag !== "#text");
}

/** Tous les éléments sous `n` (ordre du document, `n` exclu). */
export function descendants(n: HtmlNode): HtmlNode[] {
  const out: HtmlNode[] = [];
  const walk = (x: HtmlNode) => {
    for (const c of x.children)
      if (c.tag !== "#text") {
        out.push(c);
        walk(c);
      }
  };
  walk(n);
  return out;
}

/** Texte visible (espaces réduits). */
export function textOf(n: HtmlNode): string {
  const parts: string[] = [];
  const block = /^(div|p|li|tr|td|th|section|article|header|footer|h[1-6]|br|ul|ol|table|tbody|thead)$/;
  const walk = (x: HtmlNode) => {
    if (x.tag === "#text") parts.push(x.text ?? "");
    else {
      if (x.attrs.hidden !== undefined || /display\s*:\s*none/i.test(x.attrs.style ?? "") || x.attrs["aria-hidden"] === "true") return;
      if (block.test(x.tag)) parts.push(" ");
      for (const c of x.children) walk(c);
      if (block.test(x.tag)) parts.push(" ");
    }
  };
  walk(n);
  return parts.join("").replace(/\s+/g, " ").trim();
}

// --- Sélecteurs -------------------------------------------------------------------------------------------------
type AttrTest = { name: string; op: string | null; value: string; ci: boolean };
type Compound = { tag: string | null; id: string | null; classes: string[]; attrs: AttrTest[]; pseudos: Array<{ name: string; arg: string | null }> };
type Complex = Array<{ combinator: " " | ">" | "+" | "~" | null; compound: Compound }>;

function parseCompound(s: string): Compound | null {
  const c: Compound = { tag: null, id: null, classes: [], attrs: [], pseudos: [] };
  let i = 0;
  const ident = () => {
    const m = /^(?:\\.|[\w-])+/.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return m[0].replace(/\\(.)/g, "$1");
  };
  if (s[i] === "*") i++;
  else if (/[a-zA-Z]/.test(s[i] ?? "")) c.tag = ident()!.toLowerCase();
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === "#") {
      i++;
      c.id = ident();
      if (c.id === null) return null;
    } else if (ch === ".") {
      i++;
      const v = ident();
      if (v === null) return null;
      c.classes.push(v);
    } else if (ch === "[") {
      const end = s.indexOf("]", i);
      if (end < 0) return null;
      const body = s.slice(i + 1, end).trim();
      i = end + 1;
      const m = /^([\w:-]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))\s*(i)?)?$/i.exec(body);
      if (!m) return null;
      c.attrs.push({ name: m[1]!.toLowerCase(), op: m[2] ?? null, value: m[3] ?? m[4] ?? m[5] ?? "", ci: !!m[6] });
    } else if (ch === ":") {
      i++;
      const name = ident();
      if (!name) return null;
      let arg: string | null = null;
      if (s[i] === "(") {
        let depth = 1;
        let j = i + 1;
        while (j < s.length && depth) {
          if (s[j] === "(") depth++;
          else if (s[j] === ")") depth--;
          j++;
        }
        arg = s.slice(i + 1, j - 1).trim();
        i = j;
      }
      c.pseudos.push({ name: name.toLowerCase(), arg });
    } else return null;
  }
  return c;
}

function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function parseComplex(s: string): Complex | null {
  const tokens: string[] = [];
  let cur = "";
  let depth = 0;
  let quote: string | null = null;
  for (const ch of s.trim()) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (depth === 0 && (ch === ">" || ch === "+" || ch === "~")) {
      if (cur.trim()) tokens.push(cur.trim());
      tokens.push(ch);
      cur = "";
      continue;
    }
    if (depth === 0 && /\s/.test(ch)) {
      if (cur.trim()) tokens.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) tokens.push(cur.trim());
  const out: Complex = [];
  let comb: " " | ">" | "+" | "~" | null = null;
  for (const t of tokens) {
    if (t === ">" || t === "+" || t === "~") {
      comb = t;
      continue;
    }
    const compound = parseCompound(t);
    if (!compound) return null;
    out.push({ combinator: out.length ? (comb ?? " ") : null, compound });
    comb = null;
  }
  return out.length ? out : null;
}

function attrMatches(n: HtmlNode, t: AttrTest): boolean {
  const v0 = n.attrs[t.name];
  if (v0 === undefined) return false;
  if (!t.op) return true;
  const v = t.ci ? v0.toLowerCase() : v0;
  const w = t.ci ? t.value.toLowerCase() : t.value;
  switch (t.op) {
    case "=":
      return v === w;
    case "~=":
      return v.split(/\s+/).includes(w);
    case "^=":
      return w !== "" && v.startsWith(w);
    case "$=":
      return w !== "" && v.endsWith(w);
    case "*=":
      return w !== "" && v.includes(w);
    case "|=":
      return v === w || v.startsWith(`${w}-`);
    default:
      return false;
  }
}

function siblingsOf(n: HtmlNode): HtmlNode[] {
  return n.parent ? elementChildren(n.parent) : [n];
}

function compoundMatches(n: HtmlNode, c: Compound): boolean {
  if (n.tag === "#text" || n.tag === "#root") return false;
  if (c.tag && n.tag !== c.tag) return false;
  if (c.id !== null && n.attrs.id !== c.id) return false;
  if (c.classes.length) {
    const cls = (n.attrs.class ?? "").split(/\s+/);
    if (!c.classes.every((x) => cls.includes(x))) return false;
  }
  if (!c.attrs.every((a) => attrMatches(n, a))) return false;
  for (const p of c.pseudos) {
    const sib = siblingsOf(n);
    const idx = sib.indexOf(n);
    if (p.name === "first-child" && idx !== 0) return false;
    if (p.name === "last-child" && idx !== sib.length - 1) return false;
    if (p.name === "nth-child" && String(idx + 1) !== (p.arg ?? "").trim()) return false;
    if (p.name === "not") {
      const inner = p.arg ? parseCompound(p.arg) : null;
      if (!inner || compoundMatches(n, inner)) return false;
    }
    if (!["first-child", "last-child", "nth-child", "not"].includes(p.name)) return false;
  }
  return true;
}

function complexMatches(n: HtmlNode, cx: Complex, scope: HtmlNode | null): boolean {
  const within = (x: HtmlNode | null) => !!x && (scope === null || isInside(x, scope));
  const step = (node: HtmlNode, i: number): boolean => {
    if (!compoundMatches(node, cx[i]!.compound)) return false;
    if (i === 0) return within(node);
    const comb = cx[i]!.combinator;
    if (comb === ">") return !!node.parent && within(node.parent) && step(node.parent, i - 1);
    if (comb === " ") {
      for (let p = node.parent; p && within(p); p = p.parent) if (step(p, i - 1)) return true;
      return false;
    }
    const sib = siblingsOf(node);
    const idx = sib.indexOf(node);
    if (comb === "+") return idx > 0 && step(sib[idx - 1]!, i - 1);
    for (let j = idx - 1; j >= 0; j--) if (step(sib[j]!, i - 1)) return true;
    return false;
  };
  return step(n, cx.length - 1);
}

function isInside(x: HtmlNode, scope: HtmlNode): boolean {
  for (let p: HtmlNode | null = x; p; p = p.parent) if (p === scope) return true;
  return false;
}

/** Sélecteur valide pour cet analyseur ? */
export function isSupportedSelector(sel: string): boolean {
  const parts = splitTopLevel(sel, ",");
  return parts.length > 0 && parts.every((p) => parseComplex(p) !== null);
}

/** Éléments sous `scope` (exclu) qui répondent au sélecteur, dans l'ordre du document ; sélecteur illisible : []. */
export function querySelectorAll(scope: HtmlNode, selector: string): HtmlNode[] {
  const list = splitTopLevel(selector, ",").map(parseComplex);
  if (!list.length || list.some((c) => c === null)) return [];
  const all = descendants(scope);
  const bound = scope.tag === "#root" ? null : scope;
  return all.filter((n) => list.some((cx) => complexMatches(n, cx!, bound)));
}

const IMPLICIT_ROLE: Record<string, string> = { button: "button", a: "link", tr: "row", li: "listitem", table: "table", ul: "list", ol: "list", nav: "navigation", main: "main", h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading", td: "cell", th: "columnheader" };

export function roleOf(n: HtmlNode): string | null {
  return n.attrs.role ?? (n.tag === "a" && n.attrs.href === undefined ? null : (IMPLICIT_ROLE[n.tag] ?? null));
}

/**
 * Base d'une adresse relative dans une page APLATIE par le transport : l'adresse du cadre `<lap-frame url>` qui
 * contient le nœud (site de paris dans une iframe), sinon celle de la page. Pur.
 */
export function frameBaseOf(n: HtmlNode, pageUrl: string | null): string | null {
  for (let p = n.parent; p; p = p.parent) if (p.tag === "lap-frame" && p.attrs.url) return p.attrs.url;
  return pageUrl;
}

/** Repère de test ou de maquette d'un élément (`data-editor-id`, `data-testid`…), ou vide. Pur. */
export function testIdOf(n: HtmlNode): string {
  return n.attrs["data-editor-id"] ?? n.attrs["data-testid"] ?? n.attrs["data-test"] ?? n.attrs["data-cy"] ?? n.attrs["data-qa"] ?? "";
}

export function foldText(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

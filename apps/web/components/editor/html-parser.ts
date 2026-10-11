/**
 * Lecteur HTML tolérant, sans DOM (testable en Node) : transforme une chaîne HTML en arbre simple.
 * Il lit aussi bien le contenu de l'éditeur (`innerHTML`, toujours bien formé) que du HTML collé depuis une page web,
 * Word ou Google Docs (commentaires, balises non fermées, attributs sans guillemets, `<style>`…). Il ne sert qu'à
 * extraire du texte et sa mise en forme : la sortie est toujours reconstruite à partir d'une liste blanche.
 */

export type HtmlText = { type: "text"; text: string };
export type HtmlElement = {
  type: "el";
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
};
export type HtmlNode = HtmlText | HtmlElement;

/** Éléments sans contenu ni balise fermante. */
const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/** Éléments dont le contenu n'est pas du HTML (lu tel quel jusqu'à la balise fermante). */
const RAW_TEXT = new Set([
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
  "noscript",
]);

/** Entités nommées courantes (le navigateur n'écrit que &amp; &lt; &gt; &quot; &nbsp; ; le reste vient du collage). */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  shy: "­",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  zwnj: "‌",
  zwj: "‍",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  ndash: "–",
  mdash: "—",
  bull: "•",
  middot: "·",
  euro: "€",
  pound: "£",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  times: "×",
  divide: "÷",
  agrave: "à",
  aacute: "á",
  acirc: "â",
  auml: "ä",
  ccedil: "ç",
  egrave: "è",
  eacute: "é",
  ecirc: "ê",
  euml: "ë",
  icirc: "î",
  iuml: "ï",
  ocirc: "ô",
  ouml: "ö",
  ugrave: "ù",
  ucirc: "û",
  uuml: "ü",
  Agrave: "À",
  Eacute: "É",
  Egrave: "È",
  Ccedil: "Ç",
  oelig: "œ",
  OElig: "Œ",
};

/** Décode les entités HTML (nommées courantes et numériques). Une entité inconnue reste telle quelle. */
export function decodeHtmlEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(
    /&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});/g,
    (m, body: string) => {
      if (body[0] === "#") {
        const hex = body[1] === "x" || body[1] === "X";
        const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
        if (!Number.isFinite(code) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
          return "�";
        return code === 0 ? "�" : String.fromCodePoint(code);
      }
      return NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()] ?? m;
    },
  );
}

const NAME_START = /[a-zA-Z]/;

/** Lit les attributs d'une balise ouvrante à partir de `i` ; renvoie la position après `>` (ou -1 si non fermée). */
function readAttributes(
  s: string,
  start: number,
): { attrs: Record<string, string>; end: number; selfClosing: boolean } {
  const attrs: Record<string, string> = {};
  let i = start;
  const n = s.length;
  while (i < n) {
    // Espaces et « / » isolés entre attributs.
    while (i < n && /[\s/]/.test(s[i]!)) {
      if (s[i] === "/" && s[i + 1] === ">") return { attrs, end: i + 2, selfClosing: true };
      i++;
    }
    if (i >= n) break;
    if (s[i] === ">") return { attrs, end: i + 1, selfClosing: false };
    let j = i;
    while (j < n && !/[\s"'>/=]/.test(s[j]!)) j++;
    if (j === i) {
      // Caractère inattendu (« " » ou « ' » isolé) : on l'ignore.
      i++;
      continue;
    }
    const name = s.slice(i, j).toLowerCase();
    i = j;
    while (i < n && /\s/.test(s[i]!)) i++;
    let value = "";
    if (s[i] === "=") {
      i++;
      while (i < n && /\s/.test(s[i]!)) i++;
      const q = s[i];
      if (q === '"' || q === "'") {
        const close = s.indexOf(q, i + 1);
        if (close === -1) return { attrs, end: -1, selfClosing: false };
        value = s.slice(i + 1, close);
        i = close + 1;
      } else {
        let k = i;
        while (k < n && !/[\s>]/.test(s[k]!)) k++;
        value = s.slice(i, k);
        i = k;
      }
    }
    if (!(name in attrs)) attrs[name] = decodeHtmlEntities(value);
  }
  return { attrs, end: -1, selfClosing: false };
}

/**
 * Transforme une chaîne HTML en arbre. Tolérant comme un navigateur : commentaires, doctype et `<?…>` ignorés,
 * balises non fermées refermées à la fin, fermetures sans ouverture ignorées, `<` isolé gardé comme texte,
 * contenu de `<script>`/`<style>` lu sans être interprété.
 */
export function parseHtml(input: string): HtmlNode[] {
  const s = input.replace(/\r\n?/g, "\n");
  const root: HtmlElement = { type: "el", tag: "#root", attrs: {}, children: [] };
  const stack: HtmlElement[] = [root];
  const current = () => stack[stack.length - 1]!;
  let text = "";
  const flushText = () => {
    if (!text) return;
    const parent = current();
    const last = parent.children[parent.children.length - 1];
    const decoded = decodeHtmlEntities(text);
    if (last && last.type === "text") last.text += decoded;
    else parent.children.push({ type: "text", text: decoded });
    text = "";
  };
  let i = 0;
  const n = s.length;
  while (i < n) {
    const lt = s.indexOf("<", i);
    if (lt === -1) {
      text += s.slice(i);
      break;
    }
    text += s.slice(i, lt);
    i = lt;
    const next = s[i + 1] ?? "";
    // Commentaire.
    if (s.startsWith("<!--", i)) {
      flushText();
      const end = s.indexOf("-->", i + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    // Doctype, CDATA, instruction XML.
    if (next === "!" || next === "?") {
      flushText();
      const end = s.indexOf(">", i + 2);
      i = end === -1 ? n : end + 1;
      continue;
    }
    // Balise fermante.
    if (next === "/" && NAME_START.test(s[i + 2] ?? "")) {
      const end = s.indexOf(">", i + 2);
      if (end === -1) {
        text += s.slice(i);
        break;
      }
      flushText();
      const tag = (/^[^\s/>]+/.exec(s.slice(i + 2, end))?.[0] ?? "").toLowerCase();
      i = end + 1;
      if (tag === "br") {
        current().children.push({ type: "el", tag: "br", attrs: {}, children: [] });
        continue;
      }
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k]!.tag === tag) {
          stack.length = k;
          break;
        }
      }
      continue;
    }
    // Balise ouvrante.
    if (NAME_START.test(next)) {
      const nameMatch = /^[^\s/>]+/.exec(s.slice(i + 1));
      const tag = (nameMatch?.[0] ?? "").toLowerCase();
      const { attrs, end, selfClosing } = readAttributes(s, i + 1 + tag.length);
      if (end === -1) {
        // Balise jamais fermée : le « < » est du texte.
        text += "<";
        i += 1;
        continue;
      }
      flushText();
      const el: HtmlElement = { type: "el", tag, attrs, children: [] };
      current().children.push(el);
      i = end;
      if (VOID.has(tag)) continue;
      if (RAW_TEXT.has(tag)) {
        const close = s.toLowerCase().indexOf(`</${tag}`, i);
        const content = s.slice(i, close === -1 ? n : close);
        if (content)
          el.children.push({
            type: "text",
            text: tag === "textarea" || tag === "title" ? decodeHtmlEntities(content) : content,
          });
        if (close === -1) i = n;
        else {
          const gt = s.indexOf(">", close);
          i = gt === -1 ? n : gt + 1;
        }
        continue;
      }
      // En HTML, « <b/> » ouvre un <b> : seul un élément vide se ferme tout seul.
      void selfClosing;
      stack.push(el);
      continue;
    }
    // « < » qui ne commence pas une balise.
    text += "<";
    i += 1;
  }
  flushText();
  return root.children;
}

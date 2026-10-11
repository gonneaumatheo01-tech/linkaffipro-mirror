/**
 * Conversions entre le HTML de l'éditeur (ou du HTML collé) et le HTML Telegram, sans DOM.
 *
 * Principe : on lit le HTML (lecteur tolérant), on en tire une suite de morceaux de texte avec leur mise en forme
 * effective (gras, italique, souligné, barré, texte masqué, code, lien, bloc de code, citation), puis on réécrit le
 * HTML à partir d'une liste blanche. Rien d'autre ne passe : balises et attributs interdits disparaissent, seuls les
 * liens http(s) restent, le texte est échappé, les sauts de ligne sont gardés.
 *
 * Sortie Telegram : b, i, u, s, a href, tg-spoiler, code, pre, blockquote, tg-emoji
 * (https://core.telegram.org/bots/api#html-style), avec les règles d'imbrication de Telegram (rien dans un code ou un
 * bloc de code, pas de lien dans un code, pas d'emoji animé dans un lien, un code ou un bloc de code).
 *
 * Emoji animé (phase 12) : `<tg-emoji emoji-id="ID">👍</tg-emoji>` ↔ puce atomique de l'éditeur (custom-emoji-chip.ts).
 * C'est un morceau à part (jamais fusionné avec son voisin), dont le texte est l'emoji de remplacement.
 */
import { isValidCustomEmojiId, validateTelegramHtml } from "@linkaffipro/core";
import {
  customEmojiChipHtml,
  CUSTOM_EMOJI_CHIP_CLASS,
  DEFAULT_FALLBACK,
} from "./custom-emoji-chip";
import { parseHtml, type HtmlElement, type HtmlNode, type HtmlText } from "./html-parser";

/** D'où vient le HTML lu : l'éditeur (espaces conservés), un collage (espaces repliés comme un navigateur), Telegram. */
export type HtmlSource = "editor" | "paste" | "telegram";

type Fmt = {
  b: boolean;
  i: boolean;
  u: boolean;
  s: boolean;
  sp: boolean;
  code: boolean;
  href: string | null;
  /** Identifiant du bloc de code (deux blocs voisins restent distincts). */
  pre: string | null;
  /** Identifiant de la citation (suffixe « e » : citation repliable). */
  quote: string | null;
  /** Emoji animé : identifiant Telegram (le texte du morceau est son emoji de remplacement). */
  ce: string | null;
};
type Run = { text: string; fmt: Fmt; collapsible: boolean };
type WhiteSpace = "pre" | "collapse" | "pre-line";

const EMPTY_FMT: Fmt = {
  b: false,
  i: false,
  u: false,
  s: false,
  sp: false,
  code: false,
  href: null,
  pre: null,
  quote: null,
  ce: null,
};

/** Contenu jamais repris (scripts, styles, médias, champs de formulaire…). */
const DROP = new Set([
  "script",
  "style",
  "head",
  "title",
  "meta",
  "link",
  "base",
  "template",
  "noscript",
  "iframe",
  "object",
  "embed",
  "svg",
  "math",
  "canvas",
  "video",
  "audio",
  "picture",
  "source",
  "track",
  "map",
  "select",
  "option",
  "textarea",
  "input",
  "button",
  "datalist",
  "xml",
]);

/** Éléments qui commencent une nouvelle ligne (rendu bloc d'un navigateur). */
const BLOCKS = new Set([
  "address",
  "article",
  "aside",
  "body",
  "caption",
  "center",
  "dd",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "html",
  "legend",
  "li",
  "main",
  "menu",
  "nav",
  "ol",
  "p",
  "section",
  "summary",
  "table",
  "tbody",
  "tfoot",
  "thead",
  "tr",
  "ul",
]);

const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/** Lien accepté : http(s) seulement, sans espace. Renvoie l'adresse nettoyée ou null. */
export function safeHref(raw: string | undefined): string | null {
  const href = (raw ?? "").trim();
  if (!/^https?:\/\/\S+$/i.test(href)) return null;
  return href;
}

/** Déclarations d'un attribut `style` (noms en minuscules). */
function styleOf(el: HtmlElement): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = el.attrs.style;
  if (!raw) return out;
  for (const decl of raw.split(";")) {
    const colon = decl.indexOf(":");
    if (colon === -1) continue;
    const name = decl.slice(0, colon).trim().toLowerCase();
    const value = decl
      .slice(colon + 1)
      .replace(/!important/i, "")
      .trim()
      .toLowerCase();
    if (name) out[name] = value;
  }
  return out;
}

function hasClass(el: HtmlElement, name: string): boolean {
  return (el.attrs.class ?? "").split(/\s+/).includes(name);
}

/** Gras d'après `font-weight` : true, false, ou undefined (hérité). */
function weightOf(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  if (value === "bold" || value === "bolder") return true;
  if (value === "normal" || value === "lighter") return false;
  const n = Number.parseInt(value, 10);
  if (Number.isFinite(n)) return n >= 600;
  return undefined;
}

type Kind = "drop" | "br" | "img" | "emoji" | "block" | "quote" | "pre" | "cell" | "inline";

/**
 * Identifiant d'emoji animé porté par un élément : balise Telegram `<tg-emoji emoji-id>`, puce de l'éditeur
 * (`data-ce-id`), ou emoji animé copié depuis Telegram Web (`data-document-id` sur une image ou un bloc marqué
 * « custom emoji »). Null sinon (ou identifiant invalide : le texte reste, sans animation).
 */
function customEmojiIdOf(el: HtmlElement): string | null {
  let id: string | undefined;
  if (el.tag === "tg-emoji") id = el.attrs["emoji-id"];
  else if (el.attrs["data-ce-id"] !== undefined && hasClass(el, CUSTOM_EMOJI_CHIP_CLASS))
    id = el.attrs["data-ce-id"];
  else if (
    el.attrs["data-document-id"] !== undefined &&
    (/customemoji/i.test(el.attrs["data-entity-type"] ?? "") ||
      /(^|\s)custom-?emoji(\s|$)/i.test(el.attrs.class ?? ""))
  )
    id = el.attrs["data-document-id"];
  const v = (id ?? "").trim();
  return v && isValidCustomEmojiId(v) ? v : null;
}

/** Texte d'un sous-arbre (émojis servis en image compris), sans mise en forme. */
function plainTextOf(nodes: HtmlNode[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.type === "text") out += n.text;
    else if (n.tag === "img") out += n.attrs.alt ?? "";
    else out += plainTextOf(n.children);
  }
  return out;
}

/** Emoji de remplacement d'un emoji animé : attribut de la puce, texte de la balise, ou texte alternatif. */
function customEmojiFallbackOf(el: HtmlElement): string {
  const fromAttr = el.attrs["data-ce-fallback"];
  const raw =
    fromAttr !== undefined && fromAttr !== ""
      ? fromAttr
      : el.tag === "img"
        ? (el.attrs.alt ?? "")
        : plainTextOf(el.children);
  const fb = raw.replace(/[\n\r\t]+/g, "").trim();
  return fb || DEFAULT_FALLBACK;
}

function kindOf(el: HtmlElement): Kind {
  const t = el.tag;
  if (DROP.has(t) || "hidden" in el.attrs) return "drop";
  const st = styleOf(el);
  if (st.display === "none" || st["mso-hide"] === "all") return "drop";
  if (customEmojiIdOf(el)) return "emoji";
  if (t === "br") return "br";
  if (t === "img") return "img";
  if (t === "blockquote") return "quote";
  if (t === "pre" || t === "listing" || t === "plaintext") return "pre";
  if (t === "td" || t === "th") return "cell";
  if (BLOCKS.has(t)) return "block";
  return "inline";
}

let idCounter = 0;

/**
 * Mise en forme effective d'un élément, à partir de celle de son parent.
 * `editor` : HTML de l'éditeur, où le texte masqué est un `<sub>` (voir `tagsFor`).
 */
function fmtOf(el: HtmlElement, parent: Fmt, kind: Kind, editor = false): Fmt {
  const f: Fmt = { ...parent };
  const t = el.tag;
  const st = styleOf(el);
  if (t === "b" || t === "strong") f.b = weightOf(st["font-weight"]) ?? true;
  else if (HEADINGS.has(t)) f.b = true;
  else {
    const w = weightOf(st["font-weight"]);
    if (w !== undefined) f.b = w;
  }
  if (t === "i" || t === "em" || t === "cite" || t === "dfn" || t === "var") f.i = true;
  if (st["font-style"] === "italic" || st["font-style"] === "oblique") f.i = true;
  else if (st["font-style"] === "normal") f.i = false;
  if (t === "u" || t === "ins") f.u = true;
  if (t === "s" || t === "strike" || t === "del") f.s = true;
  const deco = `${st["text-decoration"] ?? ""} ${st["text-decoration-line"] ?? ""}`;
  // Un lien collé est souvent souligné par son style : on ne garde pas ce soulignement-là.
  if (deco.includes("underline") && !f.href && t !== "a") f.u = true;
  if (deco.includes("line-through")) f.s = true;
  if (t === "code" || t === "kbd" || t === "samp" || t === "tt") f.code = true;
  if (t === "tg-spoiler" || hasClass(el, "tg-spoiler") || "data-tg-spoiler" in el.attrs)
    f.sp = true;
  if (editor && (t === "sub" || st["vertical-align"] === "sub")) f.sp = true;
  if (t === "a") {
    const href = safeHref(el.attrs.href);
    if (href) f.href = href;
  }
  if (kind === "quote") f.quote = `${++idCounter}${"expandable" in el.attrs ? "e" : ""}`;
  if (kind === "pre") f.pre = String(++idCounter);
  return f;
}

/** Espaces : `white-space` d'un élément (les blocs de code gardent tout). */
function wsOf(el: HtmlElement, parent: WhiteSpace, kind: Kind): WhiteSpace {
  if (kind === "pre") return "pre";
  const v = styleOf(el)["white-space"];
  if (v === "pre" || v === "pre-wrap" || v === "break-spaces") return "pre";
  if (v === "pre-line") return "pre-line";
  if (v === "normal" || v === "nowrap") return "collapse";
  return parent;
}

/** Un émoji servi en image (Gmail, X…) : on garde son texte de remplacement. */
function imgText(el: HtmlElement): string {
  const alt = (el.attrs.alt ?? "").trim();
  return alt.length > 0 && alt.length <= 16 && /\p{Extended_Pictographic}/u.test(alt) ? alt : "";
}

type Container = { kind: "root" | "block" | "quote" | "pre"; parent: Container | null };
/** Feuille : du contenu, un `<br>`, ou le saut de ligne final d'un texte (`text`). */
type Leaf = { br: HtmlElement | null; text: HtmlText | null; container: Container };
type Placeholders = { brs: Set<HtmlElement>; texts: Set<HtmlText> };

function inside(c: Container, ancestor: Container): boolean {
  for (let x: Container | null = c; x; x = x.parent) if (x === ancestor) return true;
  return false;
}

/**
 * Sauts de ligne « fantômes » d'un HTML affiché par un navigateur : un `<br>` (ou, dans l'éditeur, un caractère de
 * saut de ligne) en dernière position d'un bloc n'est pas affiché ; il sert seulement à donner une hauteur à une ligne
 * vide (Chrome en ajoute un quand on va à la ligne en fin de texte). On les repère pour ne pas les écrire : sans cela,
 * chaque aller-retour ajouterait une ligne vide en fin de message.
 */
function placeholderBreaks(nodes: HtmlNode[], ws: WhiteSpace, editor: boolean): Placeholders {
  const leaves: Leaf[] = [];
  const root: Container = { kind: "root", parent: null };
  const walk = (list: HtmlNode[], container: Container, mode: WhiteSpace) => {
    for (const n of list) {
      if (n.type === "text") {
        if (mode === "pre" && editor && n.text.endsWith("\n")) {
          if (n.text.length > 1) leaves.push({ br: null, text: null, container });
          leaves.push({ br: null, text: n, container });
          continue;
        }
        const visible = mode === "pre" ? n.text.length > 0 : /[^ \t\n\r\f]/.test(n.text);
        if (visible) leaves.push({ br: null, text: null, container });
        continue;
      }
      const kind = kindOf(n);
      if (kind === "drop") continue;
      if (kind === "br") {
        leaves.push({ br: n, text: null, container });
        continue;
      }
      if (kind === "img") {
        if (imgText(n)) leaves.push({ br: null, text: null, container });
        continue;
      }
      if (kind === "emoji") {
        leaves.push({ br: null, text: null, container });
        continue;
      }
      const childMode = wsOf(n, mode, kind);
      if (kind === "block" || kind === "quote" || kind === "pre")
        walk(n.children, { kind, parent: container }, childMode);
      else walk(n.children, container, childMode);
    }
  };
  walk(nodes, root, ws);
  const out: Placeholders = { brs: new Set(), texts: new Set() };
  const mark = (leaf: Leaf) => {
    if (leaf.br) out.brs.add(leaf.br);
    if (leaf.text) out.texts.add(leaf.text);
  };
  leaves.forEach((leaf, i) => {
    if (!leaf.br && !leaf.text) return;
    const c = leaf.container;
    for (let j = i + 1; j < leaves.length; j++) {
      if (inside(leaves[j]!.container, c)) return; // du contenu suit dans le même bloc : vrai saut de ligne
    }
    if (c.kind !== "block") {
      mark(leaf);
      return;
    }
    // Dans un bloc ordinaire, un saut de ligne seul donne une ligne vide : il compte.
    for (let j = i - 1; j >= 0; j--) {
      if (inside(leaves[j]!.container, c)) {
        mark(leaf);
        return;
      }
    }
  });
  return out;
}

class RunBuilder {
  runs: Run[] = [];
  /** Un bloc vient de se terminer (ou commence) : le prochain contenu ira à la ligne. */
  pendingBreak = false;

  private lastText(): string {
    for (let k = this.runs.length - 1; k >= 0; k--) {
      const t = this.runs[k]!.text;
      if (t) return t;
    }
    return "";
  }

  /** Début de ligne : rien encore, juste après un saut de ligne, ou juste après une puce de liste. */
  atLineStart(): boolean {
    const all = this.lastLine();
    return all === null || /^(• |\d+\. )$/.test(all);
  }

  /** Texte de la ligne en cours (null : ligne vide). */
  private lastLine(): string | null {
    let line = "";
    for (let k = this.runs.length - 1; k >= 0; k--) {
      const t = this.runs[k]!.text;
      const nl = t.lastIndexOf("\n");
      if (nl !== -1) {
        line = t.slice(nl + 1) + line;
        return line === "" ? null : line;
      }
      line = t + line;
    }
    return line === "" ? null : line;
  }

  private endsWithCollapsibleSpace(): boolean {
    for (let k = this.runs.length - 1; k >= 0; k--) {
      const r = this.runs[k]!;
      if (!r.text) continue;
      return r.collapsible && r.text.endsWith(" ");
    }
    return false;
  }

  private trimTrailingCollapsible(): void {
    for (let k = this.runs.length - 1; k >= 0; k--) {
      const r = this.runs[k]!;
      if (!r.collapsible) return;
      const trimmed = r.text.replace(/ +$/, "");
      if (trimmed.length === r.text.length) return;
      r.text = trimmed;
      if (trimmed) return;
      this.runs.splice(k, 1);
    }
  }

  private append(text: string, fmt: Fmt, collapsible: boolean): void {
    this.runs.push({ text, fmt, collapsible });
  }

  /** Va à la ligne si on n'y est pas déjà. */
  ensureBreak(fmt: Fmt): void {
    if (!this.atLineStart()) this.newline(fmt);
  }

  newline(fmt: Fmt): void {
    this.trimTrailingCollapsible();
    this.append("\n", fmt, false);
  }

  text(raw: string, fmt: Fmt, ws: WhiteSpace): void {
    let t = raw;
    if (ws === "collapse") t = t.replace(/[ \t\n\r\f]+/g, " ");
    else if (ws === "pre-line") t = t.replace(/[ \t\f]+/g, " ").replace(/ ?\n ?/g, "\n");
    if (!t) return;
    if (ws !== "pre") {
      const lineStart = this.pendingBreak || this.atLineStart() || this.endsWithCollapsibleSpace();
      if (lineStart && t.startsWith(" ")) t = t.slice(1);
      if (!t) return;
    }
    this.flushPending(fmt);
    this.append(t, fmt, ws !== "pre");
  }

  /** Emoji animé : morceau à part, jamais replié ni fusionné. */
  emoji(fallback: string, fmt: Fmt): void {
    this.flushPending(fmt);
    this.append(fallback, fmt, false);
  }

  /** Saut de ligne explicite (`<br>`). */
  br(fmt: Fmt): void {
    this.flushPending(fmt);
    this.newline(fmt);
  }

  flushPending(fmt: Fmt): void {
    if (!this.pendingBreak) return;
    this.pendingBreak = false;
    this.ensureBreak(fmt);
  }

  /** Puce d'une liste : « • » ou « 1. », toujours en début de ligne (même après un élément de liste vide). */
  marker(text: string, fmt: Fmt): void {
    this.pendingBreak = false;
    if (this.lastText() !== "" && !this.lastText().endsWith("\n")) this.newline(fmt);
    this.append(
      text,
      { ...fmt, b: false, i: false, u: false, s: false, sp: false, code: false, href: null },
      true,
    );
  }

  finish(): Run[] {
    this.trimTrailingCollapsible();
    return this.runs.filter((r) => r.text.length > 0);
  }
}

/**
 * Lit un arbre HTML et en tire les morceaux de texte avec leur mise en forme effective.
 * `rendered` : HTML affiché par un navigateur (éditeur, collage) : ses sauts de ligne fantômes sont ignorés.
 * `editor` : HTML de l'éditeur (texte masqué en `<sub>`, saut de ligne final fantôme).
 */
function toRuns(nodes: HtmlNode[], ws: WhiteSpace, rendered: boolean, editor: boolean): Run[] {
  const ghosts: Placeholders = rendered
    ? placeholderBreaks(nodes, ws, editor)
    : { brs: new Set(), texts: new Set() };
  const out = new RunBuilder();
  const walk = (
    list: HtmlNode[],
    fmt: Fmt,
    mode: WhiteSpace,
    list_: { ordered: boolean; n: number } | null,
  ) => {
    let cellIndex = 0;
    for (const n of list) {
      if (n.type === "text") {
        out.text(ghosts.texts.has(n) ? n.text.slice(0, -1) : n.text, fmt, mode);
        continue;
      }
      const kind = kindOf(n);
      if (kind === "drop") continue;
      if (kind === "br") {
        if (!ghosts.brs.has(n)) out.br(fmt);
        continue;
      }
      if (kind === "img") {
        const alt = imgText(n);
        if (alt) out.text(alt, fmt, "pre");
        continue;
      }
      if (kind === "emoji") {
        // Un morceau à lui seul : l'emoji de remplacement, avec la mise en forme qui l'entoure (et celle posée sur la
        // puce elle-même par le navigateur : gras, texte masqué…). L'animation éventuelle n'est jamais relue.
        const f = fmtOf(n, fmt, "inline", editor);
        out.emoji(customEmojiFallbackOf(n), { ...f, ce: customEmojiIdOf(n) });
        continue;
      }
      const f = fmtOf(n, fmt, kind, editor);
      const childMode = wsOf(n, mode, kind);
      if (kind === "cell") {
        if (cellIndex++ > 0 && !out.atLineStart()) out.text(" ", fmt, "pre");
        walk(n.children, f, childMode, list_);
        continue;
      }
      if (kind === "inline") {
        walk(n.children, f, childMode, list_);
        continue;
      }
      // Blocs (dont citations et blocs de code) : à la ligne avant et après. Les citations et blocs de code venus de
      // Telegram n'ont pas de saut de ligne autour d'eux : on n'en ajoute pas (aller-retour exact).
      const isBlock = kind === "block";
      if (isBlock) out.pendingBreak = out.pendingBreak || !out.atLineStart();
      if (n.tag === "tr") cellIndex = 0;
      let childList = list_;
      if (n.tag === "ul" || n.tag === "ol" || n.tag === "menu" || n.tag === "dir")
        childList = { ordered: n.tag === "ol", n: 0 };
      if (n.tag === "li") {
        const lst = list_ ?? { ordered: false, n: 0 };
        lst.n += 1;
        out.marker(lst.ordered ? `${lst.n}. ` : "• ", fmt);
      }
      walk(n.children, f, childMode, childList);
      if (isBlock) out.pendingBreak = true;
    }
  };
  walk(nodes, EMPTY_FMT, ws, null);
  return out.finish();
}

function sameFmt(a: Fmt, b: Fmt): boolean {
  return (
    a.b === b.b &&
    a.i === b.i &&
    a.u === b.u &&
    a.s === b.s &&
    a.sp === b.sp &&
    a.code === b.code &&
    a.href === b.href &&
    a.pre === b.pre &&
    a.quote === b.quote &&
    a.ce === b.ce
  );
}

function mergeRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    // Un emoji animé reste un morceau à part (deux emojis identiques collés restent deux emojis).
    if (last && !last.fmt.ce && !r.fmt.ce && sameFmt(last.fmt, r.fmt)) last.text += r.text;
    else out.push({ ...r });
  }
  return out;
}

/**
 * Règles d'imbrication de Telegram pour les emojis animés : jamais dans un code ou un bloc de code (l'emoji de
 * remplacement y reste, en texte), jamais dans un lien (le lien est coupé autour de l'emoji).
 */
function fitCustomEmojis(runs: Run[]): Run[] {
  return runs.map((r) => {
    if (!r.fmt.ce) return r;
    if (r.fmt.code || r.fmt.pre !== null) return { ...r, fmt: { ...r.fmt, ce: null } };
    if (r.fmt.href) return { ...r, fmt: { ...r.fmt, href: null } };
    return r;
  });
}

/** Mises en forme « en ligne » d'un saut de ligne gardées seulement si ses deux voisins les ont aussi. */
function sharedInline(own: Fmt, other: Fmt | null): Fmt {
  return {
    ...own,
    b: own.b && !!other?.b,
    i: own.i && !!other?.i,
    u: own.u && !!other?.u,
    s: own.s && !!other?.s,
    sp: own.sp && !!other?.sp,
    href: own.href !== null && other?.href === own.href ? own.href : null,
  };
}

/**
 * Sauts de ligne en bord de mise en forme : Firefox et Chrome rangent souvent le saut de ligne dans la balise voisine
 * (« <b>tournoi<br></b>suite » après ⌘B, Entrée ; « <b>a</b><i><br>b</i> » après un collage de paragraphes). Le message
 * est le même à l'écran, mais le HTML enregistré ne correspond plus à ce que l'équipe a mis en forme. Un saut de ligne
 * au début ou à la fin d'un morceau en gras, italique, souligné, barré, masqué ou lien ne garde que la mise en forme
 * partagée avec le morceau d'à côté. Au milieu d'un morceau (« <b>a\nb</b> »), rien ne change ; code, bloc de code et
 * citation non plus (le saut de ligne y fait partie du contenu).
 */
function liftEdgeBreaks(runs: Run[]): Run[] {
  const out: Run[] = [];
  runs.forEach((run, k) => {
    const { fmt, text } = run;
    const m = /^(\n*)([\s\S]*?)(\n*)$/.exec(text)!;
    const [, lead = "", body = "", trail = ""] = m;
    if (fmt.code || fmt.pre !== null || (!lead && !trail)) {
      out.push(run);
      return;
    }
    const prev = runs[k - 1]?.fmt ?? null;
    const next = runs[k + 1]?.fmt ?? null;
    if (!body) {
      out.push({ ...run, fmt: sharedInline(sharedInline(fmt, prev), next) });
      return;
    }
    if (lead) out.push({ ...run, text: lead, fmt: sharedInline(fmt, prev) });
    out.push({ ...run, text: body });
    if (trail) out.push({ ...run, text: trail, fmt: sharedInline(fmt, next) });
  });
  return out;
}

export function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}

type Target = "telegram" | "editor";
type Tag = { key: string; id: string; open: string; close: string };

/** Balises d'un morceau, de l'extérieur vers l'intérieur, en respectant les règles d'imbrication de Telegram. */
function tagsFor(f: Fmt, target: Target): Tag[] {
  const out: Tag[] = [];
  const simple = (key: string, name: string): Tag => ({
    key,
    id: key,
    open: `<${name}>`,
    close: `</${name}>`,
  });
  if (f.quote !== null)
    out.push({
      key: "quote",
      id: `q${f.quote}`,
      open: f.quote.endsWith("e") ? "<blockquote expandable>" : "<blockquote>",
      close: "</blockquote>",
    });
  if (f.pre !== null) {
    out.push({ key: "pre", id: `p${f.pre}`, open: "<pre>", close: "</pre>" });
    return out;
  }
  if (f.code) {
    out.push(simple("code", "code"));
    return out;
  }
  if (f.href)
    out.push({
      key: "a",
      id: `a:${f.href}`,
      open: `<a href="${escapeAttr(f.href)}">`,
      close: "</a>",
    });
  // Dans l'éditeur, le texte masqué est un <sub> (mis en forme comme un texte masqué par rich-text.css) : c'est la seule
  // façon de le poser et de l'enlever avec les commandes du navigateur (« subscript »), donc annulable par ⌘Z, y compris
  // sur une partie seulement du texte masqué.
  if (f.sp) out.push(simple("sp", target === "telegram" ? "tg-spoiler" : "sub"));
  if (f.b) out.push(simple("b", "b"));
  if (f.i) out.push(simple("i", "i"));
  if (f.u) out.push(simple("u", "u"));
  if (f.s) out.push(simple("s", "s"));
  return out;
}

/**
 * Réécrit les morceaux en HTML. On garde ouvertes les balises encore voulues par le morceau suivant (pas de
 * « </b><b> » inutile) ; la sortie est toujours bien imbriquée.
 * Éditeur : sauts de ligne en `<br>`, plus un `<br>` final quand le texte (ou une citation) finit par un saut de ligne,
 * sans quoi le navigateur n'afficherait pas la dernière ligne vide.
 */
function emit(runs: Run[], target: Target, trailingBreak: boolean): string {
  let out = "";
  const stack: Tag[] = [];
  let lastNewline = false;
  const closeTop = () => {
    const t = stack.pop()!;
    if (target === "editor" && (t.key === "quote" || t.key === "pre")) {
      if (lastNewline) out += "<br>";
      lastNewline = false;
    }
    out += t.close;
  };
  for (const run of runs) {
    const want = tagsFor(run.fmt, target);
    const wantIds = new Set(want.map((t) => t.id));
    let keep = 0;
    while (keep < stack.length && wantIds.has(stack[keep]!.id)) keep++;
    while (stack.length > keep) closeTop();
    const have = new Set(stack.map((t) => t.id));
    for (const t of want) {
      if (have.has(t.id)) continue;
      out += t.open;
      stack.push(t);
    }
    if (run.fmt.ce) {
      out +=
        target === "editor"
          ? customEmojiChipHtml(run.fmt.ce, run.text)
          : `<tg-emoji emoji-id="${run.fmt.ce}">${escapeText(run.text)}</tg-emoji>`;
      lastNewline = false;
      continue;
    }
    const text = escapeText(run.text);
    out += target === "editor" ? text.replace(/\n/g, "<br>") : text;
    lastNewline = run.text.endsWith("\n");
  }
  while (stack.length) closeTop();
  if (target === "editor" && trailingBreak && lastNewline) out += "<br>";
  return out;
}

/**
 * Safari (WebKit) copie les espaces en bord de balise comme un espace insécable dans
 * `<span class="Apple-converted-space">` : collé tel quel, le message garderait des espaces insécables (lignes qui ne
 * se coupent plus au bon endroit). Un espace seul y redevient un espace ordinaire ; une suite d'espaces (insécable et
 * espace alternés, pour garder plusieurs espaces) reste telle quelle. Collage seulement.
 */
function normalizeAppleSpaces(nodes: HtmlNode[], inside = false): void {
  for (const n of nodes) {
    if (n.type === "text") {
      if (inside && n.text === "\u00a0") n.text = " ";
      continue;
    }
    normalizeAppleSpaces(n.children, inside || hasClass(n, "Apple-converted-space"));
  }
}

function runsOf(html: string, source: HtmlSource): Run[] {
  idCounter = 0;
  const nodes = parseHtml(html);
  if (source === "paste") normalizeAppleSpaces(nodes);
  return mergeRuns(
    liftEdgeBreaks(
      mergeRuns(
        fitCustomEmojis(
          toRuns(
            nodes,
            source === "paste" ? "collapse" : "pre",
            source !== "telegram",
            source === "editor",
          ),
        ),
      ),
    ),
  );
}

/**
 * HTML quelconque (contenu de l'éditeur, HTML collé, ancien texte) → HTML Telegram propre et valide.
 * `source` : « editor » et « telegram » gardent les espaces tels quels ; « paste » les replie comme un navigateur.
 */
export function htmlToTelegram(html: string, source: HtmlSource = "editor"): string {
  return emit(runsOf(html, source), "telegram", false);
}

/**
 * HTML Telegram → HTML affiché dans l'éditeur (et dans les aperçus mis en forme). Sûr à injecter : il est réécrit à
 * partir de la liste blanche (texte échappé, liens http(s) seulement).
 * `fragment` : morceau à insérer au curseur (collage), sans `<br>` final de mise en page.
 */
export function telegramToEditorHtml(
  telegramHtml: string,
  opts: { fragment?: boolean } = {},
): string {
  return emit(runsOf(telegramHtml, "telegram"), "editor", !opts.fragment);
}

/** Texte brut (collage sans mise en forme) → HTML Telegram : entités échappées, sauts de ligne gardés. */
export function plainTextToTelegram(text: string): string {
  return escapeText(text.replace(/\r\n?/g, "\n"));
}

/**
 * Texte brut collé : s'il s'agit déjà de HTML Telegram valide (un ancien message copié tel quel, avec ses <b> et ses
 * <a href>), il est repris mis en forme au lieu d'afficher les balises ; sinon il est collé comme du texte.
 */
export function plainPasteToTelegram(text: string): string {
  const t = text.replace(/\r\n?/g, "\n");
  const hasTag =
    /<\/?(b|strong|i|em|u|ins|s|strike|del|a|code|pre|tg-spoiler|tg-emoji|blockquote|span)(\s[^<>]*)?>/i.test(
      t,
    );
  if (hasTag && validateTelegramHtml(t, { max: Number.POSITIVE_INFINITY }).ok)
    return htmlToTelegram(t, "telegram");
  return plainTextToTelegram(t);
}

/** Texte visible d'un HTML (sans balises, entités décodées), comme le compte Telegram. */
export function visibleText(html: string): string {
  return runsOf(html, "telegram")
    .map((r) => r.text)
    .join("");
}

/** Mise en forme au point du curseur, d'après la chaîne des éléments parents (du plus proche au plus lointain). */
export type ActiveFormats = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  spoiler: boolean;
  code: boolean;
  link: string | null;
};

export function formatsOfAncestors(
  ancestors: ReadonlyArray<{ tag: string; attrs: Record<string, string> }>,
): ActiveFormats {
  let f: Fmt = EMPTY_FMT;
  for (let k = ancestors.length - 1; k >= 0; k--) {
    const a = ancestors[k]!;
    const el: HtmlElement = { type: "el", tag: a.tag.toLowerCase(), attrs: a.attrs, children: [] };
    f = fmtOf(el, f, kindOf(el), true);
  }
  return {
    bold: f.b,
    italic: f.i,
    underline: f.u,
    strike: f.s,
    spoiler: f.sp,
    code: f.code,
    link: f.href,
  };
}

/**
 * Lecture seule : entoure les repères connus ({prenom}, {offre}…) d'une pastille, dans un HTML d'éditeur déjà
 * nettoyé (seul le texte entre les balises est touché, jamais une adresse de lien).
 */
export function markPlaceholders(editorHtml: string, keys: readonly string[]): string {
  const known = new Set(keys);
  return editorHtml
    .split(/(<[^>]*>)/)
    .map((part) =>
      part.startsWith("<")
        ? part
        : part.replace(/\{([a-z_]+)\}/g, (m, k: string) =>
            known.has(k) ? `<span class="lap-ph">${m}</span>` : m,
          ),
    )
    .join("");
}

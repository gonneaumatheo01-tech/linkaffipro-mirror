/**
 * Conversion du HTML Telegram des messages (celui que le site enregistre et que le Bot API lit avec
 * `parse_mode: "HTML"`) en texte brut + entités, pour une publication par le compte Telegram connecté (MTProto) :
 * le compte n'a pas de `parse_mode`, il envoie le texte et la liste des mises en forme (positions en unités UTF-16,
 * comme les chaînes JavaScript). Fonctions pures, sans GramJS (testées dans html-entities.test.ts).
 *
 * Balises lues (mêmes que `TELEGRAM_HTML_TAGS` de @linkaffipro/core) : b/strong, i/em, u/ins, s/strike/del,
 * tg-spoiler et span class="tg-spoiler", code, pre (langue par `language` ou par `<code class="language-x">`),
 * a href, blockquote (expandable), tg-emoji emoji-id (emoji animé : l'entité couvre son emoji de remplacement).
 * Une balise inconnue est ignorée (son contenu reste) ; `<br>` devient un retour à la ligne.
 */

export type TextEntityType =
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "spoiler"
  | "code"
  | "pre"
  | "text_link"
  | "blockquote"
  | "custom_emoji";

/** Mise en forme d'une portion du texte (offset et length en unités UTF-16). */
export type TextEntitySpec = {
  type: TextEntityType;
  offset: number;
  length: number;
  /** text_link */
  url?: string;
  /** pre */
  language?: string;
  /** custom_emoji : identifiant Telegram de l'emoji (entier 64 bits en chaîne). */
  customEmojiId?: string;
  /** blockquote repliable */
  collapsed?: boolean;
};

export type ParsedTelegramText = { text: string; entities: TextEntitySpec[] };

/** Emoji de remplacement d'un emoji animé sans contenu (même valeur que `customEmojiTag` de @linkaffipro/core). */
export const EMPTY_CUSTOM_EMOJI_FALLBACK = "⭐";

const SIMPLE_TAGS: Record<string, TextEntityType> = {
  b: "bold",
  strong: "bold",
  i: "italic",
  em: "italic",
  u: "underline",
  ins: "underline",
  s: "strikethrough",
  strike: "strikethrough",
  del: "strikethrough",
  "tg-spoiler": "spoiler",
};

/** Décode les entités HTML que Telegram accepte : &lt; &gt; &amp; &quot; &#39; &apos; et les formes numériques. */
export function decodeHtmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (all, code: string) => {
    const c = code.toLowerCase();
    if (c === "lt") return "<";
    if (c === "gt") return ">";
    if (c === "amp") return "&";
    if (c === "quot") return '"';
    if (c === "apos") return "'";
    const n = c.startsWith("#x")
      ? Number.parseInt(c.slice(2), 16)
      : Number.parseInt(c.slice(1), 10);
    if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return all;
    return String.fromCodePoint(n);
  });
}

/** Échappe un texte brut pour du HTML Telegram. */
export function escapeTelegramHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeTelegramHtml(s).replace(/"/g, "&quot;");
}

/** Attributs d'une balise ouvrante (noms en minuscules, valeurs décodées ; attribut sans valeur → ""). */
function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z][a-zA-Z0-9-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    out[m[1]!.toLowerCase()] = decodeHtmlEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

/** Lien accepté comme mise en forme (même règle que le validateur du site : https, http, tg, mailto). */
function linkUrl(href: string | undefined): string | null {
  const url = (href ?? "").trim();
  if (!/^(https?:\/\/|tg:\/\/|mailto:)/i.test(url)) return null;
  // Mention d'un utilisateur par identifiant : demanderait l'utilisateur lui-même (InputUser), texte simple.
  if (/^tg:\/\/user\?/i.test(url)) return null;
  return url;
}

type Open = {
  tag: string;
  start: number;
  /** Entité à créer à la fermeture (null : balise sans mise en forme, ex. span ordinaire). */
  entity: Omit<TextEntitySpec, "offset" | "length"> | null;
};

const WS = /\s/;

/** Retire les espaces de début et de fin du texte (comme Telegram) en recalant les entités. */
function trimParsed(text: string, entities: TextEntitySpec[]): ParsedTelegramText {
  let lead = 0;
  while (lead < text.length && WS.test(text[lead]!)) lead++;
  let end = text.length;
  while (end > lead && WS.test(text[end - 1]!)) end--;
  const out = text.slice(lead, end);
  const fixed: TextEntitySpec[] = [];
  for (const e of entities) {
    const s = Math.max(e.offset - lead, 0);
    const f = Math.min(e.offset + e.length - lead, out.length);
    if (f > s) fixed.push({ ...e, offset: s, length: f - s });
  }
  return { text: out, entities: fixed };
}

/**
 * HTML Telegram → texte + entités. Les positions sont en unités UTF-16 (un emoji hors du plan de base compte 2).
 * Entités triées par position puis de la plus longue à la plus courte (une entité englobante avant son contenu).
 */
export function parseTelegramHtml(html: string): ParsedTelegramText {
  const src = String(html ?? "").replace(/\r\n?/g, "\n");
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^<>]*)>/g;
  let text = "";
  const entities: TextEntitySpec[] = [];
  const stack: Open[] = [];
  let last = 0;
  let m: RegExpExecArray | null;

  const pushText = (raw: string) => {
    if (raw) text += decodeHtmlEntities(raw);
  };

  while ((m = tagRe.exec(src))) {
    pushText(src.slice(last, m.index));
    last = tagRe.lastIndex;
    const closing = m[1] === "/";
    const tag = m[2]!.toLowerCase();
    const rawAttrs = m[3] ?? "";

    if (tag === "br") {
      text += "\n";
      continue;
    }

    if (closing) {
      // Ferme la balise ouverte de même nom la plus récente (les balises mal imbriquées sont tolérées).
      let idx = -1;
      for (let i = stack.length - 1; i >= 0; i--)
        if (stack[i]!.tag === tag) {
          idx = i;
          break;
        }
      if (idx < 0) continue;
      const open = stack.splice(idx, 1)[0]!;
      if (!open.entity) continue;
      if (open.entity.type === "custom_emoji" && text.length === open.start)
        text += EMPTY_CUSTOM_EMOJI_FALLBACK;
      const length = text.length - open.start;
      if (length > 0) entities.push({ ...open.entity, offset: open.start, length });
      continue;
    }

    const attrs = parseAttrs(rawAttrs);
    const selfClosing = /\/\s*$/.test(rawAttrs);
    let entity: Open["entity"] = null;
    const simple = SIMPLE_TAGS[tag];
    if (simple) entity = { type: simple };
    else if (tag === "span") entity = attrs.class === "tg-spoiler" ? { type: "spoiler" } : null;
    else if (tag === "a") {
      const url = linkUrl(attrs.href);
      entity = url ? { type: "text_link", url } : null;
    } else if (tag === "blockquote")
      entity =
        "expandable" in attrs ? { type: "blockquote", collapsed: true } : { type: "blockquote" };
    else if (tag === "pre")
      entity = attrs.language ? { type: "pre", language: attrs.language } : { type: "pre" };
    else if (tag === "code") {
      const pre = stack[stack.length - 1];
      if (pre?.tag === "pre" && pre.entity?.type === "pre") {
        // <pre><code class="language-x"> : un seul bloc de code, avec sa langue.
        const lang = /(?:^|\s)language-([\w#+.-]+)/.exec(attrs.class ?? "")?.[1];
        if (lang && !pre.entity.language) pre.entity = { ...pre.entity, language: lang };
        entity = null;
      } else entity = { type: "code" };
    } else if (tag === "tg-emoji") {
      const id = (attrs["emoji-id"] ?? "").trim();
      entity =
        /^\d{1,20}$/.test(id) && id !== "0" ? { type: "custom_emoji", customEmojiId: id } : null;
    }
    if (selfClosing) continue;
    stack.push({ tag, start: text.length, entity });
  }
  pushText(src.slice(last));

  // Balises jamais fermées : la mise en forme court jusqu'à la fin du texte.
  for (const open of stack) {
    if (!open.entity) continue;
    if (open.entity.type === "custom_emoji" && text.length === open.start) continue;
    const length = text.length - open.start;
    if (length > 0) entities.push({ ...open.entity, offset: open.start, length });
  }

  const trimmed = trimParsed(text, entities);
  trimmed.entities.sort((a, b) => a.offset - b.offset || b.length - a.length);
  return trimmed;
}

/** Longueur du texte tel que Telegram la compte (unités UTF-16, après retrait des balises et des espaces aux bords). */
export function telegramTextLength(html: string): number {
  return parseTelegramHtml(html).text.length;
}

function openTag(e: TextEntitySpec): string {
  switch (e.type) {
    case "bold":
      return "<b>";
    case "italic":
      return "<i>";
    case "underline":
      return "<u>";
    case "strikethrough":
      return "<s>";
    case "spoiler":
      return "<tg-spoiler>";
    case "code":
      return "<code>";
    case "pre":
      return e.language ? `<pre language="${escapeAttr(e.language)}">` : "<pre>";
    case "text_link":
      return `<a href="${escapeAttr(e.url ?? "")}">`;
    case "blockquote":
      return e.collapsed ? "<blockquote expandable>" : "<blockquote>";
    case "custom_emoji":
      return `<tg-emoji emoji-id="${e.customEmojiId ?? ""}">`;
  }
}

function closeTag(e: TextEntitySpec): string {
  switch (e.type) {
    case "bold":
      return "</b>";
    case "italic":
      return "</i>";
    case "underline":
      return "</u>";
    case "strikethrough":
      return "</s>";
    case "spoiler":
      return "</tg-spoiler>";
    case "code":
      return "</code>";
    case "pre":
      return "</pre>";
    case "text_link":
      return "</a>";
    case "blockquote":
      return "</blockquote>";
    case "custom_emoji":
      return "</tg-emoji>";
  }
}

/**
 * Texte + entités → HTML Telegram (sens inverse, pour vérifier l'aller-retour et relire un message). Les entités qui se
 * chevauchent sans s'emboîter sont coupées pour rester bien imbriquées.
 */
export function entitiesToTelegramHtml(text: string, entities: readonly TextEntitySpec[]): string {
  const valid = entities
    .filter((e) => e.length > 0 && e.offset >= 0 && e.offset + e.length <= text.length)
    .map((e, i) => ({ e, i, end: e.offset + e.length }))
    .sort((a, b) => a.e.offset - b.e.offset || b.e.length - a.e.length || a.i - b.i);
  // Points de coupure : chaque début et fin d'entité.
  const cuts = new Set<number>([0, text.length]);
  for (const v of valid) {
    cuts.add(v.e.offset);
    cuts.add(v.end);
  }
  const points = [...cuts].sort((a, b) => a - b);
  let out = "";
  let openStack: typeof valid = [];
  for (let k = 0; k < points.length; k++) {
    const pos = points[k]!;
    // Ferme ce qui se termine ici, et ce qui est au-dessus (rouvert ensuite si besoin).
    const ending = openStack.findIndex((v) => v.end <= pos);
    if (ending >= 0) {
      const reopen = openStack.slice(ending).filter((v) => v.end > pos);
      for (let j = openStack.length - 1; j >= ending; j--) out += closeTag(openStack[j]!.e);
      openStack = openStack.slice(0, ending);
      for (const v of reopen) {
        out += openTag(v.e);
        openStack.push(v);
      }
    }
    for (const v of valid)
      if (v.e.offset === pos && v.end > pos) {
        out += openTag(v.e);
        openStack.push(v);
      }
    const next = points[k + 1];
    if (next !== undefined) out += escapeTelegramHtml(text.slice(pos, next));
  }
  for (let j = openStack.length - 1; j >= 0; j--) out += closeTag(openStack[j]!.e);
  return out;
}

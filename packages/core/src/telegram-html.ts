/**
 * HTML Telegram : validation, nettoyage et mesures.
 * Référence : https://core.telegram.org/bots/api#html-style
 */
export const TELEGRAM_HTML_TAGS = ["b", "strong", "i", "em", "u", "ins", "s", "strike", "del", "a", "code", "pre", "tg-spoiler", "span", "blockquote", "tg-emoji"] as const;
export type TelegramHtmlTag = (typeof TELEGRAM_HTML_TAGS)[number];
export const TELEGRAM_TEXT_MAX = 4096;
export const TELEGRAM_CAPTION_MAX = 1024;

const TAG_SET = new Set<string>(TELEGRAM_HTML_TAGS);
/** Attributs autorisés par balise. */
const ALLOWED_ATTRS: Record<string, string[]> = { a: ["href"], span: ["class"], pre: ["language"], code: ["class"], "tg-emoji": ["emoji-id"], blockquote: ["expandable"] };

export type HtmlValidation = { ok: true; html: string; textLength: number } | { ok: false; error: string };

/** Décode les entités HTML de base (pour mesurer la longueur réelle du texte). */
export function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Échappe un texte brut pour l'inclure dans du HTML Telegram. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Longueur du texte visible (sans balises, entités décodées) — c'est cette longueur que Telegram limite. */
export function textLength(html: string): number {
  return decodeEntities(html.replace(/<[^>]*>/g, "")).length;
}

/** Retire toutes les balises (aperçu court). */
export function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ""));
}

/**
 * Valide un HTML Telegram : balises autorisées, attributs autorisés, fermeture correcte, longueur.
 * Renvoie le HTML normalisé (balises en minuscules) ou une erreur lisible en français.
 */
export function validateTelegramHtml(input: string, opts: { max?: number } = {}): HtmlValidation {
  const max = opts.max ?? TELEGRAM_TEXT_MAX;
  const html = input.replace(/\r\n/g, "\n");
  const stack: string[] = [];
  let out = "";
  const re = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*?)?)\s*(\/?)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    out += html.slice(last, m.index);
    last = re.lastIndex;
    const raw = m[0];
    const tag = m[1]!.toLowerCase();
    const attrs = m[2] ?? "";
    const closing = raw.startsWith("</");
    const selfClosing = m[3] === "/";
    if (!TAG_SET.has(tag)) return { ok: false, error: `Balise <${tag}> non acceptée par Telegram. Balises possibles : ${TELEGRAM_HTML_TAGS.join(", ")}.` };
    if (selfClosing) return { ok: false, error: `Balise auto-fermante <${tag}/> non acceptée.` };
    if (closing) {
      const open = stack.pop();
      if (open !== tag) return { ok: false, error: open ? `Balise <${open}> non fermée avant </${tag}>.` : `Fermeture </${tag}> sans ouverture.` };
      out += `</${tag}>`;
      continue;
    }
    const attrRe = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a: RegExpExecArray | null;
    const kept: string[] = [];
    let rest = attrs;
    while ((a = attrRe.exec(attrs))) {
      const name = a[1]!.toLowerCase();
      const value = a[3] ?? a[4] ?? "";
      if (!(ALLOWED_ATTRS[tag] ?? []).includes(name)) return { ok: false, error: `Attribut « ${name} » non accepté sur <${tag}>.` };
      if (tag === "a" && name === "href" && !/^(https?:\/\/|tg:\/\/|mailto:)/i.test(value.trim())) return { ok: false, error: `Lien invalide : « ${value.slice(0, 40)} » (il doit commencer par https://).` };
      if (tag === "span" && name === "class" && value !== "tg-spoiler") return { ok: false, error: `<span> n'accepte que class="tg-spoiler".` };
      kept.push(`${name}="${value.replace(/"/g, "&quot;")}"`);
      rest = rest.replace(a[0], "");
    }
    if (rest.trim() !== "") return { ok: false, error: `Attributs mal formés sur <${tag}> : « ${rest.trim().slice(0, 30)} ».` };
    if (tag === "a" && !kept.some((k) => k.startsWith("href="))) return { ok: false, error: "Un lien <a> doit avoir un href." };
    stack.push(tag);
    out += `<${tag}${kept.length ? " " + kept.join(" ") : ""}>`;
  }
  out += html.slice(last);
  if (stack.length > 0) return { ok: false, error: `Balise <${stack[stack.length - 1]}> non fermée.` };
  // Un « < » qui n'est pas une balise doit être échappé.
  if (/<(?![a-zA-Z/])/.test(out)) return { ok: false, error: "Le caractère « < » doit être écrit &lt; quand il ne commence pas une balise." };
  const len = textLength(out);
  if (len > max) return { ok: false, error: `Texte trop long : ${len} caractères, maximum ${max}.` };
  return { ok: true, html: out.trim(), textLength: len };
}

/** Remplace les placeholders {prenom}, {canal}, {liste_canaux}, {delai}, {bot}… (valeurs échappées). */
export function fillPlaceholders(html: string, vars: Record<string, string | undefined>): string {
  return html.replace(/\{([a-z_]+)\}/g, (m, k: string) => (vars[k] !== undefined ? escapeHtml(vars[k]!) : m));
}

/**
 * Texte Telegram + entités (mises en forme d'un message reçu) → HTML Telegram (`parse_mode: "HTML"`), PUR. Sert au
 * texte corrigé par l'admin (« ✏️ Corriger ») : « Je t'aime <3 » devient `Je t'aime &lt;3`, le gras, les liens et les
 * emojis animés sont gardés. Positions en unités UTF-16 (comme les chaînes JavaScript et l'API Bot).
 */

/** Entité d'un message reçu (forme de l'API Bot, seuls les champs lus ici). */
export type TelegramTextEntity = {
  type: string;
  offset: number;
  length: number;
  url?: string;
  language?: string;
  custom_emoji_id?: string;
};

export function escapeTelegramHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeTelegramHtml(s).replace(/"/g, "&quot;");
}

/** Balises ouvrante et fermante d'une entité ; null = entité sans rendu (mention, hashtag, adresse brute…). */
function tagsOf(e: TelegramTextEntity): [string, string] | null {
  switch (e.type) {
    case "bold":
      return ["<b>", "</b>"];
    case "italic":
      return ["<i>", "</i>"];
    case "underline":
      return ["<u>", "</u>"];
    case "strikethrough":
      return ["<s>", "</s>"];
    case "spoiler":
      return ["<tg-spoiler>", "</tg-spoiler>"];
    case "code":
      return ["<code>", "</code>"];
    case "pre":
      return e.language
        ? [`<pre><code class="language-${escapeAttr(e.language)}">`, "</code></pre>"]
        : ["<pre>", "</pre>"];
    case "text_link":
      return e.url ? [`<a href="${escapeAttr(e.url)}">`, "</a>"] : null;
    case "blockquote":
      return ["<blockquote>", "</blockquote>"];
    case "expandable_blockquote":
      return ["<blockquote expandable>", "</blockquote>"];
    case "custom_emoji":
      return e.custom_emoji_id ? [`<tg-emoji emoji-id="${escapeAttr(e.custom_emoji_id)}">`, "</tg-emoji>"] : null;
    default:
      return null;
  }
}

type Open = { end: number; open: string; close: string; order: number };

/**
 * Convertit. Entités imbriquées : rendues imbriquées ; entités qui se chevauchent : la plus intérieure est fermée
 * puis rouverte (HTML toujours bien formé).
 */
export function telegramEntitiesToHtml(text: string, entities?: readonly TelegramTextEntity[] | null): string {
  const list = (entities ?? [])
    .map((e, order) => ({ e, order, tags: tagsOf(e) }))
    .filter((x): x is { e: TelegramTextEntity; order: number; tags: [string, string] } =>
      x.tags !== null && x.e.length > 0 && x.e.offset >= 0 && x.e.offset < text.length,
    )
    .sort((a, b) => a.e.offset - b.e.offset || b.e.length - a.e.length || a.order - b.order);
  if (list.length === 0) return escapeTelegramHtml(text);

  const cuts = new Set<number>([0, text.length]);
  for (const { e } of list) {
    cuts.add(e.offset);
    cuts.add(Math.min(text.length, e.offset + e.length));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const stack: Open[] = [];
  let out = "";
  let next = 0;
  for (let i = 0; i < points.length; i++) {
    const pos = points[i]!;
    // Fermer ce qui finit ici ; ce qui est au-dessus et continue est fermé puis rouvert.
    if (stack.some((o) => o.end <= pos)) {
      const reopen: Open[] = [];
      while (stack.some((o) => o.end <= pos)) {
        const top = stack.pop()!;
        out += top.close;
        if (top.end > pos) reopen.unshift(top);
      }
      for (const o of reopen) {
        out += o.open;
        stack.push(o);
      }
    }
    while (next < list.length && list[next]!.e.offset === pos) {
      const { e, tags, order } = list[next]!;
      const o: Open = { end: Math.min(text.length, e.offset + e.length), open: tags[0], close: tags[1], order };
      out += o.open;
      stack.push(o);
      next++;
    }
    const to = points[i + 1];
    if (to !== undefined) out += escapeTelegramHtml(text.slice(pos, to));
  }
  while (stack.length) out += stack.pop()!.close;
  return out;
}

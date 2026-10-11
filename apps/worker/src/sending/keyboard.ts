import type { InlineKeyboardButton, InlineKeyboardMarkup } from "grammy/types";

/**
 * Format JSON des boutons d'un message (`Post.buttons`) : un tableau de lignes, chaque ligne un tableau de boutons.
 * - URL : lien direct.
 * - BUTTON : lien traqué anonyme goolink (`TrackingLink` kind BUTTON rattaché au post ; `slug`).
 * - OFFER : offre personnalisée (`TrackingLink` kind OFFER ; ouvre le bot avec `start=o<slug>_<code post>`).
 */
export type PostButton = {
  text: string;
  type: "URL" | "BUTTON" | "OFFER";
  url?: string;
  trackingLinkId?: string;
  slug?: string;
  affiliateCampaignId?: string;
};
export type PostButtonRow = PostButton[];

export function parseButtons(value: unknown): PostButtonRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => (Array.isArray(row) ? row.filter((b) => b && typeof b === "object" && typeof (b as PostButton).text === "string") : []))
    .filter((row) => row.length > 0) as PostButtonRow[];
}

export type KeyboardContext = { trackingBaseUrl: string; botUsername: string; postCode: string };

/** URL finale d'un bouton selon son type. Renvoie null si le bouton est inutilisable (pas d'URL/slug). */
export function buttonUrl(b: PostButton, ctx: KeyboardContext): string | null {
  const base = ctx.trackingBaseUrl.replace(/\/$/, "");
  switch (b.type) {
    case "URL":
      return b.url && /^https?:\/\//i.test(b.url) ? b.url : null;
    case "BUTTON":
      return b.slug ? `${base}/${b.slug}` : null;
    case "OFFER":
      // Sans code de message (message à un groupe dont le conteneur manque) : `o<slug>`, jamais `o<slug>_` (refusé).
      return b.slug ? `https://t.me/${ctx.botUsername}?start=o${b.slug}${ctx.postCode ? `_${ctx.postCode}` : ""}` : null;
    default:
      return null;
  }
}

/** Construit le clavier inline Telegram ; les boutons sans URL valide sont ignorés. */
export function buildInlineKeyboard(rows: PostButtonRow[], ctx: KeyboardContext): InlineKeyboardMarkup | undefined {
  const keyboard: InlineKeyboardButton[][] = [];
  for (const row of rows) {
    const line: InlineKeyboardButton[] = [];
    for (const b of row) {
      const url = buttonUrl(b, ctx);
      if (url) line.push({ text: b.text.slice(0, 64), url });
    }
    if (line.length > 0) keyboard.push(line);
  }
  return keyboard.length > 0 ? { inline_keyboard: keyboard } : undefined;
}

/** Clavier pour un message privé (`OutboundMessage.buttons` : lignes de { text, url }). */
export function buildDmKeyboard(value: unknown): InlineKeyboardMarkup | undefined {
  if (!Array.isArray(value)) return undefined;
  const keyboard: InlineKeyboardButton[][] = [];
  for (const row of value) {
    if (!Array.isArray(row)) continue;
    const line: InlineKeyboardButton[] = [];
    for (const b of row as Array<{ text?: string; url?: string; callbackData?: string }>) {
      if (!b || typeof b.text !== "string") continue;
      if (b.url && /^(https?:\/\/|tg:\/\/)/i.test(b.url)) line.push({ text: b.text.slice(0, 64), url: b.url });
      else if (b.callbackData) line.push({ text: b.text.slice(0, 64), callback_data: b.callbackData.slice(0, 64) });
    }
    if (line.length > 0) keyboard.push(line);
  }
  return keyboard.length > 0 ? { inline_keyboard: keyboard } : undefined;
}

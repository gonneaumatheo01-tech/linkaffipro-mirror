/**
 * Phase 31, chantier B — posts de l'aperçu public `https://t.me/s/<nom>` (section 3.2).
 *
 * La lecture (pagination `?before=`, rythme de 3 s, arrêt à 90 jours, posts de service ignorés) est celle de la phase
 * 27 (`channel-reader/web-preview.ts`, `readWebPreview`) : on ne réécrit pas de second lecteur. Le lecteur
 * existant ne garde que le texte, la date, le média, les vues et le nombre de liens ; `parseProspectPreview` relit le
 * MÊME HTML (déjà reçu, aucune requête de plus) pour les champs utiles à la prospection : origine d'un transfert,
 * réactions, commentaires, boutons et leurs adresses, signature d'auteur, liens et mentions.
 *
 * 100 posts, 5 pages, 90 jours au plus (`PROSPECTION_LIMITS`). Le texte reste en mémoire du job : il n'est jamais écrit
 * en base (règle 3). Aucun lien n'est suivi, aucun média n'est téléchargé.
 */
import { readWebPreview } from "../../channel-reader/web-preview";
import { PROSPECTION_LIMITS, type ProspectionDeps, type ProspectPost } from "../contract";
import { allClassIndexes, attrOf, classIndexOf, innerByClass, innerElement, openTagAt, parsePreviewViews, previewHtmlToText } from "./html";
import { enrichNow } from "./ai";
import { enrichFetch } from "./net";

/** Champs complémentaires d'un post, relus dans le HTML de l'aperçu. */
export type ProspectPostExtras = {
  id: number;
  forwardedFrom: string | null;
  comments: number | null;
  reactions: number | null;
  buttons: Array<{ text: string; url: string }>;
  signature: string | null;
  links: string[];
  mentions: string[];
};

export type ParsedProspectPreview = {
  /** En-tête de l'aperçu (abonnés affichés, description) : repli si la page `t.me/<nom>` est muette. */
  subscribersShown: number | null;
  description: string | null;
  posts: ProspectPostExtras[];
};

const TME_HOST = /^(?:https?:)?\/\/(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\//i;
const USERNAME = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;
/** Chemins de t.me qui ne sont pas des noms de canaux. */
const TME_RESERVED = new Set(["s", "c", "joinchat", "addlist", "share", "proxy", "socks", "iv", "login", "addstickers", "addemoji", "setlanguage", "confirmphone", "bg", "boost", "giftcode", "invoice", "contact", "m"]);

/** Nom public d'une adresse t.me (`https://t.me/nom`, `t.me/s/nom`, `t.me/nom/123`) ; invitation ou chemin réservé → null. */
export function tmeUsernameOf(href: string): string | null {
  if (!TME_HOST.test(href)) return null;
  const parts = href.replace(TME_HOST, "").split(/[/?#]/).filter(Boolean);
  if (!parts.length) return null;
  let name = parts[0]!;
  if (name === "s" && parts[1]) name = parts[1];
  else if (TME_RESERVED.has(name.toLowerCase()) || name.startsWith("+")) return null;
  return USERNAME.test(name) ? name.toLowerCase() : null;
}

/** Mentions « @nom » d'un texte (minuscules, sans doublon, sans le « @ »). */
export function mentionsIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?<![\w@.])@([A-Za-z][A-Za-z0-9_]{3,31})\b/g)) out.add(m[1]!.toLowerCase());
  return [...out];
}

/** Nombre total des réactions affichées (« 1.2K », « 56K »…), null si le bloc des réactions est absent. */
function reactionsOf(chunk: string): number | null {
  const box = classIndexOf(chunk, "tgme_widget_message_reactions");
  if (box < 0) return null;
  const inner = innerElement(chunk, box) ?? "";
  let total = 0;
  for (const i of allClassIndexes(inner, "tgme_reaction")) {
    const span = innerElement(inner, i) ?? "";
    // Le nombre suit l'emoji (balises retirées) ; les réactions payantes (étoiles) comptent aussi.
    const n = parsePreviewViews(previewHtmlToText(span).replace(/[^\d.,KMB]/gi, ""));
    total += n ?? 0;
  }
  return total;
}

/** Commentaires (groupe de discussion lié) : « 12 comments », null s'ils ne sont pas affichés. */
function commentsOf(chunk: string): number | null {
  const i = classIndexOf(chunk, "tgme_widget_message_replies");
  if (i < 0) return null;
  const inner = innerElement(chunk, i) ?? "";
  const count = innerByClass(inner, "tgme_widget_message_replies_count");
  const raw = previewHtmlToText(count ?? inner).match(/[\d.,]+\s?[KM]?/i)?.[0] ?? "";
  return parsePreviewViews(raw.replace(/\s/g, "")) ?? 0;
}

function buttonsOf(chunk: string): Array<{ text: string; url: string }> {
  const out: Array<{ text: string; url: string }> = [];
  for (const i of allClassIndexes(chunk, "tgme_widget_message_inline_button")) {
    const tag = openTagAt(chunk, i);
    const url = attrOf(tag, "href");
    if (!url || !/^(https?:)?\/\//i.test(url)) continue;
    const text = previewHtmlToText(innerElement(chunk, i) ?? "").slice(0, 80);
    out.push({ text, url: url.startsWith("//") ? `https:${url}` : url });
  }
  return out;
}

function forwardedFromOf(chunk: string): string | null {
  const box = classIndexOf(chunk, "tgme_widget_message_forwarded_from");
  if (box < 0) return null;
  const nameIdx = classIndexOf(chunk, "tgme_widget_message_forwarded_from_name", box);
  if (nameIdx < 0) return "inconnu";
  const href = attrOf(openTagAt(chunk, nameIdx), "href");
  const user = href ? tmeUsernameOf(href) : null;
  if (user) return user;
  // Origine cachée ou sans nom public : le nom affiché, ou « inconnu » (toujours un transfert).
  return previewHtmlToText(innerElement(chunk, nameIdx) ?? "").slice(0, 64) || "inconnu";
}

/** Liens d'un texte (adresses externes et t.me ; ni hashtags, ni recherche interne). */
function linksOf(textHtml: string): string[] {
  const out: string[] = [];
  for (const m of textHtml.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>/gi)) {
    let href = m[1] ?? "";
    if (href.startsWith("?q=")) continue;
    if (href.startsWith("//")) href = `https:${href}`;
    if (/^https?:\/\//i.test(href)) out.push(href.replace(/&amp;/g, "&"));
  }
  // Adresses écrites en clair sans lien (rares sur t.me, qui les rend cliquables, mais présentes dans les tests).
  const plain = previewHtmlToText(textHtml.replace(/<a\b[\s\S]*?<\/a>/gi, " "));
  for (const m of plain.matchAll(/\bhttps?:\/\/[^\s<>"')]+/gi)) out.push(m[0]);
  return [...new Set(out)];
}

/** Relit une page `t.me/s/<nom>` pour les champs de prospection (fonction pure, même découpage que la phase 27). */
export function parseProspectPreview(html: string, username: string): ParsedProspectPreview {
  const lower = username.toLowerCase();
  const counters = innerByClass(html, "tgme_channel_info_counters");
  let subscribersShown: number | null = null;
  if (counters) {
    const m = /<span class="counter_value">([^<]*)<\/span>\s*<span class="counter_type">(subscribers?|members?)<\/span>/i.exec(counters);
    subscribersShown = m ? parsePreviewViews(m[1]) : null;
  }
  const descHtml = innerByClass(html, "tgme_channel_info_description");
  const description = descHtml !== null ? previewHtmlToText(descHtml) || null : null;
  const posts: ProspectPostExtras[] = [];
  for (const chunk of html.split(/<div class="tgme_widget_message_wrap\b/).slice(1)) {
    const head = chunk.match(/<div class="([^"]*\btgme_widget_message\b[^"]*)"[^>]*data-post="([^"/]+)\/(\d+)"/);
    if (!head || /\bservice_message\b/.test(head[1]!) || head[2]!.toLowerCase() !== lower) continue;
    const textHtml = innerByClass(chunk, "tgme_widget_message_text") ?? "";
    const text = previewHtmlToText(textHtml);
    const links = linksOf(textHtml);
    const mentions = new Set(mentionsIn(text));
    for (const l of links) {
      const u = tmeUsernameOf(l);
      if (u) mentions.add(u);
    }
    mentions.delete(lower);
    const sigHtml = innerByClass(chunk, "tgme_widget_message_from_author");
    posts.push({
      id: Number(head[3]),
      forwardedFrom: forwardedFromOf(chunk),
      comments: commentsOf(chunk),
      reactions: reactionsOf(chunk),
      buttons: buttonsOf(chunk),
      signature: sigHtml !== null ? previewHtmlToText(sigHtml).slice(0, 64) || null : null,
      links,
      mentions: [...mentions],
    });
  }
  return { subscribersShown, description, posts };
}

export type ProspectPostsResult =
  | { ok: true; posts: ProspectPost[]; pages: number; subscribersShown: number | null; description: string | null }
  | { ok: false; reason: "not_found" | "private" | "restricted" | "error"; message: string };

/**
 * Lit les posts d'un canal public : lecteur de la phase 27 (pages, rythme, 90 jours) branché sur la lecture polie,
 * puis relecture des pages reçues par `parseProspectPreview`. Posts rendus du plus récent au plus ancien.
 */
export async function readProspectPosts(
  deps: ProspectionDeps,
  username: string,
  /** Phase 32 (Veilleur, relecture allégée) : 1 page et 20 posts au lieu de 5 pages et 100 posts. */
  limits: { maxPosts?: number; maxPages?: number } = {},
): Promise<ProspectPostsResult> {
  const pages = new Map<string, string>();
  const fetchPage = async (url: string) => {
    const res = await enrichFetch(deps, url, "tme");
    // Redirection vers la page du canal (aperçu fermé) : rendue comme telle au lecteur, jamais suivie plus loin.
    const status = res.status === 200 && res.finalUrl !== url && !/\/s\//.test(res.finalUrl) ? 302 : res.status;
    if (status === 200) pages.set(url, res.body);
    return { status, body: status === 200 ? res.body : "" };
  };
  const read = await readWebPreview(fetchPage, username, {
    now: enrichNow(deps),
    sleep: deps.sleep,
    clock: deps.clock,
    maxPosts: Math.min(limits.maxPosts ?? PROSPECTION_LIMITS.maxPostsPerChannel, PROSPECTION_LIMITS.maxPostsPerChannel),
    maxAgeDays: PROSPECTION_LIMITS.maxAgeDays,
    maxPages: Math.min(limits.maxPages ?? PROSPECTION_LIMITS.maxPreviewPages, PROSPECTION_LIMITS.maxPreviewPages),
  });
  if (!read.ok) {
    const reason = read.reason === "not_found" || read.reason === "private" || read.reason === "restricted" ? read.reason : "error";
    return { ok: false, reason, message: read.message };
  }
  const extras = new Map<number, ProspectPostExtras>();
  let subscribersShown: number | null = null;
  let description: string | null = null;
  for (const body of pages.values()) {
    const parsed = parseProspectPreview(body, username);
    subscribersShown ??= parsed.subscribersShown;
    description ??= parsed.description;
    for (const p of parsed.posts) if (!extras.has(p.id)) extras.set(p.id, p);
  }
  const posts: ProspectPost[] = read.posts.map((p) => {
    const x = extras.get(p.externalId);
    return {
      id: p.externalId,
      postedAt: p.postedAt,
      text: p.text ?? "",
      mediaKind: p.mediaKind,
      views: p.views,
      forwardedFrom: x?.forwardedFrom ?? null,
      comments: x?.comments ?? null,
      reactions: x?.reactions ?? null,
      buttons: x?.buttons ?? [],
      signature: x?.signature ?? null,
      links: x?.links ?? [],
      mentions: x?.mentions ?? [],
    };
  });
  return { ok: true, posts, pages: read.pages ?? pages.size, subscribersShown, description };
}

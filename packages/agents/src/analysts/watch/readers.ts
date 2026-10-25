/**
 * Phase 29, chantier A : lecteurs par type de source → `RawItem[]` (aucune IA ici, la page est une DONNÉE).
 *
 * - `fetchForum` : page HTML (sélecteurs de `scrapeConfig.selectors`, sinon repli générique titre / texte / auteur /
 *   date / lien), pagination (lien « suivant », motif `{n}` ou paramètre), 50 pages au plus.
 * - `fetchReddit` : JSON public `/r/<x>/new.json?limit=…` ; pseudonyme seulement. Si le robots.txt de Reddit refuse la
 *   lecture, repli par la recherche web (`site:reddit.com/r/<x>`), jamais de contournement.
 * - `fetchTelegramPublic` : aperçu `t.me/s/<nom>` par la mécanique de la phase 27 (`readWebPreview`).
 * - `searchNews` / `searchX` : recherche web (outil serveur de l'API Claude) dans la langue locale, résultats sourcés.
 *
 * Données minimales (règle 3) : seul un pseudonyme est gardé comme auteur (jamais un nom qui ressemble à un vrai nom,
 * une adresse, un lien de profil) ; courriels, téléphones et liens de profil sont retirés du texte.
 */
import { parseHtml, querySelectorAll, textOf, type HtmlNode } from "../../bookmakers/read/html";
import { normalizeChannelUsername, readWebPreview } from "../../inspiration/sources/web-preview";
import { ANALYSTS_LIMITS, type AnalystsWeb, type Market, type RawItem } from "../contract";
import { cleanLine } from "./ai";
import { PoliteFetchError } from "./polite";
import { safeHttpUrl } from "./server-tools";
import { localQuery } from "./terms";

/** Réglage de lecture d'une source (`TrendSource.scrapeConfig`), jamais d'identifiant. */
export type WatchScrapeConfig = {
  rateLimitMs?: number;
  maxPages?: number;
  /** « page » : lecture directe de l'adresse ; « search » : recherche web (forums fermés aux robots, actualités, X). */
  mode?: "page" | "search";
  /** Mots-clés de la recherche (sinon composés dans la langue locale). */
  query?: string;
  allowedDomains?: string[];
  selectors?: { item?: string; title?: string; text?: string; author?: string; date?: string; link?: string; next?: string };
  /** Motif d'adresse des pages suivantes (`{n}` = numéro de page), ou paramètre de requête. */
  pagination?: { pattern?: string; param?: string };
  /** Actualités : articles lus en entier après la recherche (0 = extraits seulement). */
  fetchArticles?: number;
  /** Reddit : nombre de posts demandés (100 au plus). */
  limit?: number;
  /** Intervalle propre à la source (heures), sinon le réglage général. */
  intervalHours?: number;
};

export class WatchReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WatchReadError";
  }
}

export const RAW_TEXT_MAX_CHARS = 20_000;
const MIN_TEXT_CHARS = 20;

// ---------------------------------------------------------------- données personnelles

const PROFILE_LINK_RE =
  /\bhttps?:\/\/[^\s]*(?:\/(?:u|user|users|members?|profile|profiles|author|authors)\/[^\s]*|(?:x|twitter)\.com\/(?!(?:i|search|hashtag)\b)[A-Za-z0-9_]{1,15}\/?(?=[\s)]|$))/gi;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_RE = /(?:\+|00)\d[\d\s.-]{7,}\d|\b0\d(?:[\s.-]?\d{2}){4}\b/g;

/** Retire courriels, téléphones et liens de profil d'un texte lu (règle 3). */
export function scrubPersonalData(text: string): string {
  return text.replace(PROFILE_LINK_RE, "[profil retiré]").replace(EMAIL_RE, "[courriel retiré]").replace(PHONE_RE, "[numéro retiré]");
}

/**
 * Pseudonyme gardé comme auteur (40 caractères), sinon null : jamais une adresse, un courriel, un lien, ni un
 * « Prénom Nom » (ressemble à un vrai nom), ni un compte supprimé.
 */
export function pseudonymOf(raw: unknown): string | null {
  const s = cleanLine(raw, 80).replace(/^by\s+|^par\s+/i, "");
  if (!s || s.length > 40) return null;
  if (/^\[?(deleted|removed|supprimé)\]?$/i.test(s) || /^automoderator$/i.test(s)) return null;
  if (/[@/:]/.test(s.replace(/^@/, "")) || /\.\w{2,}$/.test(s) || /https?|www\./i.test(s)) return null;
  if (/^\p{Lu}\p{Ll}+(?:[ -]\p{Lu}\p{Ll}+)+$/u.test(s)) return null;
  return s;
}

function rawItem(p: { url: string; title?: unknown; text: unknown; author?: unknown; publishedAt?: string | null; language?: string | null }): RawItem | null {
  const text = scrubPersonalData(
    String(typeof p.text === "string" ? p.text : "")
      .replace(/\r/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  ).slice(0, RAW_TEXT_MAX_CHARS);
  const title = cleanLine(p.title, 300) || null;
  if ((text + (title ?? "")).length < MIN_TEXT_CHARS) return null;
  return { url: p.url, title, text: text || title || "", author: pseudonymOf(p.author), publishedAt: p.publishedAt ?? null, language: p.language ?? null };
}

function isoOf(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v < 1e11 ? v * 1000 : v).toISOString();
  if (typeof v !== "string" || !v.trim()) return null;
  if (/^\d{9,13}$/.test(v.trim())) return isoOf(Number(v.trim()));
  const t = Date.parse(v.trim());
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

const looksLikeHtml = (body: string) => /<(html|body|div|article|p|li|section|a)\b/i.test(body.slice(0, 5000));

function abs(href: string | undefined, base: string): string | null {
  if (!href || href.startsWith("#") || /^(javascript|mailto|tel):/i.test(href)) return null;
  try {
    return safeHttpUrl(new URL(href, base).toString());
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- forums (HTML)

const first = (scope: HtmlNode, sel: string | undefined): HtmlNode | null => (sel ? (querySelectorAll(scope, sel)[0] ?? null) : null);

const GENERIC_ITEMS = ["article", "[class~=structItem]", "[class~=thread]", "[class~=topic]", "[class~=post]", "[class~=message]", "[class~=entry]", "[class~=news-item]"];
const GENERIC_TITLE = "h1, h2, h3, h4, [class*=title]";
const GENERIC_TEXT = "[class*=snippet], [class*=excerpt], [class*=summary], [class*=body], [class*=content], p";
const GENERIC_AUTHOR = "[class*=author], [class*=username], [rel=author], [itemprop=author]";

function dateOfNode(n: HtmlNode | null): string | null {
  if (!n) return null;
  return isoOf(n.attrs.datetime ?? n.attrs["data-time"] ?? n.attrs["data-date"] ?? n.attrs.content ?? textOf(n));
}

function genericItems(root: HtmlNode): HtmlNode[] {
  for (const sel of GENERIC_ITEMS) {
    const found = querySelectorAll(root, sel);
    // Éléments les plus extérieurs seulement (un post n'est pas lu deux fois par ses parties).
    const outer = found.filter((n) => !found.some((o) => o !== n && isAncestor(o, n)));
    if (outer.filter((n) => querySelectorAll(n, "a[href]").length > 0).length >= 2) return outer;
  }
  return [];
}

function isAncestor(a: HtmlNode, b: HtmlNode): boolean {
  for (let p = b.parent; p; p = p.parent) if (p === a) return true;
  return false;
}

/** Contenus d'une page de forum ou de liste d'articles (fonction pure). */
export function parseForumPage(body: string, pageUrl: string, config: WatchScrapeConfig = {}, language: string | null = null): { items: RawItem[]; next: string | null } {
  if (!looksLikeHtml(body)) {
    // Texte déjà extrait (lecture de repli par l'outil web_fetch) : un seul contenu.
    const lines = body.trim().split(/\n+/);
    const item = rawItem({ url: pageUrl, title: lines[0], text: lines.slice(1).join("\n") || lines[0], language });
    return { items: item ? [item] : [], next: null };
  }
  const root = parseHtml(body);
  const s = config.selectors ?? {};
  const nodes = s.item ? querySelectorAll(root, s.item) : genericItems(root);
  const items: RawItem[] = [];
  for (const n of nodes) {
    const titleNode = s.title ? first(n, s.title) : first(n, GENERIC_TITLE);
    const linkNode = (s.link ? first(n, s.link) : null) ?? (titleNode ? (titleNode.tag === "a" ? titleNode : first(titleNode, "a[href]")) : null) ?? first(n, "a[href]");
    const url = abs(linkNode?.attrs.href, pageUrl);
    if (!url) continue;
    const title = titleNode ? textOf(titleNode) : linkNode ? textOf(linkNode) : "";
    const textNodes = s.text ? querySelectorAll(n, s.text) : querySelectorAll(n, GENERIC_TEXT).filter((x) => !querySelectorAll(x, GENERIC_TEXT).length);
    let text = textNodes.map(textOf).filter(Boolean).join("\n");
    if (!text) text = textOf(n).replace(title, "").trim();
    const authorNode = s.author ? first(n, s.author) : first(n, GENERIC_AUTHOR);
    const author = n.attrs["data-author"] ?? (authorNode ? textOf(authorNode) : null);
    const dateNode = s.date ? first(n, s.date) : first(n, "time[datetime], [data-time], [datetime]");
    const it = rawItem({ url, title, text, author, publishedAt: dateOfNode(dateNode), language });
    if (it && !items.some((x) => x.url === it.url)) items.push(it);
  }
  const nextNode = s.next ? first(root, s.next) : first(root, "a[rel=next], link[rel=next], [class*=pageNav-jump--next], a[class*=next]");
  return { items, next: abs(nextNode?.attrs.href, pageUrl) };
}

export type ForumReadOptions = { maxItems?: number; language?: string | null; maxPages?: number };

/** Adresse de la page `n` (2, 3…) selon le réglage, sinon null. */
export function nextPageUrl(baseUrl: string, n: number, config: WatchScrapeConfig): string | null {
  const p = config.pagination;
  if (p?.pattern) {
    const filled = p.pattern.replace("{n}", String(n));
    try {
      return new URL(filled, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
    } catch {
      return null;
    }
  }
  if (p?.param) {
    const u = new URL(baseUrl);
    u.searchParams.set(p.param, String(n));
    return u.toString();
  }
  return null;
}

/** Lit un forum page après page (débit tenu par `web`), 50 pages au plus, s'arrête quand rien de nouveau n'arrive. */
export async function fetchForum(web: AnalystsWeb, url: string, config: WatchScrapeConfig = {}, opts: ForumReadOptions = {}): Promise<RawItem[]> {
  const maxPages = Math.max(1, Math.min(opts.maxPages ?? config.maxPages ?? ANALYSTS_LIMITS.forumMaxPages, ANALYSTS_LIMITS.forumMaxPages));
  const maxItems = opts.maxItems ?? 100;
  const items: RawItem[] = [];
  const seenPages = new Set<string>();
  let pageUrl: string | null = url;
  for (let page = 1; pageUrl && page <= maxPages && items.length < maxItems; page++) {
    if (seenPages.has(pageUrl)) break;
    seenPages.add(pageUrl);
    const res = await web.fetchText(pageUrl);
    if (res.status === 404 && page > 1) break;
    if (res.status < 200 || res.status >= 300) {
      if (page === 1) throw new WatchReadError(httpMessage(res.status, new URL(url).hostname));
      break;
    }
    const parsed = parseForumPage(res.body, res.finalUrl || pageUrl, config, opts.language ?? null);
    const fresh = parsed.items.filter((it) => !items.some((x) => x.url === it.url));
    if (!fresh.length) break;
    items.push(...fresh.slice(0, maxItems - items.length));
    const next = parsed.next ?? nextPageUrl(url, page + 1, config);
    // Pages suivantes sur le même site seulement : un lien « suivant » écrit dans la page (donnée) n'emmène jamais
    // la lecture ailleurs (autre site, adresse interne).
    pageUrl = next && sameSite(next, url) ? next : null;
  }
  return items;
}

const siteOf = (u: string): string | null => {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
};
const sameSite = (a: string, b: string) => {
  const x = siteOf(a);
  return x !== null && x === siteOf(b);
};

export function httpMessage(status: number, host: string): string {
  if (status === 404) return `Page introuvable sur ${host} (code 404) : l'adresse a peut-être changé.`;
  if (status === 401 || status === 403) return `${host} refuse la lecture (code ${status}) et la lecture de repli n'a pas abouti.`;
  if (status === 429) return `${host} demande de ralentir (code 429) : je réessaierai plus tard.`;
  if (status >= 500) return `${host} est en panne pour l'instant (code ${status}).`;
  return `${host} a répondu ${status} : rien de lisible.`;
}

// ---------------------------------------------------------------- Reddit

/** Nom de sous-forum (« r/gambling », « gambling », adresse complète) → « gambling », sinon null. */
export function subredditOf(input: string): string | null {
  const m = input.trim().match(/(?:reddit\.com\/)?\/?r\/([A-Za-z0-9_]{2,21})\b/i) ?? input.trim().match(/^([A-Za-z0-9_]{2,21})$/);
  return m ? m[1]! : null;
}

/** Posts d'un listing JSON de Reddit (fonction pure) : pseudonyme seulement, jamais `author_fullname` ni de lien de profil. */
export function parseRedditListing(json: string, language: string | null = null): RawItem[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new WatchReadError("Réponse de Reddit illisible (pas du JSON).");
  }
  const children = (data as { data?: { children?: unknown } })?.data?.children;
  if (!Array.isArray(children)) throw new WatchReadError("Réponse de Reddit sans liste de posts.");
  const out: RawItem[] = [];
  for (const c of children as Array<{ kind?: string; data?: Record<string, unknown> }>) {
    const d = c?.data;
    if (!d || c.kind !== "t3" || d.stickied === true) continue;
    const permalink = typeof d.permalink === "string" ? d.permalink : null;
    const url = permalink ? safeHttpUrl(`https://www.reddit.com${permalink}`) : null;
    if (!url) continue;
    const it = rawItem({
      url,
      title: d.title,
      text: typeof d.selftext === "string" && d.selftext.trim() ? d.selftext : String(d.title ?? ""),
      author: d.author,
      publishedAt: isoOf(d.created_utc),
      language,
    });
    if (it) out.push(it);
  }
  return out;
}

export async function fetchReddit(web: AnalystsWeb, subreddit: string, opts: { limit?: number; language?: string | null; country?: string } = {}): Promise<RawItem[]> {
  const name = subredditOf(subreddit);
  if (!name) throw new WatchReadError(`« ${subreddit.slice(0, 40)} » n'est pas un sous-forum Reddit.`);
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 100));
  const url = `https://www.reddit.com/r/${name}/new.json?limit=${limit}&raw_json=1`;
  let res;
  try {
    res = await web.fetchText(url, { accept: "application/json" });
  } catch (err) {
    if (err instanceof PoliteFetchError && err.code === "robots") {
      // Reddit ferme sa lecture aux robots : on passe par la recherche web, jamais par un contournement.
      const hits = await web.search({ query: `site:reddit.com/r/${name}`, allowedDomains: ["reddit.com"], ...(opts.country ? { country: opts.country } : {}) });
      return hitsToItems(hits, opts.language ?? null).filter((it) => new RegExp(`/r/${name}/`, "i").test(it.url));
    }
    throw err;
  }
  if (res.status !== 200) throw new WatchReadError(httpMessage(res.status, "reddit.com"));
  return parseRedditListing(res.body, opts.language ?? null);
}

// ---------------------------------------------------------------- Telegram public

export async function fetchTelegramPublic(
  web: AnalystsWeb,
  channel: string,
  opts: { now?: Date; maxPosts?: number; maxAgeDays?: number; language?: string | null } = {},
): Promise<RawItem[]> {
  const username = normalizeChannelUsername(channel);
  if (!username) throw new WatchReadError(`« ${channel.slice(0, 40)} » n'est pas un canal Telegram public.`);
  const res = await readWebPreview(async (url) => {
    const r = await web.fetchText(url);
    return { status: r.status, body: r.body };
  }, username, {
    ...(opts.now ? { now: opts.now } : {}),
    // Le débit (3 s pour t.me) est tenu par `web` : pas de seconde attente ici.
    sleep: async () => undefined,
    maxPosts: opts.maxPosts ?? 50,
    maxAgeDays: opts.maxAgeDays ?? 30,
  });
  if (!res.ok) throw new WatchReadError(res.message);
  const out: RawItem[] = [];
  for (const p of res.posts) {
    const it = rawItem({
      url: `https://t.me/${username}/${p.externalId}`,
      title: null,
      text: p.text ?? "",
      author: `@${username}`,
      publishedAt: p.postedAt.toISOString(),
      language: opts.language ?? null,
    });
    if (it) out.push(it);
  }
  return out;
}

// ---------------------------------------------------------------- recherches (actualités, X)

function hitsToItems(hits: Array<{ url: string; title: string; snippet: string; date: string | null }>, language: string | null): RawItem[] {
  const out: RawItem[] = [];
  for (const h of hits) {
    const url = safeHttpUrl(h.url);
    if (!url) continue;
    const it = rawItem({ url, title: h.title, text: h.snippet || h.title, publishedAt: h.date, language });
    if (it && !out.some((x) => x.url === it.url)) out.push(it);
  }
  return out;
}

/** Texte principal d'un article (fonction pure) : `article`, sinon `main`, sinon la page ; paragraphes seulement. */
export function extractArticle(body: string): { title: string | null; text: string; publishedAt: string | null } {
  if (!looksLikeHtml(body)) return { title: null, text: body.trim(), publishedAt: null };
  const root = parseHtml(body);
  const scope = first(root, "article") ?? first(root, "main") ?? root;
  const title = (first(scope, "h1") ? textOf(first(scope, "h1")!) : null) || (first(root, "title") ? textOf(first(root, "title")!) : null);
  // Signatures des journalistes (vrais noms) jamais gardées : paragraphes `byline` / `author` et « Von … », « By … ».
  const paras = querySelectorAll(scope, "p")
    .filter((p) => !/byline|author|credit/i.test(p.attrs.class ?? ""))
    .map(textOf)
    .filter((t) => t.length > 0 && !(t.length < 80 && /^(von|by|par|por|di|door|av|af|przez)\s/i.test(t)));
  const meta = querySelectorAll(root, "meta").find((m) => /article:published_time|datePublished/i.test(m.attrs.property ?? m.attrs.itemprop ?? m.attrs.name ?? ""));
  const publishedAt = dateOfNode(first(scope, "time[datetime]")) ?? isoOf(meta?.attrs.content);
  return { title: title || null, text: (paras.length ? paras.join("\n") : textOf(scope)).trim(), publishedAt };
}

export type NewsSearchRequest = {
  market: Market;
  country?: string | null;
  language?: string | null;
  allowedDomains?: string[];
  query?: string | null;
  /** Articles lus en entier (polis, robots.txt respecté) ; échec → l'extrait reste. */
  fetchArticles?: number;
  maxUses?: number;
};

/** Actualités par marché × pays × langue locale (recherche web sourcée). */
export async function searchNews(web: AnalystsWeb, req: NewsSearchRequest): Promise<RawItem[]> {
  const language = req.language ?? "en";
  const query = req.query?.trim() || localQuery(req.market, language, "news");
  const hits = await web.search({
    query,
    ...(req.allowedDomains?.length ? { allowedDomains: req.allowedDomains } : {}),
    ...(req.country ? { country: req.country } : {}),
    ...(req.maxUses ? { maxUses: req.maxUses } : {}),
  });
  const items = hitsToItems(hits, language);
  const n = Math.max(0, Math.min(req.fetchArticles ?? 0, 10));
  for (let i = 0; i < Math.min(n, items.length); i++) {
    const it = items[i]!;
    try {
      const res = await web.fetchText(it.url);
      if (res.status !== 200) continue;
      const art = extractArticle(res.body);
      const full = rawItem({ url: it.url, title: it.title ?? art.title, text: art.text, publishedAt: it.publishedAt ?? art.publishedAt, language });
      if (full && full.text.length > it.text.length) items[i] = full;
    } catch {
      /* article illisible ou refusé par son robots.txt : l'extrait de la recherche reste */
    }
  }
  return items;
}

/** Posts publics de X par la recherche web (`site:x.com` + mots-clés, aucune API) ; seul le pseudonyme « @nom » reste. */
export async function searchX(
  web: AnalystsWeb,
  req: { market: Market; country?: string | null; language?: string | null; keywords?: string | null; maxUses?: number },
): Promise<RawItem[]> {
  const language = req.language ?? "en";
  const query = `site:x.com ${req.keywords?.trim() || localQuery(req.market, language, "ads")}`;
  const hits = await web.search({
    query,
    allowedDomains: ["x.com", "twitter.com"],
    ...(req.country ? { country: req.country } : {}),
    ...(req.maxUses ? { maxUses: req.maxUses } : {}),
  });
  const out: RawItem[] = [];
  for (const h of hits) {
    const url = safeHttpUrl(h.url.replace(/^https?:\/\/(www\.|mobile\.)?twitter\.com/i, "https://x.com"));
    const m = url?.match(/^https:\/\/(?:www\.)?x\.com\/([A-Za-z0-9_]{1,15})\/status\/\d+/i);
    if (!url || !m) continue;
    const it = rawItem({ url, title: h.title, text: h.snippet || h.title, author: `@${m[1]}`, publishedAt: h.date, language });
    if (it && !out.some((x) => x.url === it.url)) out.push(it);
  }
  return out;
}

/** Posts publics de canaux Telegram trouvés par la recherche web (`site:t.me` + mots-clés). */
export async function searchTelegram(
  web: AnalystsWeb,
  req: { market: Market; country?: string | null; language?: string | null; keywords?: string | null; maxUses?: number },
): Promise<RawItem[]> {
  const language = req.language ?? "en";
  const hits = await web.search({
    query: `site:t.me ${req.keywords?.trim() || localQuery(req.market, language, "news")}`,
    allowedDomains: ["t.me"],
    ...(req.country ? { country: req.country } : {}),
    ...(req.maxUses ? { maxUses: req.maxUses } : {}),
  });
  return hitsToItems(hits, language).filter((it) => /^https:\/\/t\.me\/(s\/)?[A-Za-z][A-Za-z0-9_]{3,31}\/\d+/.test(it.url));
}

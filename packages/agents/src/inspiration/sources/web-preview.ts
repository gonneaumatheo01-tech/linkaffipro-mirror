/**
 * Phase 27 (chantier A, lecture) — aperçu web public d'un canal : `https://t.me/s/<nom>` (règle 2 : aucun compte,
 * aucune entrée). Une requête toutes les 3 secondes, pagination par `?before=<plus ancien lu>`, 200 posts et 90 jours
 * au plus. On ne garde que les caractéristiques (règle 3) : aucun média téléchargé, aucun lien suivi (comptés
 * seulement), aucun membre lu. Le contenu du canal est une DONNÉE : jamais une consigne.
 */
import { INSPIRATION_LIMITS, type InspirationFetch, type ReferenceMediaKind, type ReferencePostInput, type ReferenceReadResult } from "../contract";

export type WebPreviewOptions = {
  now?: Date;
  /** Attente entre deux requêtes (tests : instantanée). */
  sleep?: (ms: number) => Promise<void>;
  maxPosts?: number;
  maxAgeDays?: number;
  /** Relecture : s'arrête aux posts déjà connus (numéro inférieur ou égal). */
  sinceId?: number;
  /** Pages lues au plus (garde-fou). */
  maxPages?: number;
  /**
   * Heure de la dernière requête vers t.me, partagée entre les lectures (une requête toutes les 3 secondes, même d'une
   * lecture à la suivante). Absente : seul le rythme entre les pages d'une même lecture est tenu.
   */
  throttle?: TmeThrottle;
  /** Horloge en millisecondes (tests). */
  clock?: () => number;
  /** Appelée après chaque page lue (renouvellement du verrou de lecture). */
  onPage?: () => Promise<void>;
};

/** Heure de la dernière requête vers t.me (mémoire du processus, ou Redis côté worker). */
export type TmeThrottle = {
  lastRequestAt(): Promise<number | null>;
  markRequest(atMs: number): Promise<void>;
};

/** Rythme gardé en mémoire (un seul processus lit t.me : le worker). */
export function memoryTmeThrottle(): TmeThrottle {
  let last: number | null = null;
  return {
    async lastRequestAt() {
      return last;
    },
    async markRequest(at) {
      last = at;
    },
  };
}

/** Rythme partagé par défaut du processus. */
export const processTmeThrottle: TmeThrottle = memoryTmeThrottle();

export type WebPreviewResult = ReferenceReadResult & { pages?: number };

const PREVIEW_BASE = "https://t.me/s/";
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Nom public valide de Telegram (5 à 32 caractères, lettres, chiffres, « _ »). */
const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

/**
 * Nom public d'un canal à partir de ce que donne le client : « @nom », « nom », « t.me/nom », « https://t.me/s/nom »,
 * « https://t.me/nom/123 ». Un lien d'invitation (« t.me/+… », « joinchat ») n'a pas de nom public : null.
 */
export function normalizeChannelUsername(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\//i, "").replace(/^(www\.)?(t\.me|telegram\.me|telegram\.dog)\//i, "tme/");
  if (s.startsWith("tme/")) {
    const parts = s.slice(4).split(/[/?#]/).filter(Boolean);
    if (!parts.length) return null;
    if (parts[0]!.startsWith("+") || parts[0] === "joinchat" || parts[0] === "c") return null;
    s = parts[0] === "s" ? (parts[1] ?? "") : parts[0]!;
  }
  s = s.replace(/^@/, "");
  return USERNAME_RE.test(s) ? s : null;
}

/** Lien d'invitation privé (« t.me/+abc », « t.me/joinchat/abc ») : rejoindre exige un compte et un CONFIRM. */
export function isInviteLink(input: string): boolean {
  return /(?:t\.me|telegram\.me)\/(?:\+|joinchat\/)[A-Za-z0-9_-]+/i.test(input.trim());
}

/** « 1.2K » → 1200, « 15K » → 15000, « 1.5M » → 1500000, « 987 » → 987 ; illisible → null. */
export function parsePreviewViews(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = raw.trim().replace(/\s|\u00a0/g, "").replace(",", ".").match(/^(\d+(?:\.\d+)?)([KMB])?$/i);
  if (!m) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? "").toUpperCase() as "K" | "M" | "B"] ?? 1;
  return Math.round(Number(m[1]) * mult);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function decodeHtmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (all, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[code.toLowerCase()] ?? all;
  });
}

/** HTML de t.me/s → texte : `<br>` → saut de ligne, balises retirées, entités décodées. */
export function previewHtmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Contenu d'un `<div>` ouvert à `start` (profondeur des `<div>` imbriqués suivie). */
function innerDiv(html: string, start: number): string | null {
  const open = html.indexOf(">", start);
  if (open < 0) return null;
  const re = /<div\b|<\/div>/gi;
  re.lastIndex = open + 1;
  let depth = 1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0].toLowerCase() === "</div>" ? -1 : 1;
    if (depth === 0) return html.slice(open + 1, m.index);
  }
  return null;
}

/** Position de l'élément dont l'attribut class contient exactement le jeton `cls`. */
function classIndex(html: string, cls: string, from = 0): number {
  const re = new RegExp(`class="(?:[^"]*\\s)?${cls}(?:\\s[^"]*)?"`, "g");
  re.lastIndex = from;
  const m = re.exec(html);
  if (!m) return -1;
  return html.lastIndexOf("<", m.index);
}

function hasClass(html: string, cls: string): boolean {
  return classIndex(html, cls) >= 0;
}

function mediaKindOf(block: string): ReferenceMediaKind {
  if (hasClass(block, "tgme_widget_message_video_player") || hasClass(block, "tgme_widget_message_roundvideo_player")) return "video";
  if (hasClass(block, "tgme_widget_message_photo_wrap")) return "photo";
  if (hasClass(block, "tgme_widget_message_poll")) return "poll";
  if (hasClass(block, "tgme_widget_message_document_wrap") || hasClass(block, "tgme_widget_message_document")) return "document";
  if (
    ["tgme_widget_message_sticker_wrap", "tgme_widget_message_voice_player", "tgme_widget_message_location_wrap", "tgme_widget_message_audio_player"].some(
      (c) => hasClass(block, c),
    )
  )
    return "other";
  return "text";
}

/** Liens présents dans le texte (comptés, jamais suivis) : ni hashtags (recherche), ni mentions « @nom ». */
function countLinks(textHtml: string): number {
  let n = 0;
  for (const m of textHtml.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1] ?? "";
    const label = previewHtmlToText(m[2] ?? "");
    if (href.startsWith("?q=") || label.startsWith("#") || label.startsWith("@")) continue;
    if (/^(https?:)?\/\//i.test(href) || href.startsWith("tg:")) n++;
  }
  return n;
}

export type ParsedPreviewPage = {
  title: string | null;
  /** La page porte l'en-tête d'un aperçu de canal (`tgme_channel_info`). */
  isPreview: boolean;
  posts: ReferencePostInput[];
  /** Numéro donné par le lien « plus ancien » de la page, s'il existe. */
  moreBefore: number | null;
};

/** Analyse une page `t.me/s/<nom>` (fonction pure). Les messages de service (« Channel created ») sont ignorés. */
export function parsePreviewPage(html: string, username: string): ParsedPreviewPage {
  const titleIdx = classIndex(html, "tgme_channel_info_header_title");
  let title: string | null = titleIdx >= 0 ? previewHtmlToText(innerDiv(html, titleIdx) ?? "") || null : null;
  title ??= decodeHtmlEntities(html.match(/<meta property="og:title" content="([^"]*)"/i)?.[1] ?? "") || null;
  const isPreview = hasClass(html, "tgme_channel_info") || hasClass(html, "tgme_channel_history");
  const more = html.match(/class="[^"]*\btme_messages_more\b[^"]*"[^>]*data-before="(\d+)"|data-before="(\d+)"[^>]*class="[^"]*\btme_messages_more\b/i);
  const moreBefore = more ? Number(more[1] ?? more[2]) : null;

  const posts: ReferencePostInput[] = [];
  const chunks = html.split(/<div class="tgme_widget_message_wrap\b/).slice(1);
  const lower = username.toLowerCase();
  for (const chunk of chunks) {
    const head = chunk.match(/<div class="([^"]*\btgme_widget_message\b[^"]*)"[^>]*data-post="([^"/]+)\/(\d+)"/);
    if (!head) continue;
    if (/\bservice_message\b/.test(head[1]!)) continue;
    if (head[2]!.toLowerCase() !== lower) continue;
    const externalId = Number(head[3]);
    const dateIdx = classIndex(chunk, "tgme_widget_message_date");
    const iso = (dateIdx >= 0 ? chunk.slice(dateIdx) : chunk).match(/<time[^>]*datetime="([^"]+)"/)?.[1];
    const postedAt = iso ? new Date(iso) : null;
    if (!postedAt || Number.isNaN(postedAt.getTime())) continue;
    const textIdx = classIndex(chunk, "tgme_widget_message_text");
    const textHtml = textIdx >= 0 ? (innerDiv(chunk, textIdx) ?? "") : "";
    const mediaKind = mediaKindOf(chunk);
    let text = previewHtmlToText(textHtml) || null;
    if (!text && mediaKind === "poll") {
      const q = classIndex(chunk, "tgme_widget_message_poll_question");
      text = q >= 0 ? previewHtmlToText(innerDiv(chunk, q) ?? "") || null : null;
    }
    const viewsIdx = classIndex(chunk, "tgme_widget_message_views");
    const views = viewsIdx >= 0 ? parsePreviewViews(previewHtmlToText(chunk.slice(viewsIdx).match(/^<span[^>]*>([^<]*)<\/span>/)?.[1] ?? "")) : null;
    posts.push({
      externalId,
      postedAt,
      text,
      mediaKind,
      views,
      hasButton: hasClass(chunk, "tgme_widget_message_inline_keyboard") || hasClass(chunk, "tgme_widget_message_inline_button"),
      linkCount: countLinks(textHtml),
    });
  }
  return { title, isPreview, posts, moreBefore };
}

/** Raison d'indisponibilité d'une page qui n'est pas un aperçu (messages en français, montrés par Kevin). */
function unavailableOf(status: number, body: string, username: string): Extract<ReferenceReadResult, { ok: false }> {
  if (status === 404) return { ok: false, reason: "not_found", message: `Je ne trouve pas de canal public @${username}.` };
  if (status >= 300 && status < 400)
    return { ok: false, reason: "private", message: `@${username} n'a pas d'aperçu public : il faut un compte membre ou des posts transférés.` };
  if (status >= 500 || status === 429 || status === 403)
    return { ok: false, reason: "error", message: `Telegram ne répond pas pour @${username} (code ${status}), je réessaierai plus tard.` };
  if (/can[’']?t be displayed|cannot be displayed|is not accessible|not available|violat/i.test(body))
    return { ok: false, reason: "restricted", message: `@${username} est restreint par Telegram : son aperçu ne s'affiche pas.` };
  if (/tgme_page_title|tgme_page_extra|tgme_action_button/.test(body))
    return { ok: false, reason: "private", message: `@${username} n'a pas d'aperçu public : il faut un compte membre ou des posts transférés.` };
  return { ok: false, reason: "not_found", message: `Je ne trouve pas de canal public @${username}.` };
}

/**
 * Lit l'aperçu web d'un canal public. Pages lues des plus récentes aux plus anciennes (`?before=<plus ancien lu>`),
 * une requête toutes les 3 secondes ; s'arrête à 200 posts, 90 jours, au dernier post connu (`sinceId`) ou quand la
 * page n'apporte rien de plus ancien. Posts rendus du plus récent au plus ancien.
 */
export async function readWebPreview(fetchPage: InspirationFetch, usernameInput: string, opts: WebPreviewOptions = {}): Promise<WebPreviewResult> {
  const username = normalizeChannelUsername(usernameInput);
  if (!username) return { ok: false, reason: "not_found", message: `« ${usernameInput.slice(0, 40)} » n'est pas un nom de canal public.` };
  const now = opts.now ?? new Date();
  const sleep = opts.sleep ?? defaultSleep;
  const maxPosts = Math.min(opts.maxPosts ?? INSPIRATION_LIMITS.maxPostsPerRead, INSPIRATION_LIMITS.maxPostsPerRead);
  const maxAgeDays = Math.min(opts.maxAgeDays ?? INSPIRATION_LIMITS.maxAgeDays, INSPIRATION_LIMITS.maxAgeDays);
  const oldest = now.getTime() - maxAgeDays * 86_400_000;
  const maxPages = opts.maxPages ?? Math.ceil(INSPIRATION_LIMITS.maxPostsPerRead / 10) + 2;
  const clock = opts.clock ?? Date.now;
  const delay = INSPIRATION_LIMITS.webDelayMs;
  /** Attend son tour : 3 s depuis la page précédente de cette lecture ET depuis la dernière requête vers t.me. */
  const waitTurn = async (pagesDone: number) => {
    let wait = pagesDone > 0 ? delay : 0;
    if (opts.throttle) {
      const last = await opts.throttle.lastRequestAt().catch(() => null);
      if (last !== null) wait = Math.max(wait, last + delay - clock());
    }
    if (wait > 0) await sleep(Math.min(wait, delay));
    await opts.throttle?.markRequest(clock()).catch(() => undefined);
  };

  const byId = new Map<number, ReferencePostInput>();
  let title: string | null = null;
  let before: number | null = null;
  let pages = 0;
  let done = false;
  while (!done && pages < maxPages) {
    await waitTurn(pages);
    const url = `${PREVIEW_BASE}${username}${before ? `?before=${before}` : ""}`;
    let res: { status: number; body: string };
    try {
      res = await fetchPage(url);
    } catch (err) {
      if (pages === 0) return { ok: false, reason: "error", message: `Lecture de @${username} impossible pour l'instant (${String((err as Error)?.message ?? err).slice(0, 80)}).` };
      break;
    }
    pages++;
    await opts.onPage?.();
    const page = res.status === 200 ? parsePreviewPage(res.body, username) : null;
    if (!page || !page.isPreview) {
      if (pages === 1) return unavailableOf(res.status, res.body, username);
      break;
    }
    title ??= page.title;
    if (pages === 1 && page.posts.length === 0)
      return { ok: false, reason: "restricted", message: `@${username} n'affiche aucun post dans son aperçu public.` };
    const sorted = [...page.posts].sort((a, b) => b.externalId - a.externalId);
    let progressed = false;
    for (const p of sorted) {
      if (before !== null && p.externalId >= before) continue;
      if (opts.sinceId !== undefined && p.externalId <= opts.sinceId) {
        done = true;
        break;
      }
      if (p.postedAt.getTime() < oldest) {
        done = true;
        break;
      }
      if (!byId.has(p.externalId)) byId.set(p.externalId, p);
      progressed = true;
      if (byId.size >= maxPosts) {
        done = true;
        break;
      }
    }
    const smallest = sorted.length ? sorted[sorted.length - 1]!.externalId : null;
    if (!progressed || smallest === null || smallest <= 1) break;
    // Pas de lien « plus ancien » : la page est la dernière.
    if (page.moreBefore === null) break;
    before = Math.min(smallest, page.moreBefore);
  }
  const posts = [...byId.values()].sort((a, b) => b.externalId - a.externalId);
  return { ok: true, title, username, chatId: null, posts, pages };
}

/** Taille maximale lue d'une page de l'aperçu (au-delà : coupée, le reste n'est jamais chargé). */
export const PREVIEW_MAX_BYTES = 2_000_000;

/** Lit un corps de réponse en flux et s'arrête à `maxBytes` (le reste n'est ni chargé ni gardé). */
export async function readBodyCapped(res: Pick<Response, "body" | "text">, maxBytes = PREVIEW_MAX_BYTES): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, maxBytes);
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let out = "";
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const room = maxBytes - size;
      const chunk = value.byteLength > room ? value.subarray(0, room) : value;
      size += chunk.byteLength;
      out += decoder.decode(chunk, { stream: true });
      if (size >= maxBytes) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return out + decoder.decode();
}

/**
 * Accès réseau réel de l'aperçu (worker) : GET sans suivre les redirections (une redirection vers `t.me/<nom>` =
 * pas d'aperçu), 15 s au plus, agent utilisateur de navigateur ordinaire, corps lu en flux et coupé à 2 Mo. Jamais
 * appelé dans les tests.
 */
export function createInspirationFetch(fetchImpl: typeof fetch = fetch): InspirationFetch {
  return async (url) => {
    if (!url.startsWith(PREVIEW_BASE)) throw new Error("adresse refusée : seul l'aperçu t.me/s est lu");
    const res = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
        "accept-language": "fr-FR,fr;q=0.9,en;q=0.8",
        accept: "text/html",
      },
    });
    if (!(res.status >= 200 && res.status < 300)) {
      await res.body?.cancel().catch(() => undefined);
      return { status: res.status, body: "" };
    }
    return { status: res.status, body: await readBodyCapped(res) };
  };
}

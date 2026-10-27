/**
 * Phase 31, chantier B — contacts PUBLICS de prospection (section 3.9, code + résultats de l'IA).
 *
 * Niveaux :
 * - HIGH : une étiquette (`dict/contact-labels.json`, toutes langues : « pub », « contact », « Werbung »,
 *   « pubblicità »…) précède un username ou un email dans la description ou le post épinglé (« pub : @x ») ; fiche
 *   sur une place de marché de pub (`MARKETPLACE` : contact par la place de marché).
 * - MEDIUM : username, email, site ou réseau social seul dans la description ; signature d'auteur des posts ; bot
 *   `@…bot` (type BOT) ; contacts de la page liée (linktree, beacons, site : 1 page, 1 requête).
 * - LOW : username mentionné dans les posts ; groupe de discussion lié public (`LINKED_GROUP` : le client peut y voir
 *   les admins lui-même).
 * Exclusions : le canal lui-même, les usernames officiels de marques, les bots de casino, les canaux d'où viennent les
 * transferts (ce sont des canaux, pas des contacts : ils vont au graphe).
 * Un contact proposé par l'IA n'est gardé que s'il figure dans les données lues (jamais inventé).
 * Données minimales : seule la preuve courte (15 mots au plus) est gardée, jamais le post.
 */
import { affiliatePatterns, allContactLabels, findBrand, isBrandUsername } from "../dict";
import { PROSPECTION_LIMITS, type ChannelAnalysis, type ContactConfidence, type ContactFound, type ProspectContactType, type ProspectionDeps, type ProspectPost } from "../contract";
import { decodeHtmlEntities, previewHtmlToText } from "./html";
import { enrichFetch } from "./net";
import { mentionsIn, tmeUsernameOf } from "./posts";

export type LinkedPage = { url: string; html: string };

export type ContactsInput = {
  description: string | null;
  pinned: string | null;
  posts: ProspectPost[];
  linkedPage: LinkedPage | null;
  marketplace: { url: string; price: string | null } | null;
  linkedGroup: string | null;
  channelUsername: string | null;
  analysis: ChannelAnalysis | null;
};

export type ContactsResult = { contacts: ContactFound[]; best: string | null; confidence: ContactConfidence };

const RANK: Record<ContactFound["confidence"], number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
const TYPE_ORDER: ProspectContactType[] = ["TELEGRAM_USERNAME", "EMAIL", "MARKETPLACE", "BOT", "WEBSITE", "SOCIAL", "LINKED_GROUP", "OTHER"];
const SOCIAL_HOSTS = /^(?:[a-z]+\.)?(instagram\.com|tiktok\.com|x\.com|twitter\.com|youtube\.com|youtu\.be|facebook\.com|twitch\.tv|kick\.com|threads\.net|snapchat\.com)$/i;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const USER_RE = /(?<![\w@.])@([A-Za-z][A-Za-z0-9_]{3,31})\b/g;
const TME_RE = /\b(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([A-Za-z][A-Za-z0-9_]{3,31})\b(?!\/\d)/gi;
const URL_RE = /\bhttps?:\/\/[^\s<>"')]+|\b(?:www\.)?[a-z0-9-]+\.(?:fr|com|it|de|es|pt|be|ch|at|nl|pl|io|net|eu|co\.uk|bet|club|site|me)(?:\/[^\s<>"')]*)?/gi;
/** Mots qui font d'un bot un bot de casino (exclu). */
const CASINO_BOT = /casino|slot|spin|bonus|bet|jackpot|roulette|poker|vavada|aviator|crash/i;

/** Preuve : 15 mots au plus autour de la valeur. */
export function evidenceAround(text: string, value: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const i = flat.toLowerCase().indexOf(value.toLowerCase());
  const words = (i < 0 ? flat : flat.slice(Math.max(0, i - 60), i + value.length + 60)).split(" ").filter(Boolean);
  if (i < 0) return words.slice(0, PROSPECTION_LIMITS.evidenceMaxWords).join(" ");
  // Fenêtre centrée sur la valeur.
  const idx = words.findIndex((w) => w.toLowerCase().includes(value.toLowerCase().slice(0, 12)));
  const start = Math.max(0, Math.min(idx - 6, words.length - PROSPECTION_LIMITS.evidenceMaxWords));
  return words.slice(start, start + PROSPECTION_LIMITS.evidenceMaxWords).join(" ");
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let labelRe: RegExp | null = null;
/** « pub : @x », « Contact: x@y.com », « Werbung ➡️ t.me/x » : étiquette, 0 à 6 signes, puis le contact. */
function labeledRe(): RegExp {
  if (labelRe) return labelRe;
  const labels = allContactLabels()
    .sort((a, b) => b.length - a.length)
    .map((l) => escapeRe(l).replace(/\s+/g, "\\s+"));
  labelRe = new RegExp(
    `(?<![\\p{L}])(${labels.join("|")})(?![\\p{L}])[^\\p{L}\\p{N}@\\n]{0,8}((?:@[A-Za-z][A-Za-z0-9_]{3,31})|(?:[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,})|(?:(?:https?:\\/\\/)?(?:t\\.me|telegram\\.me)\\/[A-Za-z][A-Za-z0-9_]{3,31}))`,
    "giu",
  );
  return labelRe;
}

function hostOf(url: string): string | null {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Valeur normalisée : « @nom » en minuscules, email en minuscules, adresse telle quelle. */
function normalizeValue(type: ProspectContactType, raw: string): string | null {
  const v = raw.trim();
  if (type === "TELEGRAM_USERNAME" || type === "BOT" || type === "LINKED_GROUP") {
    const name = v.startsWith("@") ? v.slice(1) : (tmeUsernameOf(v.startsWith("http") ? v : `https://${v.replace(/^\/\//, "")}`) ?? v);
    return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(name) ? `@${name.toLowerCase()}` : null;
  }
  if (type === "EMAIL") return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v) ? v.toLowerCase() : null;
  return v.slice(0, 200);
}

const isBotName = (u: string) => /bot$/i.test(u.replace(/^@/, ""));

/** Username ou lien t.me → type de contact (bot ou personne / canal). */
function telegramType(value: string): ProspectContactType {
  return isBotName(value) ? "BOT" : "TELEGRAM_USERNAME";
}

/** Groupe de discussion lié, annoncé dans la description ou les posts (« chat : @x », « discussion t.me/x »). */
export function findLinkedGroup(description: string | null, posts: ProspectPost[] = []): string | null {
  const re =
    /(?<![\p{L}])(chat|tchat|discussion|discussions|groupe|group|gruppo|grupo|gruppe|community|communauté|comunità|comunidad|czat|forum)(?![\p{L}])[^\p{L}\p{N}@\n]{0,8}(?:@|(?:https?:\/\/)?t\.me\/)([A-Za-z][A-Za-z0-9_]{3,31})/giu;
  for (const text of [description ?? "", ...posts.slice(0, 20).map((p) => p.text)]) {
    const m = re.exec(text);
    re.lastIndex = 0;
    if (m) return m[2]!.toLowerCase();
  }
  return null;
}

/** Première page liée à lire (agrégateur de liens, puis site personnel) : 1 page par canal (règle 4). */
export function findLinkedPageUrl(description: string | null, posts: ProspectPost[] = []): string | null {
  const hubs = affiliatePatterns().linkHubs;
  const candidates: string[] = [];
  for (const text of [description ?? "", ...posts.slice(0, 10).flatMap((p) => [p.text, ...p.links])]) for (const m of text.matchAll(URL_RE)) candidates.push(m[0]);
  const norm = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`).replace(/[.,;!]+$/, "");
  const hub = candidates.find((u) => hubs.includes(hostOf(u) ?? ""));
  if (hub) return norm(hub);
  if (!description) return null;
  const pat = affiliatePatterns();
  const site = [...description.matchAll(URL_RE)]
    .map((m) => m[0])
    .find((u) => {
      const h = hostOf(u);
      return !!h && !/^(t\.me|telegram\.me)$/.test(h) && !SOCIAL_HOSTS.test(h) && !pat.shorteners.includes(h) && !findBrand(h.split(".")[0]!) && !/\?|\/aff|\/ref/i.test(u);
    });
  return site ? norm(site) : null;
}

/** Lit la page liée (1 requête, lecture polie `linked`) ; erreur ou refus → null (on passe). */
export async function fetchLinkedPage(deps: ProspectionDeps, url: string): Promise<LinkedPage | null> {
  try {
    const res = await enrichFetch(deps, url, "linked");
    if (res.status !== 200 || !res.body) return null;
    return { url, html: res.body.slice(0, 500_000) };
  } catch {
    return null;
  }
}

/** Contacts d'une page liée : emails, usernames Telegram, réseaux sociaux (aucun lien suivi). */
export function contactsFromLinkedPage(page: LinkedPage): ContactFound[] {
  const out: ContactFound[] = [];
  const host = hostOf(page.url) ?? "page liée";
  const source = `linked_page:${page.url}`;
  const label = host.replace(/\.(ee|ai|cc|bio|com|io|me|to|ke)$/, "") === host ? host : host.split(".")[0]!;
  const html = page.html;
  const text = previewHtmlToText(html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " "));
  for (const m of html.matchAll(/href="([^"]+)"/gi)) {
    const href = decodeHtmlEntities(m[1]!);
    if (/^mailto:/i.test(href)) {
      const v = normalizeValue("EMAIL", href.slice(7).split("?")[0]!);
      if (v) out.push({ type: "EMAIL", value: v, label, source, confidence: "MEDIUM", evidence: null });
      continue;
    }
    const u = tmeUsernameOf(href);
    if (u) {
      out.push({ type: telegramType(u), value: `@${u}`, label, source, confidence: "MEDIUM", evidence: null });
      continue;
    }
    const h = hostOf(href);
    if (h && SOCIAL_HOSTS.test(h)) out.push({ type: "SOCIAL", value: href.split("?")[0]!, label, source, confidence: "MEDIUM", evidence: null });
  }
  for (const m of text.matchAll(EMAIL_RE)) {
    const v = normalizeValue("EMAIL", m[0]);
    if (v) out.push({ type: "EMAIL", value: v, label, source, confidence: "MEDIUM", evidence: null });
  }
  return out;
}

/** Contacts d'un texte public court (description ou post épinglé). */
function contactsFromBlurb(text: string, source: "description" | "pinned"): ContactFound[] {
  const out: ContactFound[] = [];
  const labeled = new Set<string>();
  for (const m of text.matchAll(labeledRe())) {
    const raw = m[2]!;
    const type: ProspectContactType = raw.includes("@") && !raw.startsWith("@") ? "EMAIL" : telegramType(raw);
    const v = normalizeValue(type, raw);
    if (!v) continue;
    labeled.add(v);
    out.push({ type, value: v, label: m[1]!.toLowerCase(), source, confidence: type === "BOT" ? "MEDIUM" : "HIGH", evidence: evidenceAround(text, raw) });
  }
  for (const m of text.matchAll(EMAIL_RE)) {
    const v = normalizeValue("EMAIL", m[0]);
    if (v && !labeled.has(v)) out.push({ type: "EMAIL", value: v, label: null, source, confidence: "MEDIUM", evidence: evidenceAround(text, m[0]) });
  }
  const stripped = text.replace(EMAIL_RE, " ");
  for (const m of [...stripped.matchAll(USER_RE), ...stripped.matchAll(TME_RE)]) {
    const type = telegramType(m[1]!);
    const v = normalizeValue(type, `@${m[1]}`);
    if (v && !labeled.has(v)) out.push({ type, value: v, label: null, source, confidence: "MEDIUM", evidence: evidenceAround(text, m[0]) });
  }
  for (const m of stripped.matchAll(URL_RE)) {
    const h = hostOf(m[0]);
    if (!h || /^(t\.me|telegram\.me)$/.test(h)) continue;
    const isSocial = SOCIAL_HOSTS.test(h);
    // Lien de marque ou raccourcisseur : une offre, pas un contact.
    if (!isSocial && (findBrand(h.split(".")[0]!) || affiliatePatterns().shorteners.includes(h) || affiliatePatterns().linkHubs.includes(h))) continue;
    out.push({ type: isSocial ? "SOCIAL" : "WEBSITE", value: m[0].replace(/[.,;!]+$/, ""), label: null, source, confidence: "MEDIUM", evidence: null });
  }
  return out;
}

/** Tous les contacts trouvés, sans doublon (le niveau le plus haut gagne), et le meilleur. */
export function extractContacts(input: ContactsInput): ContactsResult {
  const self = input.channelUsername?.toLowerCase().replace(/^@/, "") ?? null;
  const forwardOrigins = new Set(input.posts.map((p) => p.forwardedFrom?.toLowerCase()).filter((x): x is string => !!x));
  const found: ContactFound[] = [];
  if (input.description) found.push(...contactsFromBlurb(input.description, "description"));
  if (input.pinned) found.push(...contactsFromBlurb(input.pinned, "pinned"));
  if (input.marketplace)
    found.push({ type: "MARKETPLACE", value: input.marketplace.url, label: hostOf(input.marketplace.url), source: `directory:${input.marketplace.url}`, confidence: "HIGH", evidence: input.marketplace.price ? `prix affiché : ${input.marketplace.price}` : null });
  if (input.linkedPage) found.push(...contactsFromLinkedPage(input.linkedPage));
  if (input.linkedGroup) {
    const v = normalizeValue("LINKED_GROUP", `@${input.linkedGroup}`);
    if (v) found.push({ type: "LINKED_GROUP", value: v, label: "groupe de discussion", source: "description", confidence: "LOW", evidence: null });
  }
  // Signatures d'auteur (nom affiché sous les posts) : une seule entrée par signature.
  const sigs = new Map<string, number>();
  for (const p of input.posts) if (p.signature && !p.forwardedFrom) sigs.set(p.signature, (sigs.get(p.signature) ?? 0) + 1);
  for (const [sig] of [...sigs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)) {
    const asUser = /^@?[A-Za-z][A-Za-z0-9_]{3,31}$/.test(sig) && sig.startsWith("@");
    found.push({ type: asUser ? "TELEGRAM_USERNAME" : "OTHER", value: asUser ? sig.toLowerCase() : sig, label: "signature des posts", source: "signature", confidence: "MEDIUM", evidence: null });
  }
  // Mentions dans les posts : LOW (bots : MEDIUM).
  const mentionCount = new Map<string, { n: number; text: string }>();
  for (const p of input.posts) {
    if (p.forwardedFrom) continue;
    for (const u of mentionsIn(p.text)) {
      const prev = mentionCount.get(u);
      mentionCount.set(u, { n: (prev?.n ?? 0) + 1, text: prev?.text ?? p.text });
    }
  }
  for (const [u, { text }] of [...mentionCount.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 6)) {
    const type = telegramType(u);
    found.push({ type, value: `@${u}`, label: null, source: "posts", confidence: type === "BOT" ? "MEDIUM" : "LOW", evidence: evidenceAround(text, `@${u}`) });
  }
  // Contacts de l'IA : gardés s'ils figurent dans les données lues.
  const corpus = [input.description ?? "", input.pinned ?? "", ...input.posts.map((p) => `${p.text} ${p.signature ?? ""}`)].join("\n").toLowerCase();
  for (const c of input.analysis?.contacts ?? []) {
    const type = c.type === "TELEGRAM_USERNAME" || c.type === "BOT" ? telegramType(c.value) : c.type;
    const v = normalizeValue(type, c.value);
    if (!v) continue;
    const needle = v.replace(/^@/, "").toLowerCase();
    if (!corpus.includes(needle)) continue;
    found.push({ ...c, type, value: v, confidence: c.confidence });
  }

  // Exclusions puis dédoublonnage (niveau le plus haut, puis source la plus sûre).
  const keep = (c: ContactFound) => {
    if (c.type === "TELEGRAM_USERNAME" || c.type === "BOT" || c.type === "LINKED_GROUP") {
      const u = c.value.replace(/^@/, "");
      if (u === self) return false;
      if (isBrandUsername(u) || findBrand(u)) return false;
      if (c.type === "BOT" && CASINO_BOT.test(u)) return false;
      if (c.type !== "LINKED_GROUP" && forwardOrigins.has(u)) return false;
    }
    if (c.type === "EMAIL" && findBrand(c.value.split("@")[1]?.split(".")[0] ?? "")) return false;
    return true;
  };
  const byKey = new Map<string, ContactFound>();
  for (const c of found.filter(keep)) {
    const key = `${c.type}|${c.value.toLowerCase()}`;
    const prev = byKey.get(key);
    if (!prev || RANK[c.confidence] > RANK[prev.confidence] || (RANK[c.confidence] === RANK[prev.confidence] && !prev.evidence && c.evidence))
      byKey.set(key, { ...c, evidence: c.evidence ? c.evidence.split(" ").slice(0, PROSPECTION_LIMITS.evidenceMaxWords).join(" ") : null });
  }
  const contacts = [...byKey.values()].sort(
    (a, b) => RANK[b.confidence] - RANK[a.confidence] || TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.value.localeCompare(b.value),
  );
  // Le meilleur : un contact qu'on peut joindre (une signature seule ne l'est pas, un groupe lié non plus).
  const reachable = contacts.filter((c) => c.type !== "OTHER" && c.type !== "LINKED_GROUP");
  const best = reachable[0] ?? contacts[0] ?? null;
  return { contacts, best: best?.value ?? null, confidence: best?.confidence ?? "NONE" };
}

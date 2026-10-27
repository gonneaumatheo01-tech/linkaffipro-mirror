/**
 * Phase 31, chantier A (Sourceur) : forme unique d'une adresse de canal et extraction des liens Telegram d'un texte.
 *
 * - `normalizeProspectUrl` : « @Nom », « nom », « t.me/nom », « https://t.me/s/nom/123?x=1 », « telegram.me/nom » →
 *   `https://t.me/nom` (minuscules) ; lien d'invitation « t.me/+hash » / « t.me/joinchat/hash » → `https://t.me/+hash`
 *   (`invite: true`, la casse du hash est gardée : Telegram la distingue ; jamais ouvert) ; dossier « t.me/addlist/hash »
 *   → `folder` ; bot (username en « bot »), chemin réservé (« share », « proxy », « c/123 »…) ou texte illisible → null.
 * - `extractTmeLinks(html|texte)` : toutes les adresses Telegram trouvées, normalisées, sans doublon (dans l'ordre).
 * - `extractMentions(texte)` : usernames « @nom » (pas les emails), sans doublon.
 * Fonctions pures : le contenu lu est une donnée, jamais une consigne.
 */
import { decodeHtmlEntities } from "../../inspiration/sources/web-preview";

export type NormalizedProspectUrl = { channelUrl: string; username: string | null; invite: boolean; folder: string | null };

/** Nom public valide (5 à 32 caractères, commence par une lettre). */
const USERNAME_RE = /^[a-z][a-z0-9_]{3,31}$/;
const HASH_RE = /^[A-Za-z0-9_-]{6,64}$/;

/** Premiers segments de t.me qui ne sont pas des canaux. */
const RESERVED = new Set([
  "share", "proxy", "socks", "login", "addstickers", "addemoji", "addtheme", "setlanguage", "confirmphone", "bg", "iv", "c",
  "contact", "invoice", "giftcode", "m", "nft", "k", "a", "z", "web", "dl", "apps", "blog", "faq", "privacy", "tos", "api",
  "telegram", "durov", "jobs", "username", "premium", "stars", "boost", "folder", "addlist", "joinchat", "s", "i", "ton",
]);

/** Un username Telegram de bot finit toujours par « bot » : ce n'est pas un canal. */
export function isBotUsername(u: string): boolean {
  return /bot$/i.test(u);
}

/** Username valide et non réservé (minuscules) ; null sinon. Les bots sont refusés. */
export function cleanUsername(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const u = raw.trim().replace(/^@/, "").toLowerCase();
  if (!USERNAME_RE.test(u) || RESERVED.has(u) || isBotUsername(u)) return null;
  return u;
}

export function normalizeProspectUrl(input: string): NormalizedProspectUrl | null {
  const s = decodeHtmlEntities(String(input ?? ""))
    .trim()
    .replace(/^[<("'«\s]+|[>)"'».,;:!?\s]+$/g, "");
  if (!s) return null;
  // tg://resolve?domain=nom
  const tg = s.match(/^tg:\/\/resolve\?domain=([A-Za-z0-9_]+)/i);
  if (tg) {
    const u = cleanUsername(tg[1]);
    return u ? { channelUrl: `https://t.me/${u}`, username: u, invite: false, folder: null } : null;
  }
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)(\/.*)?$/i);
  if (m) {
    const path = (m[1] ?? "").split(/[?#]/)[0]!;
    const parts = path.split("/").filter(Boolean);
    if (!parts.length) return null;
    const first = parts[0]!;
    if (first.startsWith("+")) {
      const hash = first.slice(1);
      return HASH_RE.test(hash) ? { channelUrl: `https://t.me/+${hash}`, username: null, invite: true, folder: null } : null;
    }
    const low = first.toLowerCase();
    if (low === "joinchat") {
      const hash = parts[1] ?? "";
      return HASH_RE.test(hash) ? { channelUrl: `https://t.me/+${hash}`, username: null, invite: true, folder: null } : null;
    }
    if (low === "addlist") {
      const hash = parts[1] ?? "";
      return HASH_RE.test(hash) ? { channelUrl: `https://t.me/addlist/${hash}`, username: null, invite: false, folder: hash } : null;
    }
    // « t.me/s/nom » (aperçu) et « t.me/boost/nom » désignent le canal.
    const name = low === "s" || low === "boost" ? parts[1] : first;
    const u = cleanUsername(name);
    return u ? { channelUrl: `https://t.me/${u}`, username: u, invite: false, folder: null } : null;
  }
  // Adresse web d'un autre site : pas un canal.
  if (/[/.:]/.test(s.replace(/^@/, ""))) return null;
  const u = cleanUsername(s);
  return u ? { channelUrl: `https://t.me/${u}`, username: u, invite: false, folder: null } : null;
}

/** Liens Telegram d'un HTML ou d'un texte, normalisés et sans doublon (canaux, invitations, dossiers). */
export function extractTmeLinks(htmlOrText: string): string[] {
  const text = decodeHtmlEntities(htmlOrText ?? "").replace(/%2F/gi, "/");
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/[^\s"'<>()[\]{}|\\^`,]+|tg:\/\/resolve\?domain=[A-Za-z0-9_]+/gi;
  for (const m of text.matchAll(re)) {
    // Le domaine doit commencer un mot (« bet.me/… » ou « xt.me » ne sont pas t.me).
    const before = text[m.index! - 1];
    if (before && /[A-Za-z0-9._-]/.test(before) && !/^https?:/i.test(m[0])) continue;
    const n = normalizeProspectUrl(m[0]);
    if (!n || seen.has(n.channelUrl)) continue;
    seen.add(n.channelUrl);
    out.push(n.channelUrl);
  }
  return out;
}

/** Usernames cités « @nom » (pas les emails « x@y.com »), minuscules, sans bots ni doublons. */
export function extractMentions(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of decodeHtmlEntities(text ?? "").matchAll(/(^|[^A-Za-z0-9_.@/-])@([A-Za-z][A-Za-z0-9_]{3,31})(?![A-Za-z0-9_.-]*\.[a-z]{2,})/g)) {
    const u = cleanUsername(m[2]);
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

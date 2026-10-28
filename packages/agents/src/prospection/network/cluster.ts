/**
 * Phase 32, chantier A — rapprochement des canaux tenus par la même personne (section 2 du prompt). Code pur, sans IA.
 *
 * Une preuve = un lien noté entre deux canaux (`NETWORK_LINK_POINTS`), chaque type compté une fois par paire :
 * - `same_contact` (+3) : même contact public HIGH / MEDIUM (username Telegram, e-mail, bot) ;
 * - `same_signature` (+2) : même nom d'auteur sous les posts ;
 * - `same_linked_group` (+3) : même groupe de discussion lié ;
 * - `same_site` (+2) : même site ou même page de liens (linktree : la page, pas le service) ;
 * - `cross_forwards` (+2) : transferts réguliers dans les DEUX sens (2 au moins de chaque côté) ;
 * - `same_description` (+1) : description quasi identique (mots par trois en commun, 80 % au moins) ;
 * - `same_promo_code` (+2) : même code promo.
 * Paire liée à `NETWORK_MIN_POINTS` (4) ou plus. Réseaux = regroupement des paires liées, les plus fortes d'abord, sans
 * jamais réunir deux canaux que le client a séparés (`splitPairs`) ; les groupes fusionnés par le client
 * (`manualGroups`) restent ensemble. Une valeur partagée par plus de 20 canaux (contact d'agence, code générique) ne
 * prouve rien et est ignorée.
 */
import { findBrandByDomain, affiliatePatterns } from "../dict";
import { NETWORK_LINK_POINTS, NETWORK_MIN_POINTS, type NetworkEvidence, type NetworkLinkKind } from "../contract-advanced";

export type ClusterProspect = {
  id: string;
  username: string | null;
  contacts: Array<{ type: string; value: string; confidence: string; source: string }>;
  description: string | null;
  promoCodes: string[];
  /** Canaux d'origine des transferts lus (`{ nom: nombre }`). */
  forwardsFrom: Record<string, number>;
  /** Noms d'auteur relus (événement REQUALIFIED) en plus des contacts de source « signature ». */
  signatures?: string[];
};

export type Cluster = { members: string[]; evidence: NetworkEvidence[]; manual: boolean };

/** Une valeur vue chez plus de canaux que ça ne relie personne (agence, code générique). */
export const GENERIC_SHARE_MAX = 20;
const GENERIC_SIGNATURES = new Set(["admin", "administrateur", "administrator", "team", "équipe", "equipe", "staff", "redaction", "rédaction", "editor", "bot", "support", "moderator", "modérateur"]);
const GENERIC_CODES = new Set(["BONUS", "PROMO", "WELCOME", "FREE", "VIP", "CODE", "GIFT", "FREEBET", "CASINO", "SPORT"]);
const DESCRIPTION_MIN_WORDS = 8;
const DESCRIPTION_SIMILARITY = 0.8;
const CROSS_FORWARDS_MIN = 2;

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const low = (s: string) => s.trim().toLowerCase();

/**
 * Annuaires et places de marché de canaux : un lien vers eux ne prouve pas un même propriétaire (chaque canal y a sa
 * fiche). Réseaux sociaux et plateformes : la page (hôte + premier segment), jamais le seul hôte.
 */
const DIRECTORY_HOSTS = new Set(["telega.io", "telega.in", "tgstat.com", "tgstat.ru", "uk.tgstat.com", "telemetr.io", "telemetr.me", "telegramchannels.me", "tlgrm.eu", "tlgrm.ru", "combot.org", "telegram-store.com", "tgram.io", "collaborator.pro", "epicstars.com", "telegate.io"]);
const PLATFORM_HOSTS = new Set(["instagram.com", "tiktok.com", "x.com", "twitter.com", "facebook.com", "youtube.com", "m.youtube.com", "youtu.be", "twitch.tv", "kick.com", "discord.gg", "discord.com", "wa.me", "whatsapp.com", "snapchat.com", "threads.net", "linkedin.com", "reddit.com", "patreon.com", "onlyfans.com", "medium.com", "github.com", "google.com", "docs.google.com", "forms.gle", "play.google.com", "apps.apple.com"]);

/** Site d'un contact (hôte ; page de liens ou de réseau social : hôte + page). Marques, raccourcisseurs, Telegram, annuaires : null. */
export function siteKey(value: string): string | null {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (!host.includes(".") || /(^|\.)(t\.me|telegram\.me|telegram\.org)$/.test(host)) return null;
  if (DIRECTORY_HOSTS.has(host) || [...DIRECTORY_HOSTS].some((d) => host.endsWith(`.${d}`))) return null;
  const pat = affiliatePatterns();
  if (pat.linkHubs.includes(host) || PLATFORM_HOSTS.has(host)) {
    const page = u.pathname.split("/").filter(Boolean)[0];
    return page ? `${host}/${page.toLowerCase()}` : null;
  }
  if (pat.shorteners.includes(host) || findBrandByDomain(host)) return null;
  return host;
}

/** Description ramenée à ses mots (liens, @noms, chiffres et ponctuation retirés). */
export function descriptionWords(d: string | null): string[] {
  if (!d) return [];
  return d
    .toLowerCase()
    .replace(/https?:\/\/\S+|@\w+|\d+/g, " ")
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length >= 2);
}

function trigrams(words: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) out.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return out;
}

/** Similarité de deux descriptions (Jaccard sur les mots par trois). Pur. */
export function descriptionSimilarity(a: string | null, b: string | null): number {
  const wa = descriptionWords(a);
  const wb = descriptionWords(b);
  if (wa.length < DESCRIPTION_MIN_WORDS || wb.length < DESCRIPTION_MIN_WORDS) return 0;
  const ta = trigrams(wa);
  const tb = trigrams(wb);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter || 1);
}

type Keys = { contacts: Map<string, string>; signatures: Map<string, string>; groups: Map<string, string>; sites: Map<string, string>; codes: Map<string, string> };

/** Clés comparables d'un canal (valeur normalisée → valeur affichée). */
export function keysOf(p: ClusterProspect): Keys {
  const self = p.username ? low(p.username) : null;
  const k: Keys = { contacts: new Map(), signatures: new Map(), groups: new Map(), sites: new Map(), codes: new Map() };
  for (const c of p.contacts) {
    const v = low(c.value);
    if (c.source === "signature") {
      const s = v.replace(/^@/, "");
      if (s.length >= 3 && !GENERIC_SIGNATURES.has(s)) k.signatures.set(s, c.value);
      continue;
    }
    if (c.type === "LINKED_GROUP") {
      const g = v.replace(/^@/, "").replace(/^https?:\/\/t\.me\//, "");
      if (g && g !== self) k.groups.set(g, c.value);
      continue;
    }
    if (c.type === "WEBSITE") {
      const s = siteKey(c.value);
      if (s) k.sites.set(s, s);
      continue;
    }
    if ((c.type === "TELEGRAM_USERNAME" || c.type === "EMAIL" || c.type === "BOT") && (c.confidence === "HIGH" || c.confidence === "MEDIUM")) {
      const u = v.replace(/^@/, "");
      if (u && u !== self) k.contacts.set(v.startsWith("@") || c.type === "EMAIL" ? v : `@${u}`, c.value);
    }
  }
  for (const s of p.signatures ?? []) {
    const v = low(s).replace(/^@/, "");
    if (v.length >= 3 && !GENERIC_SIGNATURES.has(v)) k.signatures.set(v, s);
  }
  for (const code of p.promoCodes) {
    const c = code.trim().toUpperCase();
    if (c.length >= 4 && !GENERIC_CODES.has(c)) k.codes.set(c, c);
  }
  return k;
}

const LABEL: Record<NetworkLinkKind, (v: string) => string> = {
  same_contact: (v) => `même contact ${v}`,
  same_signature: (v) => `même signature «\u00a0${v}\u00a0»`,
  same_linked_group: (v) => `même groupe de discussion ${v}`,
  same_site: (v) => `même site ${v}`,
  cross_forwards: (v) => `transferts dans les deux sens (${v})`,
  same_description: () => "description presque identique",
  same_promo_code: (v) => `même code promo ${v}`,
};

/** Preuves entre deux canaux (chaque type une fois). Pur. */
export function pairEvidence(a: ClusterProspect, b: ClusterProspect, ka: Keys = keysOf(a), kb: Keys = keysOf(b)): NetworkEvidence[] {
  const out: NetworkEvidence[] = [];
  const add = (kind: NetworkLinkKind, detail: string) => out.push({ a: a.id, b: b.id, kind, points: NETWORK_LINK_POINTS[kind], detail });
  const shared = (x: Map<string, string>, y: Map<string, string>) => [...x.keys()].find((v) => y.has(v));
  const contact = shared(ka.contacts, kb.contacts);
  if (contact) add("same_contact", LABEL.same_contact(ka.contacts.get(contact)!));
  const sig = shared(ka.signatures, kb.signatures);
  if (sig) add("same_signature", LABEL.same_signature(ka.signatures.get(sig)!));
  const group = shared(ka.groups, kb.groups);
  if (group) add("same_linked_group", LABEL.same_linked_group(ka.groups.get(group)!));
  const site = shared(ka.sites, kb.sites);
  if (site) add("same_site", LABEL.same_site(site));
  if (a.username && b.username) {
    const ab = a.forwardsFrom[low(b.username)] ?? 0;
    const ba = b.forwardsFrom[low(a.username)] ?? 0;
    if (ab >= CROSS_FORWARDS_MIN && ba >= CROSS_FORWARDS_MIN) add("cross_forwards", LABEL.cross_forwards(`${ab} et ${ba}`));
  }
  if (descriptionSimilarity(a.description, b.description) >= DESCRIPTION_SIMILARITY) add("same_description", LABEL.same_description(""));
  const code = shared(ka.codes, kb.codes);
  if (code) add("same_promo_code", LABEL.same_promo_code(code));
  return out;
}

export const pointsOf = (ev: readonly NetworkEvidence[]) => ev.reduce((s, e) => s + e.points, 0);

/** Paires candidates (une valeur partagée, ou des descriptions proches) : évite de comparer tous les canaux 2 à 2. */
function candidatePairs(list: readonly ClusterProspect[], keys: ReadonlyMap<string, Keys>): Set<string> {
  const index = new Map<string, string[]>();
  const put = (k: string, id: string) => {
    const l = index.get(k);
    if (l) l.push(id);
    else index.set(k, [id]);
  };
  for (const p of list) {
    const k = keys.get(p.id)!;
    for (const v of k.contacts.keys()) put(`c:${v}`, p.id);
    for (const v of k.signatures.keys()) put(`s:${v}`, p.id);
    for (const v of k.groups.keys()) put(`g:${v}`, p.id);
    for (const v of k.sites.keys()) put(`w:${v}`, p.id);
    for (const v of k.codes.keys()) put(`p:${v}`, p.id);
    for (const t of trigrams(descriptionWords(p.description))) put(`d:${t}`, p.id);
    if (p.username) put(`u:${low(p.username)}`, p.id);
    for (const [from, n] of Object.entries(p.forwardsFrom)) if (n >= CROSS_FORWARDS_MIN) put(`u:${low(from)}`, p.id);
  }
  const pairs = new Set<string>();
  for (const ids of index.values()) {
    if (ids.length < 2 || ids.length > GENERIC_SHARE_MAX) continue;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (ids[i] !== ids[j]) pairs.add(pairKey(ids[i]!, ids[j]!));
  }
  return pairs;
}

/** Toutes les paires liées (≥ 4 points), les plus fortes d'abord. Pur. */
export function linkedPairs(list: readonly ClusterProspect[]): Array<{ a: string; b: string; points: number; evidence: NetworkEvidence[] }> {
  const byId = new Map(list.map((p) => [p.id, p]));
  const keys = new Map(list.map((p) => [p.id, keysOf(p)]));
  const out: Array<{ a: string; b: string; points: number; evidence: NetworkEvidence[] }> = [];
  for (const pk of candidatePairs(list, keys)) {
    const [x, y] = pk.split("|") as [string, string];
    const ev = pairEvidence(byId.get(x)!, byId.get(y)!, keys.get(x)!, keys.get(y)!);
    const points = pointsOf(ev);
    if (points >= NETWORK_MIN_POINTS) out.push({ a: x, b: y, points, evidence: ev });
  }
  return out.sort((p, q) => q.points - p.points || p.a.localeCompare(q.a) || p.b.localeCompare(q.b));
}

/**
 * Réseaux (pur) : groupes du client d'abord, puis les paires liées des plus fortes aux plus faibles ; une réunion qui
 * rassemblerait une paire séparée par le client est refusée. Seuls les groupes de 2 canaux ou plus sortent.
 */
export function buildClusters(
  list: readonly ClusterProspect[],
  opts: { splitPairs?: ReadonlyArray<readonly [string, string]>; manualGroups?: ReadonlyArray<readonly string[]> } = {},
): Cluster[] {
  const ids = new Set(list.map((p) => p.id));
  const split = new Set((opts.splitPairs ?? []).map(([a, b]) => pairKey(a, b)));
  const groupOf = new Map<string, Set<string>>();
  const manual = new Set<Set<string>>();
  const get = (id: string) => {
    let g = groupOf.get(id);
    if (!g) {
      g = new Set([id]);
      groupOf.set(id, g);
    }
    return g;
  };
  const crosses = (x: Set<string>, y: Set<string>) => {
    for (const a of x) for (const b of y) if (split.has(pairKey(a, b))) return true;
    return false;
  };
  const join = (x: Set<string>, y: Set<string>, force: boolean): Set<string> | null => {
    if (x === y) return x;
    if (!force && crosses(x, y)) return null;
    for (const id of y) {
      x.add(id);
      groupOf.set(id, x);
    }
    if (manual.has(y)) {
      manual.delete(y);
      manual.add(x);
    }
    return x;
  };
  for (const g of opts.manualGroups ?? []) {
    const members = g.filter((id) => ids.has(id));
    if (members.length < 2) continue;
    let acc = get(members[0]!);
    for (const id of members.slice(1)) acc = join(acc, get(id), true)!;
    manual.add(acc);
  }
  const evidence: NetworkEvidence[] = [];
  for (const pair of linkedPairs(list)) {
    const joined = join(get(pair.a), get(pair.b), false);
    if (joined) evidence.push(...pair.evidence);
  }
  const seen = new Set<Set<string>>();
  const out: Cluster[] = [];
  for (const g of groupOf.values()) {
    if (seen.has(g) || g.size < 2) continue;
    seen.add(g);
    const members = [...g].sort();
    out.push({ members, evidence: evidence.filter((e) => g.has(e.a) && g.has(e.b)), manual: manual.has(g) });
  }
  return out.sort((a, b) => b.members.length - a.members.length || a.members[0]!.localeCompare(b.members[0]!));
}

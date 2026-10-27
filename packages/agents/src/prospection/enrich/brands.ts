/**
 * Phase 31, chantier B — marques poussées et état concurrentiel (section 3.10).
 *
 * - `detectBrandLinks` (code) : marques repérées dans les posts par domaine d'un lien ou d'un bouton
 *   (`findBrandByDomain`), par texte d'un bouton, par nom dans le texte (les noms « ambigus » du dictionnaire —
 *   Stake, Toto, Placard… — ne comptent que sur un lien ou un bouton), et codes promo (« code promo XYZ » dans toutes
 *   les langues du dictionnaire).
 * - `mergeBrands` : fusion avec les marques vues par l'IA (une marque de l'IA absente des données est écartée), dates
 *   et nombres de liens par le code, intensité par la part des posts qui la citent (≥ 30 % HEAVY, ≥ 10 % MEDIUM).
 * - `competitiveState` : FREE (aucune marque), EXCLUSIVE (une seule marque, HEAVY, du premier au dernier post lu),
 *   ROTATING (≥ 2 marques, ou une marque qui n'occupe pas toute la fenêtre), OURS (marque d'une offre active du
 *   client → `PROMOTES_OUR_BRAND`, à vérifier : peut-être déjà affilié ailleurs).
 */
import { affiliatePatterns, brandsDict, brandToken, findBrand, findBrandByDomain, type Brand } from "../dict";
import { containsTerm } from "./terms";
import type { BrandMention, CompetitiveState, ProspectPost, RiskFlag } from "../contract";

export type DetectedBrand = {
  key: string;
  name: string;
  country: string;
  postId: number;
  at: Date;
  /** Trouvée par un lien ou un bouton (sinon : nom dans le texte). */
  viaLink: boolean;
  promoCode: string | null;
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Noms et alias d'une marque cherchés dans un texte (3 caractères au moins, jamais un domaine). */
let brandNames: Array<{ brand: Brand; names: string[] }> | null = null;
function namesOfBrands(): Array<{ brand: Brand; names: string[] }> {
  brandNames ??= brandsDict().map((brand) => ({
    brand,
    names: [...new Set([brand.name, ...brand.aliases].filter((n) => n.length >= 3 && !n.includes(".")).flatMap((n) => [n, n.replace(/-/g, " "), n.replace(/[-\s]/g, "")]))],
  }));
  return brandNames;
}

/** Le texte cite-t-il la marque (mot entier, casse ignorée) ? */
function mentionsBrand(text: string, lower: string, names: string[]): boolean {
  return names.some((n) => containsTerm(text, n.length <= 4 ? n.toLowerCase() : n, lower));
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Lien d'affiliation probable : paramètre ou chemin connu, ou raccourcisseur (`dict/affiliate-patterns.json`). */
export function isAffiliateLink(url: string): boolean {
  const p = affiliatePatterns();
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (/^(t\.me|telegram\.me)$/.test(host)) return false;
  if (p.shorteners.includes(host) && !p.linkHubs.includes(host)) return true;
  for (const k of u.searchParams.keys()) {
    const key = k.toLowerCase();
    if (p.queryParams.includes(key) || p.paramPrefixes.some((pre) => key.startsWith(pre))) return true;
  }
  const path = u.pathname.toLowerCase();
  return p.pathMarkers.some((m) => path.includes(m)) && !!findBrandByDomain(host);
}

let promoRe: RegExp | null = null;
/** « code promo : MAX10 », « promo code XYZ », « codice promo ABC »… → code en capitales (3 à 20 caractères). */
export function promoCodesIn(text: string): string[] {
  if (!promoRe) {
    const labels = [...new Set(Object.values(affiliatePatterns().promoCodeLabels).flat())]
      .map((l) => l.replace(/\s*:$/, "").trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)
      .map((l) => escapeRe(l).replace(/\s+/g, "\\s+"));
    promoRe = new RegExp(`(?:${labels.join("|")})\\s*[:：\\-–—»"«]?\\s*[«"“]?([A-Z0-9][A-Z0-9_-]{2,19})(?![\\p{L}\\p{N}])`, "giu");
  }
  const out = new Set<string>();
  for (const m of text.matchAll(promoRe)) {
    const code = m[1]!;
    // Un code a au moins une majuscule ou un chiffre et n'est pas un mot courant en minuscules.
    if (code === code.toLowerCase() && !/\d/.test(code)) continue;
    out.add(code.toUpperCase());
  }
  return [...out];
}

/** Marques repérées par le code dans les posts (une entrée par post et par marque). */
export function detectBrandLinks(posts: ProspectPost[]): DetectedBrand[] {
  const out: DetectedBrand[] = [];
  for (const p of posts) {
    const byKey = new Map<string, DetectedBrand>();
    const add = (b: Brand, viaLink: boolean) => {
      const prev = byKey.get(b.key);
      if (prev) prev.viaLink ||= viaLink;
      else byKey.set(b.key, { key: b.key, name: b.name, country: b.country, postId: p.id, at: p.postedAt, viaLink, promoCode: null });
    };
    for (const url of [...p.links, ...p.buttons.map((b) => b.url)]) {
      const b = findBrandByDomain(hostOf(url));
      if (b) add(b, true);
    }
    for (const btn of p.buttons) {
      const low = btn.text.toLowerCase();
      for (const { brand, names } of namesOfBrands()) if (mentionsBrand(btn.text, low, names)) add(brand, true);
    }
    const lower = p.text.toLowerCase();
    for (const { brand, names } of namesOfBrands()) {
      if (brand.ambiguous) continue;
      if (mentionsBrand(p.text, lower, names)) add(brand, false);
    }
    const codes = promoCodesIn(p.text);
    if (codes.length) for (const d of byKey.values()) d.promoCode = codes[0]!;
    out.push(...byKey.values());
  }
  return out;
}

export type BrandWindow = { firstPostAt: Date | null; lastPostAt: Date | null; postCount: number; corpus?: string };

export type MergedBrands = { brands: BrandMention[]; competitiveState: CompetitiveState; hasCompetitor: boolean; riskFlags: RiskFlag[] };

const day = (d: Date) => d.toISOString().slice(0, 10);
const DAY = 86_400_000;
const EXCLUSIVE_EDGE_DAYS = 3;

function intensityOf(share: number): BrandMention["intensity"] {
  return share >= 0.3 ? "HEAVY" : share >= 0.1 ? "MEDIUM" : "LIGHT";
}

/** Fusionne les marques de l'IA et du code, puis tranche l'état concurrentiel. */
export function mergeBrands(
  aiBrands: BrandMention[],
  detected: DetectedBrand[],
  offers: Array<{ brand: string; isActive?: boolean }>,
  window: BrandWindow = { firstPostAt: null, lastPostAt: null, postCount: 0 },
): MergedBrands {
  const merged = new Map<string, BrandMention & { posts: Set<number>; first: Date | null; last: Date | null }>();
  for (const d of detected) {
    let m = merged.get(d.key);
    if (!m) {
      m = { brand: d.name, country: d.country, links: 0, promoCode: null, firstSeenAt: null, lastSeenAt: null, intensity: "LIGHT", evidence: null, posts: new Set(), first: null, last: null };
      merged.set(d.key, m);
    }
    m.posts.add(d.postId);
    if (d.viaLink) m.links++;
    m.promoCode ??= d.promoCode;
    if (!m.first || d.at < m.first) m.first = d.at;
    if (!m.last || d.at > m.last) m.last = d.at;
  }
  const corpus = window.corpus?.toLowerCase() ?? null;
  for (const a of aiBrands) {
    const known = findBrand(a.brand);
    const key = known?.key ?? `ai:${brandToken(a.brand)}`;
    const m = merged.get(key);
    if (m) {
      m.promoCode ??= a.promoCode;
      m.evidence ??= a.evidence ?? null;
      continue;
    }
    // Marque vue par l'IA seulement : gardée si son nom (ou son code promo) figure dans les données.
    if (corpus && !corpus.includes(a.brand.toLowerCase()) && !(a.promoCode && corpus.includes(a.promoCode.toLowerCase()))) continue;
    merged.set(key, {
      ...a,
      brand: known?.name ?? a.brand,
      country: known?.country ?? null,
      links: Math.min(a.links, window.postCount || a.links),
      posts: new Set(),
      first: null,
      last: null,
    });
  }
  const brands: BrandMention[] = [];
  for (const m of merged.values()) {
    const { posts, first, last, ...rest } = m;
    const share = window.postCount ? posts.size / window.postCount : null;
    brands.push({
      ...rest,
      firstSeenAt: first ? day(first) : rest.firstSeenAt,
      lastSeenAt: last ? day(last) : rest.lastSeenAt,
      intensity: share !== null && posts.size ? intensityOf(share) : rest.intensity,
      evidence: rest.evidence ?? null,
    });
  }
  brands.sort((a, b) => b.links - a.links || a.brand.localeCompare(b.brand));

  const ourKeys = new Set(
    offers.filter((o) => o.isActive !== false).map((o) => findBrand(o.brand)?.key ?? `ai:${brandToken(o.brand)}`),
  );
  const isOurs = (b: BrandMention) => ourKeys.has(findBrand(b.brand)?.key ?? `ai:${brandToken(b.brand)}`);
  const riskFlags: RiskFlag[] = [];
  let competitiveState: CompetitiveState;
  if (!brands.length) competitiveState = "FREE";
  else if (brands.some(isOurs)) {
    competitiveState = "OURS";
    riskFlags.push("PROMOTES_OUR_BRAND");
  } else if (brands.length === 1) {
    const b = brands[0]!;
    const spans =
      !!window.firstPostAt &&
      !!window.lastPostAt &&
      !!b.firstSeenAt &&
      !!b.lastSeenAt &&
      Date.parse(b.firstSeenAt) <= window.firstPostAt.getTime() + EXCLUSIVE_EDGE_DAYS * DAY &&
      Date.parse(b.lastSeenAt) + DAY >= window.lastPostAt.getTime() - EXCLUSIVE_EDGE_DAYS * DAY;
    competitiveState = b.intensity === "HEAVY" && spans ? "EXCLUSIVE" : "ROTATING";
  } else competitiveState = "ROTATING";
  const hasCompetitor = brands.some((b) => !isOurs(b));
  return { brands, competitiveState, hasCompetitor, riskFlags };
}

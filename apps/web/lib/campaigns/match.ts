/** Correspondance de noms de pubs (fonctions pures). */

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type Named = { id: string; name: string };

/** Trouve l'élément dont le nom correspond (insensible à la casse, aux accents et aux espaces). */
export function matchByName<T extends Named>(name: string, candidates: T[]): T | null {
  const n = normalizeName(name);
  if (!n) return null;
  return candidates.find((c) => normalizeName(c.name) === n) ?? null;
}

export type MatchStatus = "existing" | "create";

export type RowMatch = {
  campaign: { name: string; id: string | null; status: MatchStatus };
  adset: { name: string; id: string | null; status: MatchStatus } | null;
  ad: { name: string; id: string | null; status: MatchStatus } | null;
};

export type CampaignTree = Array<{ id: string; name: string; adSets: Array<{ id: string; name: string; ads: Array<{ id: string; name: string }> }> }>;

/** Résout une ligne (campagne / groupe / pub) contre l'arbre existant. */
export function matchRow(row: { campaign: string; adset: string; ad: string }, tree: CampaignTree): RowMatch {
  const campaignName = row.campaign || row.adset || row.ad || "Sans nom";
  const campaign = matchByName(campaignName, tree);
  const out: RowMatch = { campaign: { name: campaignName, id: campaign?.id ?? null, status: campaign ? "existing" : "create" }, adset: null, ad: null };
  if (row.adset) {
    const adset = campaign ? matchByName(row.adset, campaign.adSets) : null;
    out.adset = { name: row.adset, id: adset?.id ?? null, status: adset ? "existing" : "create" };
    if (row.ad) {
      const ad = adset ? matchByName(row.ad, adset.ads) : null;
      out.ad = { name: row.ad, id: ad?.id ?? null, status: ad ? "existing" : "create" };
    }
  } else if (row.ad) {
    // Pub sans groupe : un groupe implicite portant le nom de la campagne.
    const adset = campaign ? matchByName(campaignName, campaign.adSets) : null;
    out.adset = { name: campaignName, id: adset?.id ?? null, status: adset ? "existing" : "create" };
    const ad = adset ? matchByName(row.ad, adset.ads) : null;
    out.ad = { name: row.ad, id: ad?.id ?? null, status: ad ? "existing" : "create" };
  }
  return out;
}

/** Clé de niveau d'un coût : "ad:<id>" | "adset:<id>" | "campaign:<id>". */
export function levelKey(level: { adId?: string | null; adSetId?: string | null; campaignId?: string | null }): string {
  if (level.adId) return `ad:${level.adId}`;
  if (level.adSetId) return `adset:${level.adSetId}`;
  if (level.campaignId) return `campaign:${level.campaignId}`;
  throw new Error("Niveau de coût manquant");
}

// ============================================================
// Convention de nommage et liaison pub ↔ campagne Link Affi
// ============================================================

export const NAMING_EXAMPLE = "TT-casinoX-FR-canalA-2026-10";
export const NAMING_HELP = `Nommez vos campagnes « ${NAMING_EXAMPLE} » (plateforme-programme-langue-canal-mois) : la liaison avec la campagne Link Affi et l'import des coûts se font alors tout seuls.`;

const PLATFORM_CODES: Record<string, string> = { TIKTOK: "TT", META: "META", OTHER: "PUB" };
const VERTICAL_SLUGS: Record<string, string> = { CASINO: "casino", SPORTS: "sports", DATING: "dating" };

/** « Canal A bonus » → « canalABonus » : sans accent ni espace, première lettre en minuscule. */
function camelSlug(s: string): string {
  const words = normalizeName(s)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  return words.map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1))).join("");
}

/** Construit un nom conventionnel. Les segments vides sont omis ; le mois est toujours présent. */
export function buildCampaignName(input: { platform?: string | null; program?: string | null; language?: string | null; channel?: string | null; date?: Date }): string {
  const d = input.date ?? new Date();
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const platform = input.platform ? (PLATFORM_CODES[input.platform] ?? input.platform.toUpperCase()) : "";
  const programRaw = (input.program ?? "").trim();
  const program = VERTICAL_SLUGS[programRaw] ?? programRaw.replace(/[^\p{L}\p{N}]+/gu, "");
  const language = (input.language ?? "").trim().toUpperCase().replace(/[^A-Z]/g, "");
  const channel = input.channel ? camelSlug(input.channel) : "";
  return [platform, program, language, channel, month].filter(Boolean).join("-");
}

const STOPWORDS = new Set(["de", "la", "le", "les", "du", "des", "et", "en", "un", "une", "the", "of", "and", "campagne", "campaign", "pub", "ad", "ads", "offre", "offer"]);

/** Jetons d'un nom : minuscules sans accent, coupés sur tout ce qui n'est pas lettre ou chiffre, mots vides retirés. */
export function nameTokens(name: string): string[] {
  // « casinoX » → « casino X » avant la mise en minuscules ; « 2026-10 » donne « 2026 » et « 10 ».
  const split = name.replace(/([a-z])([A-Z])/g, "$1 $2");
  const raw = normalizeName(split)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  return [...new Set(raw)];
}

/** Poids d'un jeton : les codes courts (fr, tt) et les nombres (2026, 10) comptent moitié moins qu'un vrai mot. */
function tokenWeight(t: string): number {
  return t.length <= 2 || /^\d+$/.test(t) ? 0.5 : 1;
}

/**
 * Score de similarité 0..1 entre deux noms (cosinus pondéré) : jetons identiques (poids entier), jeton contenu dans
 * un autre d'au moins 4 lettres (demi-poids). Il faut au moins un vrai mot en commun pour que le score soit non nul ;
 * 1 si les noms normalisés sont égaux.
 */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  let points = 0;
  let realWord = false;
  for (const x of ta) {
    const w = tokenWeight(x);
    if (tb.includes(x)) {
      points += w;
      if (w === 1) realWord = true;
      continue;
    }
    if (x.length >= 4 && tb.some((y) => y.length >= 4 && (y.includes(x) || x.includes(y)))) {
      points += w / 2;
      realWord = true;
    }
  }
  if (!realWord) return 0;
  const wa = ta.reduce((s, t) => s + tokenWeight(t), 0);
  const wb = tb.reduce((s, t) => s + tokenWeight(t), 0);
  return Math.min(1, points / Math.sqrt(wa * wb));
}

export type Suggestion<T extends Named> = { candidate: T; score: number };

/** Candidats triés par similarité décroissante (score > 0 seulement). */
export function rankByName<T extends Named>(name: string, candidates: T[]): Array<Suggestion<T>> {
  return candidates
    .map((candidate) => ({ candidate, score: nameSimilarity(name, candidate.name) }))
    .filter((s) => s.score > 0)
    .sort((x, y) => y.score - x.score || x.candidate.name.localeCompare(y.candidate.name));
}

export const SUGGESTION_MIN_SCORE = 0.34;

/** Meilleure campagne Link Affi pour un nom de pub, ou null si aucun candidat n'est assez proche. */
export function suggestAffiliateCampaign<T extends Named>(name: string, candidates: T[], minScore = SUGGESTION_MIN_SCORE): Suggestion<T> | null {
  const best = rankByName(name, candidates)[0];
  return best && best.score >= minScore ? best : null;
}

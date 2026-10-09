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

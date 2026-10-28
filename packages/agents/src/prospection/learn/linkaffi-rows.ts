/**
 * Phase 32, chantier B — lecture des lignes Link Affi (pur), partagée par le lecteur réel du worker
 * (`apps/worker/src/agents/linkaffi-reader.ts`) et le faux lecteur des tests. Aucune donnée personnelle gardée :
 * identifiant d'affilié, nom (table `profiles`, exception documentée de `docs/LINKAFFI-API.md`) et agrégats.
 *
 * Table `stats` (agrégat journalier par affilié, casino, campagne) : clics = `clicks`, inscriptions = `signups`,
 * premiers dépôts = `qualified_ftds` (FTD validés par Link Affi), revenus = `revenue` (euros, commission nette de
 * l'affilié). Une colonne absente de toutes les lignes est notée manquante (valeur null), jamais estimée. Aucune ligne
 * sur la période = aucune activité (zéros).
 */

type Row = Record<string, unknown>;

export type AffiliateStatsAggregate = { clicks: number | null; regs: number | null; ftd: number | null; revenueCents: number | null; missing: string[] };

/** Colonnes de `stats` lues, par champ de `AffiliateResult`. */
export const LINKAFFI_STATS_COLUMNS = { clicks: "clicks", regs: "signups", ftd: "qualified_ftds", revenue: "revenue" } as const;

const numOf = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Somme d'une colonne ; null si aucune ligne ne la porte (champ manquant). */
function sumColumn(rows: readonly Row[], col: string): number | null {
  let seen = false;
  let total = 0;
  for (const r of rows) {
    const n = numOf(r[col]);
    if (n === null) continue;
    seen = true;
    total += n;
  }
  return seen ? total : null;
}

/** Agrégats d'un affilié sur une période, à partir des lignes `stats` (pur). */
export function aggregateAffiliateStats(rows: readonly Row[]): AffiliateStatsAggregate {
  if (!rows.length) return { clicks: 0, regs: 0, ftd: 0, revenueCents: 0, missing: [] };
  const missing: string[] = [];
  const pickSum = (field: keyof typeof LINKAFFI_STATS_COLUMNS) => {
    const v = sumColumn(rows, LINKAFFI_STATS_COLUMNS[field]);
    if (v === null) missing.push(field);
    return v;
  };
  const clicks = pickSum("clicks");
  const regs = pickSum("regs");
  const ftd = pickSum("ftd");
  const revenue = pickSum("revenue");
  return {
    clicks: clicks === null ? null : Math.round(clicks),
    regs: regs === null ? null : Math.round(regs),
    ftd: ftd === null ? null : Math.round(ftd),
    revenueCents: revenue === null ? null : Math.round(revenue * 100),
    missing,
  };
}

export type RecentAffiliate = { affiliateId: string; name: string | null; firstCampaignAt: string | null };

/** Affiliés des campagnes (`campaigns` : `affiliate_id`, `created_at`), les plus récents d'abord (première campagne). */
export function recentAffiliatesFrom(campaigns: readonly Row[], limit: number): Array<Omit<RecentAffiliate, "name">> {
  const first = new Map<string, string | null>();
  for (const c of campaigns) {
    const id = typeof c.affiliate_id === "string" ? c.affiliate_id.trim() : typeof c.affiliate_id === "number" ? String(c.affiliate_id) : "";
    if (!id) continue;
    const at = typeof c.created_at === "string" && Number.isFinite(Date.parse(c.created_at)) ? c.created_at : null;
    const prev = first.get(id);
    if (prev === undefined || (at && (!prev || Date.parse(at) < Date.parse(prev)))) first.set(id, at);
  }
  return [...first.entries()]
    .map(([affiliateId, firstCampaignAt]) => ({ affiliateId, firstCampaignAt }))
    .sort((a, b) => (b.firstCampaignAt ? Date.parse(b.firstCampaignAt) : 0) - (a.firstCampaignAt ? Date.parse(a.firstCampaignAt) : 0))
    .slice(0, Math.max(0, limit));
}

/** Colonnes de `profiles` qui peuvent porter le nom ; aucune autre n'est lue. */
export const PROFILE_NAME_COLUMNS = ["display_name", "full_name", "name", "username", "company_name"] as const;

/** Nom d'un affilié à partir de sa ligne `profiles` (rien d'autre n'est gardé), 60 caractères au plus. */
export function profileNameOf(row: Row | null | undefined): string | null {
  if (!row) return null;
  for (const col of PROFILE_NAME_COLUMNS) {
    const v = row[col];
    if (typeof v === "string" && v.trim()) return v.replace(/\s+/g, " ").trim().slice(0, 60);
  }
  return null;
}

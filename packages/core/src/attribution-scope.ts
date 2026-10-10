/**
 * « Nos » joueurs (phase 8) : un joueur Link Affi n'entre dans les statistiques que s'il est rattaché à un de nos clics
 * (sub-ID → `Click`) OU s'il appartient à une campagne Link Affi rattachée à une de nos campagnes.
 * Tout le reste (autres affiliés, campagnes non rattachées) reste visible seulement dans Réglages → Connecteurs.
 */
export type OurPlayerWhere = { OR: Array<{ clickId: { not: null } } | { affiliateCampaignId: { in: string[] } }> };

/** Condition Prisma `where` sur `Player` ; `ids` = campagnes Link Affi rattachées à nos campagnes. */
export function ourPlayerWhere(ids: readonly string[]): OurPlayerWhere {
  const or: OurPlayerWhere["OR"] = [{ clickId: { not: null } }];
  if (ids.length > 0) or.push({ affiliateCampaignId: { in: [...new Set(ids)] } });
  return { OR: or };
}

/** Lit les identifiants de campagnes Link Affi depuis la colonne JSON `Campaign.affiliateCampaignIds` de nos campagnes. */
export function collectAffiliateCampaignIds(campaigns: ReadonlyArray<{ affiliateCampaignIds: unknown }>): string[] {
  const out = new Set<string>();
  for (const c of campaigns) {
    if (!Array.isArray(c.affiliateCampaignIds)) continue;
    for (const id of c.affiliateCampaignIds) if (typeof id === "string" && id) out.add(id);
  }
  return [...out];
}

/** Vrai si le joueur est « à nous » (même règle, côté mémoire). */
export function isOurPlayer(p: { clickId: string | null; affiliateCampaignId: string | null }, ids: ReadonlySet<string>): boolean {
  return !!p.clickId || (!!p.affiliateCampaignId && ids.has(p.affiliateCampaignId));
}

/** Variation de NGR entre deux instantanés Link Affi : un événement daté, jamais un cumul. */
export function ngrDeltaEvent(previousNgr: number, nextNgr: number, at: Date | null, now: Date): { amount: number; occurredAt: Date } | null {
  const delta = Math.round((nextNgr - previousNgr) * 100) / 100;
  if (delta === 0) return null;
  return { amount: delta, occurredAt: at ?? now };
}

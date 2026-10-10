/**
 * Coûts d'une campagne (`AdCost`) et priorité de l'API (règles partagées par le rattachement d'une campagne pub et la
 * saisie manuelle ; même règle côté worker dans `apps/worker/src/ads/apply.ts`).
 *
 * Pour un même jour d'une même campagne, les coûts de l'API (Meta / TikTok connectés) font foi : les lignes CSV et
 * saisies de ce jour sont retirées quand l'API le couvre, sinon la dépense serait comptée deux fois.
 */

/** Sources remplacées par l'API pour un jour qu'elle couvre. */
export const API_OVERRIDDEN_SOURCES = ["CSV", "MANUAL"] as const;

/**
 * Tous les niveaux de coûts d'une campagne : la campagne, ses groupes et ses pubs (une saisie au niveau d'une pub n'a
 * pas toujours `campaignId`). Même périmètre que les totaux de la page Campagnes (`lib/campaigns/queries.ts`).
 */
export function campaignCostScope(campaignId: string) {
  return [{ campaignId }, { adSet: { campaignId } }, { ad: { adSet: { campaignId } } }];
}

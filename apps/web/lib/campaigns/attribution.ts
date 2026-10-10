/**
 * Rattachement des membres, des clics et des joueurs à une campagne.
 *
 * Les règles vivent dans `@linkaffipro/core` (`campaign-attribution.ts`) pour être partagées avec le worker
 * (statistiques journalières, alertes) : ce module les réexporte sous les mêmes noms pour le site.
 * Résumé : un joueur appartient à la campagne si son clic vient d'un de ses liens, si son membre est arrivé par un de
 * ses liens d'entrée, ou si son offre Link Affi fait partie des offres de la campagne et qu'il n'a aucun clic ou que son
 * clic vient d'un lien sans campagne (ancien bouton Offre) : même règle que les clics d'offre.
 */
export {
  attributePlayers,
  campaignBroadcastWhere,
  campaignMemberWhere,
  campaignOfferClickWhere,
  campaignPlayerWhere,
  campaignPostWhere,
  isCampaignPlayer,
  jsonIds,
  scopeFromCampaign,
} from "@linkaffipro/core";
export type { CampaignScope, PlayerLike } from "@linkaffipro/core";

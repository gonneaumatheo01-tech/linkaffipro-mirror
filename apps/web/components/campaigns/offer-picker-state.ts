/**
 * État affiché par le choix du bouton « Offre » (règle pure, testée) : quelle option est sélectionnée, faut-il
 * proposer l'ancien lien direct (bouton d'avant la phase 8), faut-il avertir que l'offre n'est plus dans la campagne.
 */
import type { CampaignOptionWithOffers } from "@/lib/campaigns/queries";

export type OfferPickerValue = { campaignId?: string; affiliateCampaignId?: string };
export type AffiliateOption = { id: string; name: string; programName: string };

export type OfferPickerState = {
  /** Valeur du premier menu : `camp:<id>`, `aff:<id>` (ancien bouton) ou "" (rien de choisi). */
  current: string;
  /** Campagne choisie, si elle existe encore et a des offres. */
  selected: CampaignOptionWithOffers | null;
  /** Ancien bouton sans campagne : son offre, affichée seule dans le groupe « Sans campagne ». */
  legacy: AffiliateOption | null;
  /** Campagne enregistrée sur le bouton mais supprimée ou sans offre aujourd'hui. */
  missingCampaign: boolean;
  /** Afficher le second menu (choix de l'offre de la campagne). */
  showOfferSelect: boolean;
  /** Avertissement à afficher sous le menu (null si tout va bien). */
  warning: string | null;
};

export function offerPickerState(
  value: OfferPickerValue,
  campaigns: CampaignOptionWithOffers[],
  affiliateCampaigns: AffiliateOption[],
): OfferPickerState {
  const withOffers = campaigns.filter((c) => c.offers.length > 0);
  if (value.campaignId) {
    const selected = withOffers.find((c) => c.id === value.campaignId) ?? null;
    if (!selected)
      return {
        current: `camp:${value.campaignId}`,
        selected: null,
        legacy: null,
        missingCampaign: true,
        showOfferSelect: false,
        warning:
          "La campagne de ce bouton a été supprimée ou n'a plus d'offre : choisissez une autre campagne.",
      };
    const offerStillThere =
      !!value.affiliateCampaignId &&
      selected.offers.some((o) => o.id === value.affiliateCampaignId);
    return {
      current: `camp:${selected.id}`,
      selected,
      legacy: null,
      missingCampaign: false,
      showOfferSelect: selected.offers.length > 1 || !offerStillThere,
      warning: offerStillThere
        ? null
        : "L'offre de ce bouton n'est plus dans la campagne : choisissez l'offre à utiliser.",
    };
  }
  if (value.affiliateCampaignId) {
    const legacy = affiliateCampaigns.find((a) => a.id === value.affiliateCampaignId) ?? {
      id: value.affiliateCampaignId,
      name: "offre inactive",
      programName: "Link Affi",
    };
    return {
      current: `aff:${legacy.id}`,
      selected: null,
      legacy,
      missingCampaign: false,
      showOfferSelect: false,
      warning: "Ancien bouton sans campagne : choisissez la campagne pour le rattacher.",
    };
  }
  return {
    current: "",
    selected: null,
    legacy: null,
    missingCampaign: false,
    showOfferSelect: false,
    warning: null,
  };
}

/** Nouvelle valeur quand on choisit une option du premier menu. */
export function pickOfferOption(
  option: string,
  value: OfferPickerValue,
  campaigns: CampaignOptionWithOffers[],
): OfferPickerValue | null {
  if (!option) return { campaignId: undefined, affiliateCampaignId: undefined };
  if (option.startsWith("camp:")) {
    const c = campaigns.find((x) => x.id === option.slice(5) && x.offers.length > 0);
    if (!c) return null;
    const keep = c.offers.find((o) => o.id === value.affiliateCampaignId);
    return { campaignId: c.id, affiliateCampaignId: (keep ?? c.offers[0])?.id };
  }
  // `aff:` : seulement la valeur actuelle d'un ancien bouton (aucun nouveau lien direct possible).
  if (option === `aff:${value.affiliateCampaignId}`) return value;
  return null;
}

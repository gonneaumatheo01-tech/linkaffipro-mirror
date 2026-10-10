"use client";

import { cn } from "@/components/ui/cn";
import { NativeSelect } from "@/components/ui/native-select";
import type { CampaignOptionWithOffers } from "@/lib/campaigns/queries";
import { useCampaignOptions } from "./use-campaign-options";
import {
  offerPickerState,
  pickOfferOption,
  type AffiliateOption,
  type OfferPickerValue,
} from "./offer-picker-state";

export type { AffiliateOption, OfferPickerValue };

/**
 * Choix d'un bouton « Offre » : on choisit notre campagne (page Campagnes), qui détermine le lien Link Affi ;
 * si elle a plusieurs offres, un second menu choisit l'offre. Plus aucun lien Link Affi « brut » pour un nouveau
 * bouton : le groupe « Sans campagne » ne montre que l'offre d'un ancien bouton (créé avant les campagnes), pour
 * qu'il reste lisible ; un avertissement invite à le rattacher, ou signale qu'une offre a quitté la campagne.
 * Stockage : `campaignId` (la nôtre) + `affiliateCampaignId` (le lien Link Affi), voir `lib/posts/buttons.ts`.
 */
export function OfferPicker({
  value,
  onChange,
  campaigns: provided,
  affiliateCampaigns,
  label = "Campagne du bouton Offre",
  className,
}: {
  value: OfferPickerValue;
  onChange: (patch: OfferPickerValue) => void;
  /** Nos campagnes avec offres ; si absent, chargées depuis `/campaigns/options`. */
  campaigns?: CampaignOptionWithOffers[] | null;
  /** Campagnes Link Affi actives : sert seulement à nommer l'offre d'un ancien bouton sans campagne. */
  affiliateCampaigns: AffiliateOption[];
  label?: string;
  className?: string;
}) {
  const { campaigns, loading } = useCampaignOptions(provided ?? null);
  const withOffers = campaigns.filter((c) => c.offers.length > 0);
  const state = offerPickerState(value, campaigns, affiliateCampaigns);
  const { selected } = state;

  function pick(v: string) {
    const next = pickOfferOption(v, value, campaigns);
    if (next) onChange(next);
  }

  const offerStillThere =
    !!selected && selected.offers.some((o) => o.id === value.affiliateCampaignId);

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <NativeSelect
        wrapperClassName="w-full"
        aria-label={label}
        value={state.current}
        onChange={(e) => pick(e.target.value)}
      >
        <option value="">{loading ? "Chargement des campagnes…" : "Choisir une campagne"}</option>
        {state.missingCampaign ? (
          <option value={state.current}>Campagne supprimée ou sans offre</option>
        ) : null}
        {withOffers.length ? (
          <optgroup label="Nos campagnes">
            {withOffers.map((c) => (
              <option key={c.id} value={`camp:${c.id}`}>
                {c.name}
                {c.offers.length > 1 ? ` (${c.offers.length} offres)` : ` · ${c.offers[0]!.name}`}
              </option>
            ))}
          </optgroup>
        ) : null}
        {state.legacy ? (
          <optgroup label="Sans campagne (ancien bouton)">
            <option value={`aff:${state.legacy.id}`}>
              {state.legacy.programName} · {state.legacy.name}
            </option>
          </optgroup>
        ) : null}
      </NativeSelect>
      {state.showOfferSelect && selected ? (
        <NativeSelect
          wrapperClassName="w-full"
          aria-label={`${label} : offre`}
          value={offerStillThere ? (value.affiliateCampaignId ?? "") : ""}
          onChange={(e) =>
            onChange({ campaignId: selected.id, affiliateCampaignId: e.target.value || undefined })
          }
        >
          <option value="">Choisir l&apos;offre</option>
          {selected.offers.map((o) => (
            <option key={o.id} value={o.id}>
              {o.programName} · {o.name}
            </option>
          ))}
        </NativeSelect>
      ) : null}
      {state.warning ? (
        <span role="status" className="text-note text-warning">
          {state.warning}
        </span>
      ) : null}
      {!loading && withOffers.length === 0 ? (
        <span className="text-note text-muted-foreground">
          Aucune campagne avec offre : créez-en une (Campagnes → Nouvelle campagne).
        </span>
      ) : null}
    </div>
  );
}

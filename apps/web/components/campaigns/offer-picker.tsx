"use client";

import type { CampaignOptionWithOffers } from "@/lib/campaigns/queries";
import { useCampaignOptions } from "./use-campaign-options";

export type OfferPickerValue = { campaignId?: string; affiliateCampaignId?: string };
export type AffiliateOption = { id: string; name: string; programName: string };

const selectCls = "h-10 rounded-md border bg-background px-2 text-sm md:h-9";

/**
 * Choix d'un bouton « Offre » : on choisit notre campagne (page Campagnes), qui détermine le lien Link Affi ;
 * si elle a plusieurs offres, un second menu choisit l'offre. Les boutons anciens (lien Link Affi sans campagne)
 * restent lisibles et modifiables grâce au groupe « Sans campagne ».
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
  /** Toutes les campagnes Link Affi actives (secours pour les boutons sans campagne). */
  affiliateCampaigns: AffiliateOption[];
  label?: string;
  className?: string;
}) {
  const { campaigns, loading } = useCampaignOptions(provided ?? null);
  const withOffers = campaigns.filter((c) => c.offers.length > 0);
  // Bouton ancien : on retrouve la campagne qui porte déjà cette offre, sinon on affiche l'offre seule.
  const inferred = !value.campaignId && value.affiliateCampaignId ? withOffers.find((c) => c.offers.some((o) => o.id === value.affiliateCampaignId)) : null;
  const campaignId = value.campaignId ?? inferred?.id ?? "";
  const selected = withOffers.find((c) => c.id === campaignId) ?? null;
  const current = campaignId ? `camp:${campaignId}` : value.affiliateCampaignId ? `aff:${value.affiliateCampaignId}` : "";
  const multi = selected && selected.offers.length > 1;

  function pick(v: string) {
    if (!v) return onChange({ campaignId: undefined, affiliateCampaignId: undefined });
    if (v.startsWith("camp:")) {
      const c = withOffers.find((x) => x.id === v.slice(5));
      if (!c) return;
      const keep = c.offers.find((o) => o.id === value.affiliateCampaignId);
      return onChange({ campaignId: c.id, affiliateCampaignId: (keep ?? c.offers[0])?.id });
    }
    onChange({ campaignId: undefined, affiliateCampaignId: v.slice(4) });
  }

  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <select className={selectCls} aria-label={label} value={current} onChange={(e) => pick(e.target.value)}>
        <option value="">{loading ? "Chargement des campagnes…" : "— choisir une campagne —"}</option>
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
        {affiliateCampaigns.length ? (
          <optgroup label="Sans campagne (lien Link Affi direct)">
            {affiliateCampaigns.map((k) => (
              <option key={k.id} value={`aff:${k.id}`}>
                {k.programName} · {k.name}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
      {multi ? (
        <select className={selectCls} aria-label={`${label} : offre`} value={value.affiliateCampaignId ?? ""} onChange={(e) => onChange({ campaignId: selected.id, affiliateCampaignId: e.target.value || undefined })}>
          <option value="">— choisir l&apos;offre —</option>
          {selected.offers.map((o) => (
            <option key={o.id} value={o.id}>
              {o.programName} · {o.name}
            </option>
          ))}
        </select>
      ) : null}
      {!loading && withOffers.length === 0 ? <span className="text-xs text-muted-foreground">Aucune campagne avec offre : créez-en une (menu Campagnes → Nouvelle campagne).</span> : null}
    </div>
  );
}

import { FormSection } from "@/components/admin/form-section";
import { CampaignFigure } from "@/components/campaigns/campaign-figure";
import { DETAIL_METRICS, displayDeltas, isLegacyOffersTab } from "@/lib/campaigns/display";
import type { CampaignMetrics } from "@/lib/campaigns/metrics";
import { LinkSuggestion } from "../../link-suggestion";
import { OffersSection } from "./offers";
import type { TabProps } from "./shared";

/**
 * Vue d'ensemble : tous les chiffres de la période (les 4 principaux sont dans l'en-tête de la fiche), avec la
 * variation quand « Comparer » est coché, puis les offres Link Affi de la campagne (ex-onglet Offres) et la
 * liaison suggérée. L'ancienne adresse `?tab=offers` (retour des actions sur les offres) met les offres en premier.
 */
export async function OverviewTab(
  props: TabProps & {
    metrics: CampaignMetrics;
    previous: CampaignMetrics;
    keep: Record<string, string>;
  },
) {
  const { id, campaign, compare, metrics, previous, sp } = props;
  const deltas = compare ? displayDeltas(metrics, previous) : null;
  const figures = (
    <FormSection
      key="figures"
      title="Tous les chiffres de la période"
      description={
        compare
          ? "Avec la variation par rapport à la période précédente (vert = favorable)."
          : "Cochez « Comparer » pour voir la variation par rapport à la période précédente."
      }
    >
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 rounded-xl border border-border bg-card p-4 sm:grid-cols-3 md:p-5">
        {DETAIL_METRICS.map((x) => (
          <CampaignFigure
            key={x.key}
            label={x.label}
            term={x.term}
            value={x.format(metrics)}
            delta={deltas ? (deltas[x.key] ?? null) : undefined}
            favorable={x.favorable}
            hint={x.hintOf?.(metrics) ?? x.hint}
          />
        ))}
      </dl>
    </FormSection>
  );
  const offers = <OffersSection key="offers" {...props} />;
  const offersFirst = isLegacyOffersTab(sp.tab);
  return (
    <div className="space-y-8">
      <LinkSuggestion
        campaignId={id}
        name={campaign.name}
        linkedIds={campaign.affiliateCampaignIds}
      />
      {offersFirst ? [offers, figures] : [figures, offers]}
    </div>
  );
}

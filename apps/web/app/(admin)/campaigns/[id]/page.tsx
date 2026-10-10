import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { prisma } from "@linkaffipro/db";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { Flash } from "@/components/admin/flash";
import { FormSection } from "@/components/admin/form-section";
import { PageHeader } from "@/components/admin/page-header";
import { PeriodSelect } from "@/components/admin/period-select";
import { SidePanel } from "@/components/admin/side-panel";
import { StatCard } from "@/components/admin/stat-card";
import { StatusPill } from "@/components/admin/status-pill";
import { UniverseDot } from "@/components/admin/universe-dot";
import { Button } from "@/components/ui/button";
import { isImportedShell } from "@/lib/campaigns/ad-link";
import { scopeFromCampaign } from "@/lib/campaigns/attribution";
import { loadCampaignTrends } from "@/lib/campaigns/card-queries";
import { campaignSummary, flatParams, platformShortLabel } from "@/lib/campaigns/cards";
import { displayVariation, HEADER_METRICS, parseCampaignTab } from "@/lib/campaigns/display";
import { computeMetrics } from "@/lib/campaigns/metrics";
import { campaignTotals, listActiveConnections } from "@/lib/campaigns/queries";
import { hasTrend, type CampaignTrend } from "@/lib/campaigns/trend";
import {
  parseCompare,
  periodLabelWithDates,
  periodParams,
  previousPeriod,
  resolvePeriod,
} from "@/lib/periods";
import { requireUser } from "@/lib/session";
import { StatusBadge } from "@/lib/status-badges";
import { deleteCampaignAction, updateCampaignAction } from "../actions";
import { CampaignForm } from "../campaign-form";
import { AdsTab } from "./tabs/ads";
import { ChannelsTab } from "./tabs/channels";
import { LinksTab } from "./tabs/links";
import { MembersTab } from "./tabs/members";
import { MessagesTab } from "./tabs/messages";
import { CampaignTabs } from "./tabs/nav";
import { OverviewTab } from "./tabs/overview";
import { campaignInclude } from "./tabs/shared";

export const metadata: Metadata = { title: "Campagne" };

/** Série de la mini-courbe de chaque carte de l'en-tête. */
const TREND_OF: Record<string, keyof CampaignTrend> = {
  spend: "spend",
  members: "members",
  ftds: "ftds",
  profit: "profit",
};

/**
 * Fiche d'une campagne : en-tête (univers, statut, contexte, « Modifier » dans un volet), période, 4 chiffres de la
 * période avec la variation et la mini-courbe, puis les onglets (`?tab=`) Vue d'ensemble (avec les offres Link
 * Affi), Pubs, Liens, Canaux, Messages, Membres. L'ancien `?tab=offers` ouvre la vue d'ensemble.
 */
export default async function CampaignPage({ params, searchParams }: PageProps<"/campaigns/[id]">) {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  const { id } = await params;
  const sp = await searchParams;
  const tab = parseCampaignTab(sp.tab);
  const period = resolvePeriod(sp);
  const compare = parseCompare(sp.compare);
  const pp = periodParams(period, compare);
  const keep = { ...flatParams(sp), ...pp };
  const campaign = await prisma.campaign.findUnique({ where: { id }, include: campaignInclude });
  if (!campaign) notFound();
  const scope = scopeFromCampaign(campaign);
  const [metrics, previous, trends, editChannels, connections] = await Promise.all([
    campaignTotals(id, scope, period).then(computeMetrics),
    campaignTotals(id, scope, previousPeriod(period)).then(computeMetrics),
    loadCampaignTrends([id], period),
    prisma.channel.findMany({
      where: { isActive: true },
      orderBy: { title: "asc" },
      select: { id: true, title: true },
    }),
    listActiveConnections(),
  ]);
  const trend = trends[id];
  const base = { id, campaign, scope, period, compare, sp, isAdmin };
  const imported = isImportedShell(campaign);
  const platformLabel = platformShortLabel(campaign.adPlatform);
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

  const editPanel = (
    <SidePanel
      size="lg"
      title="Modifier la campagne"
      description={campaign.name}
      trigger={
        <Button variant="outline" className="max-md:h-10">
          <Pencil aria-hidden />
          Modifier
        </Button>
      }
    >
      <div className="space-y-8">
        <CampaignForm
          action={updateCampaignAction}
          values={{
            id,
            name: campaign.name,
            adPlatform: campaign.adPlatform,
            vertical: campaign.vertical,
            status: campaign.status,
            budgetDaily: campaign.budgetDaily === null ? null : Number(campaign.budgetDaily),
            startAt: day(campaign.startAt),
            endAt: day(campaign.endAt),
            notes: campaign.notes,
            channelIds: scope.channelIds,
            connectionId: campaign.connectionId,
            followsAdCampaign: !!campaign.externalCampaignId,
          }}
          channels={editChannels}
          connections={connections}
          submitLabel="Enregistrer"
        />
        {isAdmin ? (
          <FormSection
            title="Supprimer la campagne"
            description="Ses groupes, pubs, dépenses et statistiques sont supprimés. Les liens restent actifs (Campagnes → Tous les liens) ; membres, clics et joueurs sont conservés."
            className="border-t border-border pt-6"
          >
            <form action={deleteCampaignAction}>
              <input type="hidden" name="campaignId" value={id} />
              <ConfirmSubmit
                variant="destructive"
                className="max-md:h-10"
                confirmTitle="Supprimer cette campagne ?"
                confirmLabel="Supprimer définitivement"
                message={`« ${campaign.name} », ses pubs, ses dépenses et ses statistiques seront supprimées. Les liens restent actifs mais ne seront plus rattachés à une campagne.`}
              >
                Supprimer la campagne
              </ConfirmSubmit>
            </form>
          </FormSection>
        ) : null}
      </div>
    </SidePanel>
  );

  return (
    <>
      <PageHeader
        backHref={`/campaigns?${new URLSearchParams(pp).toString()}`}
        backLabel="Campagnes"
        title={campaign.name}
        meta={
          <>
            <UniverseDot universe={campaign.vertical} variant="pill" />
            <StatusBadge kind="campaign" value={campaign.status} />
            {imported ? <StatusPill tone="info">Campagne pub importée</StatusPill> : null}
          </>
        }
        description={campaignSummary({
          platformLabel,
          channels: scope.channelIds.length,
          links: scope.inviteLinkIds.length,
          offers: scope.affiliateCampaignIds.length,
        })}
        secondaryActions={editPanel}
      />
      <Flash ok={sp.ok} error={sp.error} />

      <section aria-label="Chiffres de la période" className="mb-6 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <PeriodSelect
            period={period}
            compare={compare}
            action={`/campaigns/${id}`}
            extra={{ tab: tab === "overview" ? undefined : tab }}
          />
          <p className="self-center text-note text-muted-foreground">
            {periodLabelWithDates(period)}
          </p>
        </div>
        {/* Téléphone : 2 colonnes sans mini-courbe (le chiffre resterait coupé) ; ordinateur : avec la courbe. */}
        {[false, true].map((withTrend) => (
          <div
            key={String(withTrend)}
            className={
              withTrend
                ? "grid grid-cols-2 gap-3 max-sm:hidden lg:grid-cols-4"
                : "grid grid-cols-2 gap-3 sm:hidden"
            }
          >
            {HEADER_METRICS.map((x) => {
              const series = trend?.[TREND_OF[x.key]!];
              return (
                <StatCard
                  key={x.key}
                  label={x.label}
                  term={x.term}
                  value={
                    x.exact ? (
                      <span title={x.exact(metrics)}>{x.format(metrics)}</span>
                    ) : (
                      x.format(metrics)
                    )
                  }
                  delta={displayVariation(metrics[x.key], previous[x.key])}
                  favorable={x.favorable}
                  comparison="vs période précédente"
                  trend={withTrend && hasTrend(series) ? series : undefined}
                />
              );
            })}
          </div>
        ))}
      </section>

      <CampaignTabs id={id} current={tab} keep={keep} />
      {tab === "overview" ? (
        <OverviewTab {...base} metrics={metrics} previous={previous} keep={keep} />
      ) : null}
      {tab === "ads" ? <AdsTab {...base} /> : null}
      {tab === "links" ? <LinksTab {...base} /> : null}
      {tab === "channels" ? <ChannelsTab {...base} /> : null}
      {tab === "messages" ? <MessagesTab {...base} /> : null}
      {tab === "members" ? <MembersTab {...base} /> : null}
    </>
  );
}

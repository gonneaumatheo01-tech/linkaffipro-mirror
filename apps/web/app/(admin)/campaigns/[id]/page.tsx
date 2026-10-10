import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@linkaffipro/db";
import { VERTICAL_LABELS, type Vertical } from "@linkaffipro/core";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { Button } from "@/components/ui/button";
import { isImportedShell, readAdLink } from "@/lib/campaigns/ad-link";
import { scopeFromCampaign } from "@/lib/campaigns/attribution";
import {
  periodLabel,
  periodParams,
  parseCompare,
  previousPeriod,
  resolvePeriod,
} from "@/lib/periods";
import { requireUser } from "@/lib/session";
import { StatusBadge, statusLabel } from "@/lib/status-badges";
import { PLATFORM_LABELS } from "../campaign-form";
import { CampaignTabs, parseTab, TAB_HELP } from "./tabs/nav";
import { campaignInclude } from "./tabs/shared";
import { OverviewTab } from "./tabs/overview";
import { AdsTab } from "./tabs/ads";
import { LinksTab } from "./tabs/links";
import { ChannelsTab } from "./tabs/channels";
import { MessagesTab } from "./tabs/messages";
import { MembersTab } from "./tabs/members";
import { OffersTab } from "./tabs/offers";

export const metadata: Metadata = { title: "Campagne" };

/**
 * Fiche d'une campagne, par onglets (`?tab=`) : vue d'ensemble (indicateurs), pubs (structure TikTok / Meta et coûts),
 * liens d'entrée, canaux, messages, membres, offres Link Affi.
 */
export default async function CampaignPage({ params, searchParams }: PageProps<"/campaigns/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const tab = parseTab(sp.tab);
  const period = resolvePeriod(sp);
  const compare = parseCompare(sp.compare);
  const pp = periodParams(period, compare);
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: campaignInclude,
  });
  if (!campaign) notFound();
  const scope = scopeFromCampaign(campaign);
  const base = { id, campaign, scope, period, compare, sp, isAdmin: user.role === "ADMIN" };
  const adLink = readAdLink(campaign.adExternalIds);
  const imported = isImportedShell(campaign);
  const platform = campaign.adPlatform ? PLATFORM_LABELS[campaign.adPlatform] : null;

  return (
    <>
      <PageHeader
        title={campaign.name}
        description={[
          campaign.vertical ? VERTICAL_LABELS[campaign.vertical as Vertical] : null,
          platform ? `pubs ${platform}` : "sans pub pour l'instant",
          imported
            ? `campagne pub importée de ${platform ?? "la plateforme"}`
            : campaign.externalCampaignId
              ? `suit la campagne pub « ${adLink?.platformName ?? campaign.externalCampaignId} »`
              : null,
          campaign.connection ? `compte ${campaign.connection.name}` : null,
          statusLabel("campaign", campaign.status),
          `${scope.affiliateCampaignIds.length} offre${scope.affiliateCampaignIds.length > 1 ? "s" : ""}`,
          `${scope.channelIds.length} canal${scope.channelIds.length > 1 ? "aux" : ""}`,
          `${scope.inviteLinkIds.length} lien${scope.inviteLinkIds.length > 1 ? "s" : ""} d'entrée`,
        ]
          .filter(Boolean)
          .join(" · ")}
        help={TAB_HELP[tab]}
      >
        <StatusBadge kind="campaign" value={campaign.status} />
        <Button
          variant="outline"
          className="max-md:h-10"
          render={
            <a
              href={`/campaigns/export?${new URLSearchParams({ kind: "costs", campaignId: id, ...pp }).toString()}`}
            />
          }
        >
          Exporter les coûts (CSV)
        </Button>
        <Button variant="outline" className="max-md:h-10" render={<Link href="/campaigns" />}>
          ← Campagnes
        </Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      <CampaignTabs id={id} current={tab} extra={pp} />
      {tab === "overview" ? <OverviewTab {...base} /> : null}
      {tab === "ads" ? <AdsTab {...base} /> : null}
      {tab === "links" ? <LinksTab {...base} /> : null}
      {tab === "channels" ? <ChannelsTab {...base} /> : null}
      {tab === "messages" ? <MessagesTab {...base} /> : null}
      {tab === "members" ? <MembersTab {...base} /> : null}
      {tab === "offers" ? <OffersTab {...base} /> : null}
      {tab === "overview" ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Période : {periodLabel(period)}
          {compare ? ` · comparée à la précédente (${periodLabel(previousPeriod(period))})` : ""}.
          Membres = demandes acceptées via les liens d&apos;entrée ; inscrits, FTD, dépôts et NGR =
          joueurs rattachés par l&apos;identifiant de suivi (sub-ID) ou appartenant à une offre de
          la campagne.
        </p>
      ) : null}
    </>
  );
}

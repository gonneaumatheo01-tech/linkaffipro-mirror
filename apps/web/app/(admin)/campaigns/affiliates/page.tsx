import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown, Download, Handshake, Lightbulb, SearchX, Users } from "lucide-react";
import { DataTable, type DataTableRow } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/empty-state";
import { FilterChips } from "@/components/admin/filter-chips";
import { Flash } from "@/components/admin/flash";
import { PageHeader } from "@/components/admin/page-header";
import { PeriodSelect } from "@/components/admin/period-select";
import { StatCard } from "@/components/admin/stat-card";
import { comparableVariation } from "@/lib/dashboard/display";
import { StatusPill } from "@/components/admin/status-pill";
import {
  AFFILIATE_SETTINGS_HREF,
  AffiliateTutorial,
} from "@/components/affiliates/affiliate-tutorial";
import { CampaignDetail, clicksText } from "@/components/affiliates/campaign-detail";
import { NumCell, STAT_GRID_PHONE } from "@/components/dashboard/cells";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AffiliateFigures } from "@/lib/affiliates/figures";
import { clicksNote } from "@/lib/affiliates/linkaffi-clicks";
import { affiliatesHref, parseAffiliatesFilters } from "@/lib/affiliates/page-params";
import { loadAffiliatesPage } from "@/lib/affiliates/queries";
import { campaignLabel } from "@/lib/affiliates/scope";
import { loadTutorialDismissed, showTutorial } from "@/lib/affiliates/tutorial";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format";
import { parseCompare, periodLabelWithDates, previousPeriod } from "@/lib/periods";
import { requireUser } from "@/lib/session";
import { dismissAffiliatesTutorialAction } from "./actions";

export const metadata: Metadata = { title: "Affiliés Link Affi" };

/** Phrase courte des chiffres d'un affilié, sous son nom. */
function affiliateSummary(f: AffiliateFigures, campaigns: number): string {
  return [
    `${fmtNum(campaigns)} campagne${campaigns > 1 ? "s" : ""}`,
    `${fmtNum(f.present)} présent${f.present > 1 ? "s" : ""}`,
    `${fmtNum(f.ftds)} premier${f.ftds > 1 ? "s" : ""} dépôt${f.ftds > 1 ? "s" : ""}`,
    `${fmtMoney(f.revenue, "EUR", { digits: 0 })} de revenu net`,
  ].join(" · ");
}

/**
 * Affiliés Link Affi (phase 13, D7) : les membres amenés sur nos canaux par les affiliés de Link Affi (campagnes
 * Telegram créées dans Link Affi), par affilié puis par campagne : clics (comptés par Link Affi), demandes, acceptés,
 * présents, partis, clics sur les offres, inscriptions, premiers dépôts (liste), dépôts et revenu net. Période
 * commune (30 jours par défaut, comparaison des totaux), filtres canal et affilié, export CSV. Mini-tutoriel au premier
 * passage. Lecture seule : tout se crée dans Link Affi. ADMIN et MANAGER.
 */
export default async function AffiliatesPage({ searchParams }: PageProps<"/campaigns/affiliates">) {
  const me = await requireUser();
  const sp = await searchParams;
  const now = new Date();
  const f = parseAffiliatesFilters(sp, now);
  const compare = parseCompare(sp.compare);
  const [data, previous, dismissed] = await Promise.all([
    loadAffiliatesPage({ period: f.period, channelId: f.channelId, affiliateId: f.affiliateId }),
    compare
      ? loadAffiliatesPage({
          period: previousPeriod(f.period),
          channelId: f.channelId,
          affiliateId: f.affiliateId,
        })
      : Promise.resolve(null),
    loadTutorialDismissed(me.id),
  ]);
  const periodText = periodLabelWithDates(f.period);
  const tutorial = showTutorial(dismissed, sp.guide);
  const isAdmin = me.role === "ADMIN";
  const exportParams = new URLSearchParams({
    range: f.period.key,
    ...(f.period.key === "custom" ? { from: f.period.from, to: f.period.to } : {}),
    ...(f.channelId ? { channelId: f.channelId } : {}),
    ...(f.affiliateId ? { affiliateId: f.affiliateId } : {}),
  });

  const t = data.totals;
  const p = previous?.totals ?? null;
  const v = (k: keyof AffiliateFigures) =>
    p ? comparableVariation((t[k] as number) ?? 0, (p[k] as number) ?? 0) : undefined;

  const channelChips = [
    {
      key: "all",
      label: "Tous",
      href: affiliatesHref(f, { channelId: "" }),
      selected: !f.channelId,
    },
    ...data.channels.map((c) => ({
      key: c.id,
      label: c.title,
      href: affiliatesHref(f, { channelId: c.id }),
      selected: f.channelId === c.id,
    })),
  ];
  const affiliateChips = [
    {
      key: "all",
      label: "Tous",
      href: affiliatesHref(f, { affiliateId: "" }),
      selected: !f.affiliateId,
    },
    ...data.options.map((a) => ({
      key: a.id,
      label: a.name,
      href: affiliatesHref(f, { affiliateId: a.id }),
      selected: f.affiliateId === a.id,
    })),
  ];

  return (
    <>
      <PageHeader
        title="Affiliés Link Affi"
        backHref="/campaigns"
        backLabel="Campagnes"
        description="Les membres que vos affiliés Link Affi amènent sur vos canaux, et ce qu'ils rapportent."
        secondaryActions={
          <>
            {tutorial ? null : (
              <Link
                href={`${affiliatesHref(f)}${affiliatesHref(f).includes("?") ? "&" : "?"}guide=1`}
                className={cn(buttonVariants({ variant: "ghost" }), "max-md:h-10")}
              >
                <Lightbulb aria-hidden />
                Mode d&apos;emploi
              </Link>
            )}
            {data.campaigns.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="outline" className="max-md:h-10">
                      <Download aria-hidden />
                      Exporter
                      <ChevronDown aria-hidden />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end" className="min-w-64">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Fichier CSV (Excel)</DropdownMenuLabel>
                    <DropdownMenuItem
                      render={
                        <a href={`/campaigns/affiliates/export?${exportParams.toString()}`} />
                      }
                    >
                      <Handshake aria-hidden />
                      Les campagnes et leurs chiffres
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      render={
                        <a
                          href={`/campaigns/affiliates/export?${new URLSearchParams({
                            ...Object.fromEntries(exportParams),
                            kind: "ftds",
                          }).toString()}`}
                        />
                      }
                    >
                      <Download aria-hidden />
                      La liste des premiers dépôts
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        }
      />
      <Flash ok={sp.ok} error={sp.error} />

      {tutorial ? (
        <AffiliateTutorial
          dismissAction={dismissAffiliatesTutorialAction}
          isAdmin={isAdmin}
          dismissed={dismissed}
        />
      ) : null}

      {data.campaigns.length === 0 ? (
        <EmptyState
          icon={<Handshake />}
          title="Aucune campagne d'affilié pour l'instant"
          description="Dans Link Affi, créez une campagne de type Telegram pour un affilié et choisissez un de vos canaux : elle apparaît ici toute seule, avec ses membres et ses premiers dépôts."
          action={
            isAdmin
              ? { href: AFFILIATE_SETTINGS_HREF, label: "Relier Link Affi", variant: "outline" }
              : undefined
          }
        />
      ) : (
        <>
          <div className="mb-5 space-y-3">
            <PeriodSelect
              period={f.period}
              compare={compare}
              action="/campaigns/affiliates"
              extra={{
                channelId: f.channelId || undefined,
                affiliateId: f.affiliateId || undefined,
              }}
            />
            {data.channels.length > 1 || f.channelId ? (
              <FilterChips label="Canal" chips={channelChips} />
            ) : null}
            {data.options.length > 1 || f.affiliateId ? (
              <FilterChips label="Affilié" chips={affiliateChips} />
            ) : null}
          </div>

          <section aria-labelledby="affiliates-totals" className="mb-8 space-y-3">
            <h2 id="affiliates-totals" className="sr-only">
              Total des affiliés affichés
            </h2>
            <div
              className={cn(
                "grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-6",
                STAT_GRID_PHONE,
              )}
            >
              <StatCard
                label="Clics"
                value={clicksText(t.clicks)}
                hint="Comptés par Link Affi, depuis le début"
              />
              <StatCard
                label="Demandes"
                value={fmtNum(t.requests)}
                variation={v("requests")}
                hint={`${fmtNum(t.approved)} accepté${t.approved > 1 ? "s" : ""}`}
              />
              <StatCard
                label="Présents"
                value={fmtNum(t.present)}
                hint={`En ce moment · ${fmtNum(t.left)} parti${t.left > 1 ? "s" : ""} sur la période`}
              />
              <StatCard
                label="Clics sur les offres"
                value={fmtNum(t.offerClicks)}
                variation={v("offerClicks")}
                hint={`${fmtNum(t.registrations)} inscription${t.registrations > 1 ? "s" : ""}`}
              />
              <StatCard
                label="Premiers dépôts"
                term="FTD"
                value={fmtNum(t.ftds)}
                variation={v("ftds")}
                hint={`${fmtMoney(t.depositAmount, "EUR", { digits: 0 })} déposés`}
              />
              <StatCard
                label="Revenu net"
                term="NGR"
                value={fmtMoney(t.revenue, "EUR", { digits: 0 })}
                variation={v("revenue")}
              />
            </div>
            <p className="text-note text-muted-foreground">
              {periodText}. {clicksNote(data.clicks, fmtDate)} Présents : en ce moment, quelle que
              soit la période.
            </p>
          </section>

          {data.affiliates.length === 0 ? (
            <EmptyState
              icon={<SearchX />}
              title="Aucune campagne d'affilié avec ces filtres"
              description="Choisissez un autre canal ou un autre affilié, ou affichez toutes les campagnes."
              action={{
                href: affiliatesHref(f, { channelId: "", affiliateId: "" }),
                label: "Voir toutes les campagnes",
                variant: "outline",
              }}
            />
          ) : (
            <div className="space-y-8">
              {data.affiliates.map((a) => {
                const rows: DataTableRow[] = a.campaigns.map((c) => ({
                  id: c.ref.inviteLinkId,
                  detailTitle: campaignLabel(c.ref),
                  detailDescription: `Campagne de ${a.name} · ${c.ref.channelTitle}`,
                  cells: {
                    campaign: (
                      <span className="flex flex-col items-start gap-0.5">
                        <span>{campaignLabel(c.ref)}</span>
                        <span className="text-note font-normal text-muted-foreground">
                          {c.ref.channelTitle}
                        </span>
                        {c.ref.isActive ? null : <StatusPill tone="muted">Désactivée</StatusPill>}
                      </span>
                    ),
                    clicks: <NumCell value={clicksText(c.figures.clicks)} />,
                    present: <NumCell value={fmtNum(c.figures.present)} />,
                    ftds: <NumCell value={fmtNum(c.figures.ftds)} />,
                    revenue: <NumCell value={fmtMoney(c.figures.revenue, "EUR", { digits: 0 })} />,
                  },
                  sortValues: {
                    campaign: campaignLabel(c.ref),
                    clicks: c.figures.clicks,
                    present: c.figures.present,
                    ftds: c.figures.ftds,
                    revenue: c.figures.revenue,
                  },
                  detail: (
                    <CampaignDetail
                      campaign={c}
                      affiliateName={a.name}
                      periodText={periodText}
                      now={now}
                    />
                  ),
                }));
                const headingId = `affiliate-${a.id || "inconnu"}`.replace(/[^A-Za-z0-9_-]/g, "-");
                return (
                  <section
                    key={a.id || "inconnu"}
                    aria-labelledby={headingId}
                    className="space-y-3"
                  >
                    <div className="flex flex-wrap items-end justify-between gap-2">
                      <div className="min-w-0">
                        <h2 id={headingId} className="text-title text-foreground">
                          {a.name}
                        </h2>
                        <p className="text-note text-muted-foreground">
                          {affiliateSummary(a.figures, a.campaigns.length)}
                        </p>
                      </div>
                      {a.id ? (
                        <Link
                          href={`/members?${new URLSearchParams({ affiliateId: a.id }).toString()}`}
                          className={cn(
                            buttonVariants({ variant: "ghost", size: "sm" }),
                            "max-md:h-10",
                          )}
                        >
                          <Users aria-hidden />
                          Ses membres
                        </Link>
                      ) : null}
                    </div>
                    <DataTable
                      label={`Campagnes de ${a.name}`}
                      panelSize="md"
                      columns={[
                        {
                          key: "campaign",
                          header: "Campagne",
                          className: "whitespace-normal md:min-w-48",
                        },
                        { key: "clicks", header: "Clics", align: "right", hideOnMobile: true },
                        { key: "present", header: "Présents", align: "right" },
                        { key: "ftds", header: "Premiers dépôts", term: "FTD", align: "right" },
                        {
                          key: "revenue",
                          header: "Revenu net",
                          term: "NGR",
                          align: "right",
                          hideOnMobile: true,
                        },
                      ]}
                      rows={rows}
                    />
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  ChevronDown,
  Download,
  FileClock,
  FileUp,
  Link2,
  Megaphone,
  Plus,
  SearchX,
} from "lucide-react";
import { AdvancedSection } from "@/components/admin/form-section";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/empty-state";
import { Flash } from "@/components/admin/flash";
import { Term } from "@/components/admin/help-tip";
import { PageHeader } from "@/components/admin/page-header";
import { PeriodSelect } from "@/components/admin/period-select";
import { RememberFilters } from "@/components/admin/remember-filters";
import { CampaignCard } from "@/components/campaigns/campaign-card";
import { FigureDelta } from "@/components/campaigns/campaign-figure";
import { FilterChips } from "@/components/admin/filter-chips";
import { buttonVariants, Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { loadCampaignTrends, totalForCampaigns } from "@/lib/campaigns/card-queries";
import {
  campaignsHref,
  compactMoney,
  exactMoney,
  filterCampaigns,
  filterCounts,
  flatParams,
  groupMoney,
  groupMoneyDigits,
  hasCampaignFilters,
  noMatchTitle,
  parseCampaignFilters,
  platformShortLabel,
  gainsTone,
  sortByStatus,
  splitImportedShells,
  STATUS_FILTER_OPTIONS,
  sumSpend,
  UNIVERSE_FILTER_OPTIONS,
} from "@/lib/campaigns/cards";
import type { CampaignMetrics } from "@/lib/campaigns/metrics";
import { listCampaigns } from "@/lib/campaigns/queries";
import { fmtNum } from "@/lib/format";
import { CAMPAIGNS_TOTAL_NOTE, campaignVariations } from "@/lib/campaigns/display";
import { parseCompare, periodLabelWithDates, periodParams, resolvePeriod } from "@/lib/periods";
import { requireUser } from "@/lib/session";
import { statusLabel } from "@/lib/status-badges";
import { universeClasses } from "@/lib/universe";

export const metadata: Metadata = { title: "Campagnes" };

/**
 * Ligne de total discrète : chaque joueur, clic et membre n'est compté qu'une fois. Ses montants ont la précision des
 * cartes (`digits`), le montant exact au survol.
 */
function TotalLine({
  label,
  periodText,
  total,
  previous,
  digits,
}: {
  label: string;
  periodText: string;
  total: CampaignMetrics;
  previous: CampaignMetrics | null;
  digits: 0 | 2;
}) {
  const v = previous ? campaignVariations(total, previous) : null;
  // Période d'avant en perte : pas de pourcentage, la valeur d'avant à la place (même règle que les Statistiques).
  const d = (k: keyof CampaignMetrics, favorable: "up" | "down" = "up", before?: string) =>
    v ? (
      <FigureDelta variation={v[k] ?? { kind: "unknown" }} favorable={favorable} before={before} />
    ) : null;
  const tone = gainsTone(total.gains);
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-note text-muted-foreground">
      <span>
        <span className="font-medium text-foreground">{label}</span> · {periodText}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="font-medium text-foreground tabular-nums" title={exactMoney(total.spend)}>
          {groupMoney(total.spend, digits)}
        </span>
        dépensés {d("spend", "down")}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="font-medium text-foreground tabular-nums">{fmtNum(total.members)}</span>
        membres {d("members")}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="font-medium text-foreground tabular-nums">{fmtNum(total.ftds)}</span>
        <Term term="FTD">premiers dépôts</Term> {d("ftds")}
      </span>
      <span className="inline-flex items-center gap-1.5">
        gains
        <span
          title={`Commissions ${exactMoney(total.commissions)} − dépense pub ${exactMoney(total.spend)}`}
          className={cn(
            "font-medium tabular-nums",
            tone === "positive" && "text-success",
            tone === "negative" && "text-danger",
            tone === "neutral" && "text-foreground",
          )}
        >
          {groupMoney(total.gains, digits)}
        </span>
        {d("gains", "up", previous ? groupMoney(previous.gains, digits) : undefined)}
      </span>
      <span>{CAMPAIGNS_TOTAL_NOTE}</span>
    </p>
  );
}

/**
 * Campagnes : une carte par campagne (univers, statut, dépensé, membres, premiers dépôts, gains, mini-courbe),
 * filtres par univers et par statut, période commune, ligne de total sans double compte, et en bas, repliées, les
 * campagnes pub importées d'un compte connecté qui attendent d'être rattachées.
 */
export default async function CampaignsPage({ searchParams }: PageProps<"/campaigns">) {
  await requireUser();
  const sp = await searchParams;
  const period = resolvePeriod(sp);
  const compare = parseCompare(sp.compare);
  const pp = periodParams(period, compare);
  const filters = parseCampaignFilters(sp);
  const filtered = hasCampaignFilters(filters);
  const keep = { ...flatParams(sp), ...pp };

  const list = await listCampaigns(period, compare);
  const { campaigns, shells } = splitImportedShells(list.rows);
  const shown = sortByStatus(filterCampaigns(campaigns, filters));
  const counts = filterCounts(campaigns, filters);
  // Total des cartes affichées : celui de la liste quand elles y sont toutes, sinon recalculé sur elles seules.
  const sameAsList = !filtered && shells.length === 0;
  const [trends, subset] = await Promise.all([
    loadCampaignTrends(
      shown.map((c) => c.id),
      period,
    ),
    shown.length && !sameAsList
      ? totalForCampaigns(
          shown.map((c) => c.id),
          period,
          compare,
        )
      : Promise.resolve(null),
  ]);
  const total = subset ? subset.total : list.total;
  const previousTotal = subset ? subset.previousTotal : list.previousTotal;
  const shellDigits = groupMoneyDigits(shells.map((s) => s.metrics.spend));
  // Une seule précision pour tous les montants de la grille et de sa ligne de total.
  const moneyDigits = groupMoneyDigits([
    ...shown.flatMap((c) => [c.metrics.spend, c.metrics.gains]),
    total.spend,
    total.gains,
  ]);

  const periodQs = new URLSearchParams(pp).toString();
  const exportHref = `/campaigns/export?${periodQs}`;
  const filterParams = {
    vertical: filters.vertical || undefined,
    status: filters.status || undefined,
  };
  const universeChips = UNIVERSE_FILTER_OPTIONS.map((o) => ({
    key: o.value || "all",
    label: o.label,
    href: campaignsHref(keep, { vertical: o.value }),
    count: counts.vertical[o.value],
    selected: filters.vertical === o.value,
    // Point décoratif seulement : le libellé visible de la pastille nomme déjà l'univers.
    icon:
      o.value && o.value !== "none" ? (
        <span
          aria-hidden
          className={cn("size-2 shrink-0 rounded-full", universeClasses(o.value).dot)}
        />
      ) : undefined,
  }));
  const statusChips = STATUS_FILTER_OPTIONS.map((o) => ({
    key: o.value || "all",
    label: o.label,
    href: campaignsHref(keep, { status: o.value }),
    count: counts.status[o.value],
    selected: filters.status === o.value,
  }));

  return (
    <>
      <PageHeader
        title="Campagnes"
        description="Ce que vous promouvez, où, et ce que ça rapporte."
        primaryAction={{
          label: "Nouvelle campagne",
          href: "/campaigns/new",
          icon: <Plus aria-hidden />,
        }}
        secondaryActions={
          <>
            {/* Téléphone : « Tous les liens » passe dans « Plus », pour que « Plus » et le bouton orange tiennent
                sur une ligne. */}
            <Link
              href="/campaigns/links"
              className={cn(buttonVariants({ variant: "outline" }), "max-md:hidden")}
            >
              <Link2 aria-hidden />
              Tous les liens
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" className="max-md:h-10">
                    Plus
                    <ChevronDown aria-hidden />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="md:hidden" render={<Link href="/campaigns/links" />}>
                  <Link2 aria-hidden />
                  Tous les liens
                </DropdownMenuItem>
                <DropdownMenuSeparator className="md:hidden" />
                <DropdownMenuItem render={<Link href="/campaigns/import" />}>
                  <FileUp aria-hidden />
                  Importer des dépenses (CSV)
                </DropdownMenuItem>
                <DropdownMenuItem render={<Link href="/campaigns/imports" />}>
                  <FileClock aria-hidden />
                  Historique des imports
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem render={<a href={exportHref} />}>
                  <Download aria-hidden />
                  Exporter en CSV{compare ? " (avec comparaison)" : ""}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <Flash ok={sp.ok} error={sp.error} />

      {campaigns.length === 0 ? (
        <EmptyState
          icon={<Megaphone />}
          title="Créez votre première campagne"
          description="L'assistant vous guide en 4 étapes : nom et univers, offres, canaux, pubs. Chaque pub reçoit son lien d'entrée."
          action={{ href: "/campaigns/new", label: "Nouvelle campagne" }}
        >
          <Link
            href="/campaigns/import"
            className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
          >
            Importer des dépenses (CSV)
          </Link>
        </EmptyState>
      ) : (
        <>
          <div className="mb-5 space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <PeriodSelect
                period={period}
                compare={compare}
                action="/campaigns"
                extra={filterParams}
              />
              <Suspense fallback={null}>
                {/* Sur téléphone, aligné sur la marge de la page (retrait du bouton discret). */}
                <RememberFilters storageKey="campaigns" className="max-md:-ml-3 max-md:h-10" />
              </Suspense>
            </div>
            <div className="space-y-2">
              <FilterChips label="Univers" chips={universeChips} />
              <FilterChips label="Statut" chips={statusChips} />
            </div>
          </div>

          {shown.length === 0 ? (
            <EmptyState
              icon={<SearchX />}
              title={noMatchTitle(filters)}
              description="Choisissez un autre filtre, ou affichez toutes vos campagnes."
              action={{
                href: campaignsHref(keep, { vertical: "", status: "" }),
                label: "Voir toutes les campagnes",
                variant: "outline",
              }}
            />
          ) : (
            <section aria-label="Vos campagnes" className="space-y-3">
              <TotalLine
                label={
                  shown.length > 1 ? `Total des ${shown.length} campagnes` : "Total de la campagne"
                }
                periodText={periodLabelWithDates(period)}
                total={total}
                previous={compare ? previousTotal : null}
                digits={moneyDigits}
              />
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {shown.map((r) => (
                  <CampaignCard
                    key={r.id}
                    row={r}
                    href={`/campaigns/${r.id}${periodQs ? `?${periodQs}` : ""}`}
                    platformLabel={platformShortLabel(r.adPlatform)}
                    compare={compare}
                    membersTrend={trends[r.id]?.members}
                    moneyDigits={moneyDigits}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {shells.length ? (
        <AdvancedSection
          className="mt-8"
          title={`Campagnes pub à rattacher (${shells.length})`}
          description={`Reçues d'un compte Meta ou TikTok connecté · ${compactMoney(sumSpend(shells))} dépensés sur la période, hors du total ci-dessus.`}
        >
          <p className="text-body text-muted-foreground">
            Ouvrez une de vos campagnes, onglet Pubs, puis « Rattacher une campagne pub importée » :
            ses groupes, ses pubs et ses dépenses la rejoignent, et les prochaines dépenses y
            arrivent toutes seules.
          </p>
          <DataTable
            label="Campagnes pub à rattacher"
            columns={[
              { key: "name", header: "Campagne pub", className: "min-w-40 whitespace-normal" },
              { key: "platform", header: "Plateforme", hideOnMobile: true },
              { key: "spend", header: "Dépensé", align: "right" },
            ]}
            rows={shells.map((s) => ({
              id: s.id,
              href: `/campaigns/${s.id}?${new URLSearchParams({ ...pp, tab: "ads" }).toString()}`,
              cells: {
                name: s.name,
                platform: s.importedFrom ? statusLabel("adPlatform", s.importedFrom) : "—",
                spend: groupMoney(s.metrics.spend, shellDigits),
              },
              sortValues: { spend: s.metrics.spend },
            }))}
          />
        </AdvancedSection>
      ) : null}
    </>
  );
}

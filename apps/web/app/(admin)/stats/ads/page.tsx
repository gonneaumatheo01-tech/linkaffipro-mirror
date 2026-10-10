import type { Metadata } from "next";
import Link from "next/link";
import { Download, RefreshCw } from "lucide-react";
import { DataTable, type DataTableRow } from "@/components/admin/data-table";
import { Term } from "@/components/admin/help-tip";
import { SidePanel } from "@/components/admin/side-panel";
import { StatCard } from "@/components/admin/stat-card";
import { UniverseDot } from "@/components/admin/universe-dot";
import { MetricChart, type ChartMetric } from "@/components/charts/metric-chart";
import { NumCell, STAT_GRID_PHONE } from "@/components/dashboard/cells";
import { MetricDetail, type DetailFigure } from "@/components/dashboard/metric-detail";
import { StatsTop } from "@/components/dashboard/stats-top";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { loadAdsTable } from "@/lib/dashboard/daily";
import {
  ADS_COLUMNS,
  DETAIL_ORDER,
  METRIC_VIEWS,
  adsDefaultSort,
  comparableDelta,
  costPerMemberNote,
  dayLabels,
  fmtMetric,
  fmtMetricExact,
  fmtTimes,
  metricValue,
  moneyColumn,
  profitNote,
  type MetricKey,
} from "@/lib/dashboard/display";
import { round2, type Derived, type StatTotals } from "@/lib/dashboard/metrics";
import { loadStatsOptions } from "@/lib/dashboard/stats-options";
import { parseStatsFilters, statsHref, statsParams } from "@/lib/dashboard/stats-pages";
import { fmtDate, fmtNum } from "@/lib/format";
import { periodLabel } from "@/lib/periods";
import { requireUser } from "@/lib/session";
import { statusLabel } from "@/lib/status-badges";
import { recomputeStatsAction } from "../../dashboard/actions";

export const metadata: Metadata = { title: "Statistiques · Pubs" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Les six chiffres clés de la page, en cartes (total de toutes les campagnes affichées). */
const KEY_FIGURES: MetricKey[] = ["spend", "joined", "ftds", "ngr", "roas", "profit"];

/** Chiffres du graphique jour par jour (le retour sur dépense pub d'un seul jour ne veut rien dire : absent). */
const CHART_FIGURES: Array<{ key: MetricKey; pick: (d: StatTotals) => number }> = [
  { key: "spend", pick: (d) => d.spend },
  { key: "joined", pick: (d) => d.joined },
  { key: "ftds", pick: (d) => d.ftds },
  { key: "ngr", pick: (d) => d.ngr },
  { key: "profit", pick: (d) => round2(d.ngr - d.spend) },
];

/**
 * Tous les chiffres d'une ligne (volet de détail), avec la période précédente quand on compare. Pas de pourcentage
 * sur une base négative (bénéfice d'avant en perte) : voir `comparableDelta`.
 */
function figuresOf(
  cur: { totals: StatTotals; derived: Derived },
  prev: { totals: StatTotals; derived: Derived },
  deltas: Partial<Record<MetricKey, number | null>>,
  compare: boolean,
): DetailFigure[] {
  return DETAIL_ORDER.map((k) => {
    const v = METRIC_VIEWS[k];
    const before = metricValue(prev.totals, prev.derived, k);
    return {
      key: k,
      label: v.label,
      term: v.term,
      value: fmtMetricExact(k, metricValue(cur.totals, cur.derived, k)),
      previous: compare ? fmtMetricExact(k, before) : undefined,
      delta: compare ? comparableDelta(deltas[k], before) : undefined,
      favorable: v.favorable,
    };
  });
}

export default async function StatsAdsPage({ searchParams }: PageProps<"/stats/ads">) {
  const sp = await searchParams;
  const f = parseStatsFilters(sp);
  const [options, user, ads] = await Promise.all([
    loadStatsOptions(),
    requireUser(),
    loadAdsTable(f.period, {
      vertical: f.vertical,
      ...(f.campaignId ? { campaignId: f.campaignId } : {}),
    }),
  ]);
  const isAdmin = user.role === "ADMIN";
  // Export : même période et mêmes filtres que le tableau (le canal ne s'applique pas aux campagnes).
  const exportParams = new URLSearchParams(statsParams(f));
  exportParams.delete("channelId");
  const exportHref = `/dashboard/export?${exportParams.toString()}`;
  const multiDay = f.period.days > 1;
  const total = { totals: ads.total, derived: ads.totalDerived };
  const previousTotal = { totals: ads.previousTotal, derived: ads.previousTotalDerived };

  const cards = KEY_FIGURES.map((k) => {
    const v = METRIC_VIEWS[k];
    const value = metricValue(ads.total, ads.totalDerived, k);
    const before = metricValue(ads.previousTotal, ads.previousTotalDerived, k);
    const chart = CHART_FIGURES.find((c) => c.key === k);
    return (
      <StatCard
        key={k}
        label={v.label}
        term={v.term}
        value={k === "roas" ? fmtTimes(value) : fmtMetric(k, value)}
        delta={f.compare ? comparableDelta(ads.totalDeltas[k], before) : undefined}
        favorable={v.favorable}
        hint={f.compare ? `Avant : ${fmtMetric(k, before)}` : undefined}
        trend={multiDay && chart ? ads.daily.map(chart.pick) : undefined}
      />
    );
  });

  const chartMetrics: ChartMetric[] = CHART_FIGURES.map((c) => {
    const v = METRIC_VIEWS[c.key];
    return {
      key: c.key,
      label: v.label,
      format: v.format,
      integer: v.integer,
      values: ads.daily.map(c.pick),
      previous: f.compare ? ads.previousDaily.map(c.pick) : null,
    };
  });

  // Une seule précision pour la colonne « Dépense pub » (« 418 € » … « 0 € »).
  const spendMoney = moneyColumn(ads.rows.map((r) => r.totals.spend));
  const rows: DataTableRow[] = ads.rows.map((r) => {
    const d = (k: MetricKey) =>
      f.compare
        ? comparableDelta(r.deltas[k], metricValue(r.previous, r.previousDerived, k))
        : undefined;
    const sub = [
      r.platform ? statusLabel("adPlatform", r.platform) : null,
      r.status ? statusLabel("campaign", r.status) : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      id: r.campaignId,
      detailTitle: r.name,
      detailDescription: periodLabel(f.period),
      cells: {
        name: (
          <span className="flex min-w-0 items-start gap-2 py-1">
            <UniverseDot universe={r.vertical} className="mt-1.5" />
            <span className="min-w-0">
              <span className="block">{r.name}</span>
              {sub ? (
                <span className="block text-note font-normal text-muted-foreground">{sub}</span>
              ) : null}
            </span>
          </span>
        ),
        spend: <NumCell value={spendMoney(r.totals.spend)} delta={d("spend")} favorable="down" />,
        joined: (
          <NumCell
            value={fmtNum(r.totals.joined)}
            note={costPerMemberNote(r.derived)}
            delta={d("joined")}
          />
        ),
        ftds: <NumCell value={fmtNum(r.totals.ftds)} delta={d("ftds")} />,
        roas: (
          <NumCell
            value={fmtTimes(r.derived.roas)}
            note={profitNote(r.derived.profit)}
            delta={d("roas")}
          />
        ),
      },
      sortValues: {
        name: r.name,
        spend: r.totals.spend,
        joined: r.totals.joined,
        ftds: r.totals.ftds,
        roas: r.derived.roas,
      },
      detail: (
        <div className="space-y-4">
          <MetricDetail
            figures={figuresOf(
              r,
              { totals: r.previous, derived: r.previousDerived },
              r.deltas,
              f.compare,
            )}
            compare={f.compare}
          />
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/campaigns/${r.campaignId}`}
              className={buttonVariants({ variant: "outline" })}
            >
              Ouvrir la campagne
            </Link>
            <Link
              href={statsHref("/stats/funnel", { ...f, campaignId: r.campaignId })}
              className={buttonVariants({ variant: "ghost" })}
            >
              Son parcours
            </Link>
          </div>
        </div>
      ),
    };
  });

  return (
    <>
      <StatsTop
        page="ads"
        filters={f}
        options={options}
        sp={sp}
        showChannel={false}
        primaryAction={
          <a
            href={exportHref}
            download
            title={
              f.compare
                ? "Fichier CSV (Excel) : toutes les colonnes, avec la période précédente et la variation"
                : "Fichier CSV (Excel) : toutes les colonnes du tableau"
            }
            className={cn(buttonVariants(), "max-md:h-10")}
          >
            <Download aria-hidden />
            Exporter
          </a>
        }
        secondaryActions={
          isAdmin ? (
            <form action={recomputeStatsAction}>
              {Object.entries(statsParams(f)).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              <Button type="submit" variant="outline" className="max-md:h-10">
                <RefreshCw aria-hidden />
                Recalculer les statistiques
              </Button>
            </form>
          ) : null
        }
        note={
          <>
            Chiffres calculés {ads.lastComputedAt ? `le ${fmtDate(ads.lastComputedAt)}` : "jamais"}{" "}
            : ils se mettent à jour toutes les heures.
          </>
        }
      />

      <section aria-label="Chiffres clés de la période" className="mb-8">
        <div className={cn("grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-3", STAT_GRID_PHONE)}>
          {cards}
        </div>
      </section>

      <section
        aria-labelledby="ads-daily"
        className="mb-8 rounded-xl border border-border bg-card p-4 md:p-5"
      >
        <div className="mb-3">
          <h2 id="ads-daily" className="text-title text-foreground">
            Jour par jour
          </h2>
          <p className="text-body text-muted-foreground">
            {f.compare
              ? "La période choisie en orange, la précédente en gris, pour toutes les campagnes affichées."
              : "Pour toutes les campagnes affichées. Survolez la courbe pour lire chaque jour."}
          </p>
        </div>
        {multiDay ? (
          <MetricChart
            metrics={chartMetrics}
            labels={dayLabels(ads.keys.current)}
            previousLabels={f.compare ? dayLabels(ads.keys.previous) : undefined}
            period={periodLabel(f.period)}
            defaultKey="spend"
          />
        ) : (
          <p className="text-body text-muted-foreground">
            Choisissez une période de plusieurs jours pour voir l&apos;évolution jour par jour.
          </p>
        )}
      </section>

      <section aria-labelledby="ads-campaigns">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="ads-campaigns" className="text-title text-foreground">
              Par campagne
            </h2>
            <p className="text-body text-muted-foreground">
              Cliquez sur une campagne pour voir tous ses chiffres.
            </p>
          </div>
          {ads.rows.length > 0 ? (
            <SidePanel
              title="Total de toutes les campagnes"
              description={periodLabel(f.period)}
              trigger={
                <Button variant="outline" size="sm">
                  Détail du total
                </Button>
              }
            >
              <MetricDetail
                figures={figuresOf(total, previousTotal, ads.totalDeltas, f.compare)}
                compare={f.compare}
              />
              <p className="mt-4 text-note text-muted-foreground">
                Chaque joueur n&apos;y compte qu&apos;une fois, même quand deux campagnes partagent
                une offre.
              </p>
            </SidePanel>
          ) : null}
        </div>
        <DataTable
          label="Chiffres par campagne"
          defaultSort={adsDefaultSort(one(sp.sort), one(sp.dir))}
          columns={ADS_COLUMNS.map((c) => ({ ...c }))}
          rows={rows}
          empty={{
            title: "Aucune campagne sur cette période",
            description:
              "Créez une campagne (offre Link Affi, canaux et pubs) : ses coûts et ses résultats apparaîtront ici, jour par jour.",
            action: { href: "/campaigns/new", label: "Nouvelle campagne", variant: "outline" },
          }}
        />
        <p className="mt-3 text-note text-muted-foreground">
          <Term term="CPL">Coût par membre</Term> = dépense pub ÷ membres entrés ;{" "}
          <Term term="ROAS">retour sur dépense pub</Term> = revenu net ÷ dépense pub (au-dessus de
          1, les pubs rapportent plus qu&apos;elles ne coûtent). Les dépenses viennent des comptes
          publicitaires connectés, des imports et des saisies (onglet Pubs d&apos;une campagne).
        </p>
      </section>
    </>
  );
}

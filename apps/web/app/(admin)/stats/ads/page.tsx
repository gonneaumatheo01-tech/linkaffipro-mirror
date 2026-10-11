import type { Metadata } from "next";
import Link from "next/link";
import { Download, RefreshCw } from "lucide-react";
import { DataTable, type DataTableRow } from "@/components/admin/data-table";
import { FormSection } from "@/components/admin/form-section";
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
  beforeHint,
  comparableVariation,
  costPerMemberNote,
  dayLabels,
  fmtMetricExact,
  fmtTimes,
  metricGroupFormatter,
  metricValue,
  moneyColumn,
  gainsNote,
  type MetricKey,
} from "@/lib/dashboard/display";
import { gainsOf } from "@linkaffipro/core";
import type { Derived, StatTotals } from "@/lib/dashboard/metrics";
import { loadStatsOptions } from "@/lib/dashboard/stats-options";
import { parseStatsFilters, statsHref, statsParams } from "@/lib/dashboard/stats-pages";
import { fmtDate, fmtNum } from "@/lib/format";
import { periodLabel } from "@/lib/periods";
import { requireUser } from "@/lib/session";
import { statusLabel } from "@/lib/status-badges";
import { recomputeStatsAction } from "../../dashboard/actions";

export const metadata: Metadata = { title: "Statistiques · Pubs" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Les six chiffres clés de la page, en cartes (total de toutes les campagnes affichées) : gains = commissions − dépense
 * pub, retour sur dépense pub = commissions ÷ dépense. Le revenu net (volume du casino) reste dans le graphique et dans
 * « Détail du total ».
 */
const KEY_FIGURES: MetricKey[] = ["spend", "joined", "ftds", "commissions", "roas", "gains"];

/** Chiffres du graphique jour par jour (le retour sur dépense pub d'un seul jour ne veut rien dire : absent). */
const CHART_FIGURES: Array<{ key: MetricKey; pick: (d: StatTotals) => number }> = [
  { key: "spend", pick: (d) => d.spend },
  { key: "joined", pick: (d) => d.joined },
  { key: "ftds", pick: (d) => d.ftds },
  { key: "commissions", pick: (d) => d.commissions },
  { key: "gains", pick: (d) => gainsOf(d.commissions, d.spend) },
  { key: "ngr", pick: (d) => d.ngr },
];

/**
 * Tous les chiffres d'une ligne (volet de détail), avec la période précédente quand on compare. Pas de pourcentage
 * sur une base négative (gains d'avant en perte), « nouveau » quand la période d'avant valait 0 : voir
 * `comparableVariation`.
 */
function figuresOf(
  cur: { totals: StatTotals; derived: Derived },
  prev: { totals: StatTotals; derived: Derived },
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
      variation: compare
        ? comparableVariation(metricValue(cur.totals, cur.derived, k), before)
        : undefined,
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

  // Une seule précision pour les montants des cartes (dépense, commissions, gains, et la période d'avant quand on
  // compare) : « 0,26 € » ne côtoie pas « 214 € ». Le montant exact reste au survol et dans « Détail du total ».
  const fmt = metricGroupFormatter(
    KEY_FIGURES.flatMap((k) => [
      { key: k, value: metricValue(ads.total, ads.totalDerived, k) },
      ...(f.compare
        ? [{ key: k, value: metricValue(ads.previousTotal, ads.previousTotalDerived, k) }]
        : []),
    ]),
  );
  const cards = KEY_FIGURES.map((k) => {
    const v = METRIC_VIEWS[k];
    const value = metricValue(ads.total, ads.totalDerived, k);
    const before = metricValue(ads.previousTotal, ads.previousTotalDerived, k);
    const chart = CHART_FIGURES.find((c) => c.key === k);
    const variation = f.compare ? comparableVariation(value, before) : undefined;
    return (
      <StatCard
        key={k}
        label={v.label}
        term={v.term}
        value={
          k === "roas" ? (
            fmtTimes(value)
          ) : v.format === "money" ? (
            <span title={fmtMetricExact(k, value)}>{fmt(k, value)}</span>
          ) : (
            fmt(k, value)
          )
        }
        variation={variation}
        favorable={v.favorable}
        // « Avant : X » sauf avec « nouveau » (« rien la période précédente » le dit déjà).
        hint={beforeHint(variation, k === "roas" ? fmtTimes(before) : fmt(k, before)) ?? undefined}
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
        ? comparableVariation(
            metricValue(r.totals, r.derived, k),
            metricValue(r.previous, r.previousDerived, k),
          )
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
        spend: (
          <NumCell value={spendMoney(r.totals.spend)} variation={d("spend")} favorable="down" />
        ),
        joined: (
          <NumCell
            value={fmtNum(r.totals.joined)}
            note={costPerMemberNote(r.derived)}
            variation={d("joined")}
          />
        ),
        ftds: <NumCell value={fmtNum(r.totals.ftds)} variation={d("ftds")} />,
        // Le rapport, sa variation juste dessous, puis les gains ou la perte (la variation ne se lit pas comme celle
        // des gains).
        roas: (
          <NumCell
            value={fmtTimes(r.derived.roas)}
            note={gainsNote(r.derived.gains)}
            variation={d("roas")}
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
            figures={figuresOf(r, { totals: r.previous, derived: r.previousDerived }, f.compare)}
            compare={f.compare}
          />
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/campaigns/${r.campaignId}`}
              className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
            >
              Ouvrir la campagne
            </Link>
            <Link
              href={statsHref("/stats/funnel", { ...f, campaignId: r.campaignId })}
              className={cn(buttonVariants({ variant: "ghost" }), "max-md:h-10")}
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

      <FormSection
        id="ads-daily"
        className="mb-8 rounded-xl border border-border bg-card p-4 md:p-5"
        title="Jour par jour"
        description={
          f.compare
            ? "La période choisie en orange, la précédente en gris, pour toutes les campagnes affichées."
            : "Pour toutes les campagnes affichées. Survolez la courbe pour lire chaque jour."
        }
      >
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
      </FormSection>

      <FormSection
        id="ads-campaigns"
        title="Par campagne"
        description="Cliquez sur une campagne pour voir tous ses chiffres."
        actions={
          ads.rows.length > 0 ? (
            <SidePanel
              title="Total de toutes les campagnes"
              description={periodLabel(f.period)}
              trigger={
                <Button variant="outline" size="sm" className="max-md:h-10">
                  Détail du total
                </Button>
              }
            >
              <MetricDetail
                figures={figuresOf(total, previousTotal, f.compare)}
                compare={f.compare}
              />
              <p className="mt-4 text-note text-muted-foreground">
                Chaque joueur n&apos;y compte qu&apos;une fois, même quand deux campagnes partagent
                une offre.
              </p>
            </SidePanel>
          ) : null
        }
      >
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
        <div className="space-y-1 text-note text-muted-foreground">
          <p>
            Chaque joueur ne compte qu&apos;une fois dans le total, même quand deux campagnes
            partagent une offre : le total peut être plus petit que la somme des lignes.
          </p>
          <p className="max-md:hidden">
            <Term term="CPL">Coût par membre</Term> = dépense pub ÷ membres entrés ; gains =
            commissions − dépense pub ; <Term term="ROAS">retour sur dépense pub</Term> =
            commissions ÷ dépense pub (au-dessus de 1, les pubs rapportent plus qu&apos;elles ne
            coûtent). Les commissions sont les primes des joueurs et la part du revenu que verse le
            partenaire ; les dépôts et le revenu net sont l&apos;argent du casino, ils ne s&apos;y
            ajoutent pas. Les dépenses viennent des comptes publicitaires connectés, des imports et
            des saisies (onglet Pubs d&apos;une campagne).
          </p>
        </div>
      </FormSection>
    </>
  );
}

import type { Metadata } from "next";
import { DataTable, type DataTableRow } from "@/components/admin/data-table";
import { Term } from "@/components/admin/help-tip";
import { MetricChart, type ChartMetric } from "@/components/charts/metric-chart";
import { NumCell } from "@/components/dashboard/cells";
import { MetricDetail } from "@/components/dashboard/metric-detail";
import { StatsTop } from "@/components/dashboard/stats-top";
import { cohortsChronological, dayLabel, fmtMetric, shareOf } from "@/lib/dashboard/display";
import { loadCohorts } from "@/lib/dashboard/daily";
import type { CohortRow } from "@/lib/dashboard/metrics";
import { loadStatsOptions } from "@/lib/dashboard/stats-options";
import { parseStatsFilters } from "@/lib/dashboard/stats-pages";
import { fmtNum } from "@/lib/format";
import { periodLabel } from "@/lib/periods";

export const metadata: Metadata = { title: "Statistiques · Membres dans le temps" };

/** Chiffres du graphique par semaine d'arrivée. */
const CHART: Array<{
  key: keyof Omit<CohortRow, "week">;
  label: string;
  format: "number" | "money";
}> = [
  { key: "members", label: "Membres arrivés", format: "number" },
  { key: "registered", label: "Inscrits", format: "number" },
  { key: "ftd", label: "Premiers dépôts", format: "number" },
  { key: "deposits7", label: "Déposé sous 7 jours", format: "money" },
  { key: "deposits30", label: "Déposé sous 30 jours", format: "money" },
  { key: "ltv", label: "Valeur par membre", format: "money" },
];

export default async function StatsCohortsPage({ searchParams }: PageProps<"/stats/cohorts">) {
  const sp = await searchParams;
  const f = parseStatsFilters(sp);
  const [options, cohorts] = await Promise.all([
    loadStatsOptions(),
    loadCohorts(f.period, {
      vertical: f.vertical,
      channelId: f.channelId,
      ...(f.campaignId ? { campaignId: f.campaignId } : {}),
    }),
  ]);
  const weeks = cohortsChronological(cohorts);
  const weekLabel = (w: string) => `Semaine du ${dayLabel(w)}`;

  const chartMetrics: ChartMetric[] = CHART.map((c) => ({
    key: c.key,
    label: c.label,
    format: c.format,
    integer: c.format === "number",
    values: weeks.map((w) => w[c.key]),
  }));

  const rows: DataTableRow[] = cohorts.map((r) => ({
    id: r.week,
    detailTitle: weekLabel(r.week),
    detailDescription: `${fmtNum(r.members)} membre${r.members > 1 ? "s" : ""} arrivé${r.members > 1 ? "s" : ""} cette semaine-là`,
    cells: {
      week: dayLabel(r.week),
      members: fmtNum(r.members),
      registered: <NumCell value={fmtNum(r.registered)} note={shareOf(r.registered, r.members)} />,
      ftd: <NumCell value={fmtNum(r.ftd)} note={shareOf(r.ftd, r.members)} />,
      ltv: fmtMetric("depositAmount", r.ltv),
    },
    sortValues: { week: r.week, registered: r.registered, ftd: r.ftd, ltv: r.ltv },
    detail: (
      <MetricDetail
        compare={false}
        figures={[
          { key: "members", label: "Membres arrivés", value: fmtNum(r.members) },
          {
            key: "registered",
            label: "Inscrits",
            value: `${fmtNum(r.registered)} (${shareOf(r.registered, r.members)})`,
          },
          {
            key: "ftd",
            label: "Premiers dépôts",
            term: "FTD",
            value: `${fmtNum(r.ftd)} (${shareOf(r.ftd, r.members)})`,
          },
          {
            key: "deposits7",
            label: "Déposé sous 7 jours",
            value: fmtMetric("depositAmount", r.deposits7),
          },
          {
            key: "deposits30",
            label: "Déposé sous 30 jours",
            value: fmtMetric("depositAmount", r.deposits30),
          },
          {
            key: "ltv",
            label: "Valeur par membre",
            term: "LTV",
            value: fmtMetric("depositAmount", r.ltv),
          },
        ]}
      />
    ),
  }));

  return (
    <>
      <StatsTop
        page="cohorts"
        filters={f}
        options={options}
        sp={sp}
        showCompare={false}
        channelHelp="Seulement les membres arrivés dans ce canal."
      />

      <section
        aria-labelledby="cohorts-chart"
        className="mb-8 rounded-xl border border-border bg-card p-4 md:p-5"
      >
        <div className="mb-3">
          <h2 id="cohorts-chart" className="text-title text-foreground">
            Semaine par semaine
          </h2>
          <p className="text-body text-muted-foreground">
            Chaque barre : les membres arrivés une même semaine, suivis depuis leur arrivée.
          </p>
        </div>
        {weeks.length > 0 ? (
          <MetricChart
            kind="bar"
            metrics={chartMetrics}
            labels={weeks.map((w) => dayLabel(w.week))}
            period={periodLabel(f.period)}
            suffix="par semaine d'arrivée"
            unitLabel="Semaine du"
            valuesSummary="Voir les chiffres semaine par semaine"
          />
        ) : (
          <p className="text-body text-muted-foreground">Aucun membre arrivé sur cette période.</p>
        )}
      </section>

      <section aria-labelledby="cohorts-table">
        <div className="mb-3">
          <h2 id="cohorts-table" className="text-title text-foreground">
            Par semaine d&apos;arrivée
          </h2>
          <p className="text-body text-muted-foreground">
            Cliquez sur une semaine pour voir ce que ses membres ont déposé sous 7 et 30 jours.
          </p>
        </div>
        <DataTable
          label="Membres par semaine d'arrivée"
          defaultSort={{ key: "week", direction: "desc" }}
          columns={[
            { key: "week", header: "Semaine du", sortFirst: "desc" },
            { key: "members", header: "Membres", align: "right" },
            { key: "registered", header: "Inscrits", align: "right", hideOnMobile: true },
            { key: "ftd", header: "Premiers dépôts", term: "FTD", align: "right" },
            {
              key: "ltv",
              header: "Valeur par membre",
              term: "LTV",
              align: "right",
              hideOnMobile: true,
            },
          ]}
          rows={rows}
          empty={{
            title: "Aucun membre arrivé sur cette période",
            description:
              "Les semaines apparaissent dès que des membres demandent à rejoindre un canal.",
            action: { href: "/channels", label: "Voir les canaux", variant: "outline" },
          }}
        />
        <p className="mt-3 text-note text-muted-foreground">
          Arrivée = première demande d&apos;adhésion sur la période.{" "}
          <Term term="LTV">Valeur par membre</Term> = revenu net de vos joueurs ÷ membres arrivés
          cette semaine-là.
        </p>
      </section>
    </>
  );
}

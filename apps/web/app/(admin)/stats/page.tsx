import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@linkaffipro/db";
import { DataTable, type DataTableRow } from "@/components/admin/data-table";
import { DetailList, DetailRow } from "@/components/admin/detail-list";
import { EmptyState } from "@/components/admin/empty-state";
import { FormSection } from "@/components/admin/form-section";
import { StatCard } from "@/components/admin/stat-card";
import { MetricChart, type ChartMetric } from "@/components/charts/metric-chart";
import { NumCell, STAT_GRID_PHONE } from "@/components/dashboard/cells";
import { MetricDetail, type DetailFigure } from "@/components/dashboard/metric-detail";
import { StatsTop } from "@/components/dashboard/stats-top";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  activeSummary,
  beforeHint,
  comparableVariation,
  dayLabels,
  fmtMetric,
  fmtMetricExact,
  metricGroupFormatter,
  moneyColumn,
  overviewLabel,
  type MetricKey,
} from "@/lib/dashboard/display";
import { loadLastEvents, type LastEvent } from "@/lib/dashboard/events";
import { loadDashboard, type ChannelRow, type DashboardData } from "@/lib/dashboard/queries";
import { loadStatsOptions } from "@/lib/dashboard/stats-options";
import { parseStatsFilters, statsHref } from "@/lib/dashboard/stats-pages";
import { fmtDate, fmtNum } from "@/lib/format";
import { periodDayKeys, periodLabel, previousPeriod } from "@/lib/periods";

export const metadata: Metadata = { title: "Statistiques" };

/** Colonnes du tableau par canal (5 au plus) ; le reste est dans le volet de la ligne. */
const CHANNEL_DETAIL: Array<keyof Omit<ChannelRow, "channelId" | "title">> = [
  "requests",
  "approved",
  "joined",
  "left",
  "offerClicks",
  "registrations",
  "ftds",
  "depositAmount",
];

function memberName(m: NonNullable<LastEvent["member"]>): string {
  return m.username ? `@${m.username}` : (m.firstName ?? "Membre");
}

export default async function StatsOverviewPage({ searchParams }: PageProps<"/stats">) {
  const sp = await searchParams;
  const f = parseStatsFilters(sp);
  const scope = {
    vertical: f.vertical,
    channelId: f.channelId,
    ...(f.campaignId ? { campaignId: f.campaignId } : {}),
  };
  const [options, bots, channels, members, lastEvents, dash, prevDash] = await Promise.all([
    loadStatsOptions(),
    prisma.bot.count({ where: { isActive: true } }),
    prisma.channel.count({ where: { isActive: true } }),
    prisma.member.count(),
    loadLastEvents(12),
    loadDashboard({ period: f.period, ...scope }),
    f.compare
      ? loadDashboard({ period: previousPeriod(f.period), ...scope })
      : Promise.resolve<DashboardData | null>(null),
  ]);

  const prevTotal = (key: string) =>
    prevDash?.metrics.find((m) => m.key === key)?.series.total ?? 0;
  const prevValues = (key: string) =>
    prevDash?.metrics.find((m) => m.key === key)?.series.values ?? null;
  const prevChannel = (id: string) => prevDash?.channels.find((c) => c.channelId === id);
  const multiDay = f.period.days > 1;
  const labels = dayLabels(dash.keys);
  const previousLabels = f.compare ? dayLabels(periodDayKeys(previousPeriod(f.period))) : undefined;

  const cards = (group: "telegram" | "argent") => {
    const metrics = dash.metrics.filter((m) => m.group === group);
    // Une seule précision pour les montants de la grille (« 5 750 € » ne côtoie pas « 12,40 € »), avant compris.
    const fmt = metricGroupFormatter(
      metrics.flatMap((m) => [
        { key: m.key as MetricKey, value: m.series.total },
        ...(f.compare ? [{ key: m.key as MetricKey, value: prevTotal(m.key) }] : []),
      ]),
    );
    return metrics.map((m) => {
      const v = overviewLabel(m.key);
      const key = m.key as MetricKey;
      const variation = f.compare
        ? comparableVariation(m.series.total, prevTotal(m.key))
        : undefined;
      return (
        <StatCard
          key={m.key}
          label={v.label}
          term={v.term}
          value={
            v.format === "money" ? (
              <span title={fmtMetricExact(key, m.series.total)}>{fmt(key, m.series.total)}</span>
            ) : (
              fmt(key, m.series.total)
            )
          }
          variation={variation}
          favorable={v.favorable}
          comparison="vs période précédente"
          // « Avant : X » sauf avec « nouveau » (« rien la période précédente » le dit déjà).
          hint={
            [beforeHint(variation, fmt(key, prevTotal(m.key))), m.note ?? null]
              .filter(Boolean)
              .join(" · ") || undefined
          }
          trend={multiDay ? m.series.values : undefined}
        />
      );
    });
  };

  const chartMetrics: ChartMetric[] = dash.metrics.map((m) => {
    const v = overviewLabel(m.key);
    return {
      key: m.key,
      label: v.label,
      format: v.format,
      integer: v.integer,
      values: m.series.values,
      previous: f.compare ? prevValues(m.key) : null,
    };
  });

  // Une seule précision pour toute la colonne « Montant déposé » (« 530 € » … « 0 € »).
  const depositMoney = moneyColumn(dash.channels.map((r) => r.depositAmount));
  const channelRows: DataTableRow[] = dash.channels.map((r) => {
    const p = prevChannel(r.channelId);
    const before = (k: (typeof CHANNEL_DETAIL)[number]) => p?.[k] ?? 0;
    const variation = (k: (typeof CHANNEL_DETAIL)[number]) =>
      f.compare ? comparableVariation(r[k], before(k)) : undefined;
    const figures: DetailFigure[] = CHANNEL_DETAIL.map((k) => {
      const v = overviewLabel(k);
      return {
        key: k,
        label: v.label,
        term: v.term,
        value: fmtMetric(k, r[k]),
        previous: f.compare ? fmtMetric(k, before(k)) : undefined,
        variation: variation(k),
        favorable: v.favorable,
      };
    });
    return {
      id: r.channelId,
      detailTitle: r.title,
      detailDescription: periodLabel(f.period),
      cells: {
        name: r.title,
        joined: <NumCell value={fmtNum(r.joined)} variation={variation("joined")} />,
        registrations: (
          <NumCell value={fmtNum(r.registrations)} variation={variation("registrations")} />
        ),
        ftds: <NumCell value={fmtNum(r.ftds)} variation={variation("ftds")} />,
        depositAmount: (
          <NumCell value={depositMoney(r.depositAmount)} variation={variation("depositAmount")} />
        ),
      },
      sortValues: {
        joined: r.joined,
        registrations: r.registrations,
        ftds: r.ftds,
        depositAmount: r.depositAmount,
      },
      detail: (
        <div className="space-y-4">
          <MetricDetail figures={figures} compare={f.compare} />
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/channels/${r.channelId}`}
              className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
            >
              Ouvrir le canal
            </Link>
            <Link
              href={statsHref("/stats/channels", { ...f, channelId: r.channelId })}
              className={cn(buttonVariants({ variant: "ghost" }), "max-md:h-10")}
            >
              Sa croissance
            </Link>
          </div>
        </div>
      ),
    };
  });

  const eventRows: DataTableRow[] = lastEvents.map((e) => ({
    id: e.id,
    detailTitle: e.label,
    detailDescription: fmtDate(e.occurredAt),
    cells: {
      when: fmtDate(e.occurredAt),
      label: e.label,
      channel: e.channel?.title ?? "—",
      member: e.member ? (
        <Link href={`/members/${e.member.id}`} className="underline-offset-4 hover:underline">
          {memberName(e.member)}
        </Link>
      ) : (
        "—"
      ),
    },
    sortValues: { member: e.member ? memberName(e.member) : null },
    // Même volet que dans le Journal (DetailList) ; le code technique de l'événement reste dans le Journal.
    detail: (
      <div className="space-y-6">
        <DetailList>
          <DetailRow label="Quand">{fmtDate(e.occurredAt)}</DetailRow>
          <DetailRow label="Événement">{e.label}</DetailRow>
          <DetailRow label="Bot">{e.bot ? `@${e.bot.username}` : "—"}</DetailRow>
          <DetailRow label="Canal">{e.channel?.title ?? "—"}</DetailRow>
          <DetailRow label="Membre">{e.member ? memberName(e.member) : "—"}</DetailRow>
        </DetailList>
        {e.member ? (
          <Link
            href={`/members/${e.member.id}`}
            className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
          >
            Ouvrir la fiche du membre
          </Link>
        ) : null}
      </div>
    ),
  }));

  return (
    <>
      <StatsTop
        page="overview"
        filters={f}
        options={options}
        sp={sp}
        help={activeSummary({ bots, channels, members })}
        channelHelp="Limite les chiffres à un canal : ses demandes, ses membres et les joueurs venus de ses messages."
      />

      {options.campaigns.length === 0 ? (
        <EmptyState
          className="mb-8"
          title="Pas encore de chiffres : créez votre première campagne"
          description="Une campagne relie une offre Link Affi, vos canaux Telegram et vos pubs. Dès qu'elle existe, ses résultats apparaissent ici, jour par jour."
          action={{ href: "/campaigns/new", label: "Nouvelle campagne" }}
        />
      ) : null}

      <FormSection
        id="stats-telegram"
        className="mb-8"
        title="Telegram"
        description="Les demandes d'adhésion, les membres acceptés, entrés et partis de vos canaux."
      >
        <div className={cn("grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4", STAT_GRID_PHONE)}>
          {cards("telegram")}
        </div>
      </FormSection>

      <FormSection
        id="stats-money"
        className="mb-8"
        title="Argent"
        description="Des clics sur vos pubs jusqu'à vos gains : commissions moins dépense pub. Les dépôts et le revenu net sont l'argent du casino, ils ne s'y ajoutent pas."
      >
        <div className={cn("grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-3", STAT_GRID_PHONE)}>
          {cards("argent")}
        </div>
      </FormSection>

      <FormSection
        id="stats-daily"
        className="mb-8 rounded-xl border border-border bg-card p-4 md:p-5"
        title="Jour par jour"
        description={
          f.compare
            ? "La période choisie en orange, la précédente en gris. Survolez la courbe pour lire chaque jour."
            : "Choisissez le chiffre à suivre. Survolez la courbe pour lire chaque jour."
        }
      >
        {multiDay ? (
          <MetricChart
            metrics={chartMetrics}
            labels={labels}
            previousLabels={previousLabels}
            period={periodLabel(f.period)}
            defaultKey="joined"
          />
        ) : (
          <p className="text-body text-muted-foreground">
            Choisissez une période de plusieurs jours pour voir l&apos;évolution jour par jour.
          </p>
        )}
      </FormSection>

      <FormSection
        id="stats-channels"
        className="mb-8"
        title="Par canal"
        description="Cliquez sur un canal pour voir tous ses chiffres."
      >
        <DataTable
          label="Chiffres par canal"
          defaultSort={{ key: "joined", direction: "desc" }}
          columns={[
            { key: "name", header: "Canal", className: "max-md:whitespace-normal" },
            { key: "joined", header: "Membres entrés", align: "right" },
            { key: "registrations", header: "Inscriptions", align: "right", hideOnMobile: true },
            { key: "ftds", header: "Premiers dépôts", term: "FTD", align: "right" },
            { key: "depositAmount", header: "Montant déposé", align: "right", hideOnMobile: true },
          ]}
          rows={channelRows}
          empty={{
            title: "Aucune activité sur la période",
            description:
              "Dès qu'un canal reçoit des demandes d'adhésion ou des clics, il apparaît ici.",
            action: { href: "/channels", label: "Voir les canaux", variant: "outline" },
          }}
        />
      </FormSection>

      <FormSection
        id="stats-events"
        title="Derniers événements"
        description="Les 12 dernières choses arrivées sur vos bots, tous filtres confondus."
        actions={
          <Link
            href="/settings/journal/events"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-10")}
          >
            Tout le journal
          </Link>
        }
      >
        <DataTable
          label="Derniers événements"
          columns={[
            { key: "when", header: "Quand", sortFirst: "desc" },
            { key: "label", header: "Événement", className: "max-md:whitespace-normal" },
            { key: "channel", header: "Canal", hideOnMobile: true },
            { key: "member", header: "Membre", hideOnMobile: true },
          ]}
          rows={eventRows}
          empty={{
            title: "Aucun événement pour l'instant",
            description:
              "Envoyez /start à un de vos bots ou publiez dans un canal : la première ligne apparaîtra ici.",
            action: { href: "/settings/bots", label: "Voir les bots", variant: "outline" },
          }}
        />
      </FormSection>
    </>
  );
}

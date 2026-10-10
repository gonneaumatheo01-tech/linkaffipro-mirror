import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@linkaffipro/db";
import { DataTable, type DataTableRow } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/empty-state";
import { StatCard } from "@/components/admin/stat-card";
import { MetricChart, type ChartMetric } from "@/components/charts/metric-chart";
import { NumCell, STAT_GRID_PHONE } from "@/components/dashboard/cells";
import { MetricDetail, type DetailFigure } from "@/components/dashboard/metric-detail";
import { StatsTop } from "@/components/dashboard/stats-top";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  activeSummary,
  comparableDelta,
  dayLabels,
  fmtMetric,
  moneyColumn,
  overviewLabel,
  type MetricKey,
} from "@/lib/dashboard/display";
import { loadLastEvents, type LastEvent } from "@/lib/dashboard/events";
import { deltaPct } from "@/lib/dashboard/metrics";
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

function SectionTitle({
  id,
  title,
  description,
}: {
  id: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-3">
      <h2 id={id} className="text-title text-foreground">
        {title}
      </h2>
      <p className="text-body text-muted-foreground">{description}</p>
    </div>
  );
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

  const cards = (group: "telegram" | "argent") =>
    dash.metrics
      .filter((m) => m.group === group)
      .map((m) => {
        const v = overviewLabel(m.key);
        return (
          <StatCard
            key={m.key}
            label={v.label}
            term={v.term}
            value={fmtMetric(m.key as MetricKey, m.series.total)}
            delta={
              f.compare
                ? comparableDelta(deltaPct(m.series.total, prevTotal(m.key)), prevTotal(m.key))
                : undefined
            }
            favorable={v.favorable}
            comparison="vs période précédente"
            hint={
              f.compare ? `Avant : ${fmtMetric(m.key as MetricKey, prevTotal(m.key))}` : undefined
            }
            trend={multiDay ? m.series.values : undefined}
          />
        );
      });

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
    const delta = (k: (typeof CHANNEL_DETAIL)[number]) =>
      f.compare ? comparableDelta(deltaPct(r[k], before(k)), before(k)) : undefined;
    const figures: DetailFigure[] = CHANNEL_DETAIL.map((k) => {
      const v = overviewLabel(k);
      return {
        key: k,
        label: v.label,
        term: v.term,
        value: fmtMetric(k, r[k]),
        previous: f.compare ? fmtMetric(k, before(k)) : undefined,
        delta: f.compare ? (delta(k) ?? null) : undefined,
        favorable: v.favorable,
      };
    });
    return {
      id: r.channelId,
      detailTitle: r.title,
      detailDescription: periodLabel(f.period),
      cells: {
        name: r.title,
        joined: <NumCell value={fmtNum(r.joined)} delta={delta("joined")} />,
        registrations: <NumCell value={fmtNum(r.registrations)} delta={delta("registrations")} />,
        ftds: <NumCell value={fmtNum(r.ftds)} delta={delta("ftds")} />,
        depositAmount: (
          <NumCell value={depositMoney(r.depositAmount)} delta={delta("depositAmount")} />
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
              className={buttonVariants({ variant: "outline" })}
            >
              Ouvrir le canal
            </Link>
            <Link
              href={statsHref("/stats/channels", { ...f, channelId: r.channelId })}
              className={buttonVariants({ variant: "ghost" })}
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
    detail: (
      <div className="space-y-4">
        <dl className="divide-y divide-border">
          {[
            ["Quand", fmtDate(e.occurredAt)],
            ["Bot", e.bot ? `@${e.bot.username}` : "—"],
            ["Canal", e.channel?.title ?? "—"],
            ["Membre", e.member ? memberName(e.member) : "—"],
            ["Code technique", e.type],
          ].map(([k, v]) => (
            <div key={k} className="flex items-start justify-between gap-4 py-2.5">
              <dt className="text-body text-muted-foreground">{k}</dt>
              <dd className="min-w-0 text-right text-body break-words text-foreground">{v}</dd>
            </div>
          ))}
        </dl>
        {e.member ? (
          <Link href={`/members/${e.member.id}`} className={buttonVariants({ variant: "outline" })}>
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

      <section aria-labelledby="stats-telegram" className="mb-8">
        <div className="mb-3">
          <h2 id="stats-telegram" className="text-title text-foreground">
            Telegram
          </h2>
          <p className="text-body text-muted-foreground">
            Les demandes d&apos;adhésion, les membres acceptés, entrés et partis de vos canaux.
          </p>
        </div>
        <div className={cn("grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4", STAT_GRID_PHONE)}>
          {cards("telegram")}
        </div>
      </section>

      <section aria-labelledby="stats-money" className="mb-8">
        <div className="mb-3">
          <h2 id="stats-money" className="text-title text-foreground">
            Argent
          </h2>
          <p className="text-body text-muted-foreground">
            Des clics sur vos pubs jusqu&apos;au revenu net de vos joueurs.
          </p>
        </div>
        <div className={cn("grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-3", STAT_GRID_PHONE)}>
          {cards("argent")}
        </div>
      </section>

      <section
        aria-labelledby="stats-daily"
        className="mb-8 rounded-xl border border-border bg-card p-4 md:p-5"
      >
        <SectionTitle
          id="stats-daily"
          title="Jour par jour"
          description={
            f.compare
              ? "La période choisie en orange, la précédente en gris. Survolez la courbe pour lire chaque jour."
              : "Choisissez le chiffre à suivre. Survolez la courbe pour lire chaque jour."
          }
        />
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
      </section>

      <section aria-labelledby="stats-channels" className="mb-8">
        <div className="mb-3">
          <h2 id="stats-channels" className="text-title text-foreground">
            Par canal
          </h2>
          <p className="text-body text-muted-foreground">
            Cliquez sur un canal pour voir tous ses chiffres.
          </p>
        </div>
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
      </section>

      <section aria-labelledby="stats-events">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="stats-events" className="text-title text-foreground">
              Derniers événements
            </h2>
            <p className="text-body text-muted-foreground">
              Les 12 dernières choses arrivées sur vos bots, tous filtres confondus.
            </p>
          </div>
          <Link
            href="/settings/journal/events"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            Tout le journal
          </Link>
        </div>
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
      </section>
    </>
  );
}

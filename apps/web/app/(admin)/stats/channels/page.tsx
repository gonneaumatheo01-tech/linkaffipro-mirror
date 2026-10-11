import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { DataTable, type DataTableRow } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/empty-state";
import { FormSection } from "@/components/admin/form-section";
import { MiniTrend, StatCard } from "@/components/admin/stat-card";
import { UniverseDot } from "@/components/admin/universe-dot";
import { BarList } from "@/components/charts/bar-list";
import { MetricChart } from "@/components/charts/metric-chart";
import { NumCell, STAT_GRID_PHONE } from "@/components/dashboard/cells";
import { MetricDetail, type DetailFigure } from "@/components/dashboard/metric-detail";
import { StatsTop } from "@/components/dashboard/stats-top";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { campaignScope } from "@/lib/dashboard/campaign-scope";
import { loadBestTimes, loadChannelGrowth, type ChannelDaily } from "@/lib/dashboard/daily";
import {
  comparableDelta,
  dayLabels,
  fmtSigned,
  hourBars,
  perPostText,
  postsClicksNote,
  sumSeries,
  trendOrNone,
} from "@/lib/dashboard/display";
import { deltaPct } from "@/lib/dashboard/metrics";
import { loadStatsOptions } from "@/lib/dashboard/stats-options";
import { parseStatsFilters } from "@/lib/dashboard/stats-pages";
import { fmtNum } from "@/lib/format";
import { periodDayKeys, periodLabel } from "@/lib/periods";

export const metadata: Metadata = { title: "Statistiques · Canaux" };

type Figure = "requests" | "joined" | "left" | "net";

const FIGURES: Array<{ key: Figure; label: string; favorable: "up" | "down" }> = [
  { key: "requests", label: "Demandes d'adhésion", favorable: "up" },
  { key: "joined", label: "Membres entrés", favorable: "up" },
  { key: "left", label: "Départs", favorable: "down" },
  { key: "net", label: "Croissance nette", favorable: "up" },
];

function valueOf(g: Pick<ChannelDaily, "requests" | "joined" | "left">, k: Figure): number {
  return k === "net" ? g.joined - g.left : g[k];
}

function fmtFigure(k: Figure, v: number): string {
  return k === "net" ? fmtSigned(v) : fmtNum(v);
}

export default async function StatsChannelsPage({ searchParams }: PageProps<"/stats/channels">) {
  const sp = await searchParams;
  const f = parseStatsFilters(sp);
  const [options, growthAll, best, scope] = await Promise.all([
    loadStatsOptions(),
    loadChannelGrowth(f.period, f.channelId, f.compare),
    loadBestTimes(f.period, f.channelId),
    f.campaignId ? campaignScope(f.campaignId) : Promise.resolve(null),
  ]);
  // Univers et campagne : on garde les canaux de l'univers, ou ceux de la campagne (leurs chiffres restent ceux de
  // tout le canal).
  const universeOf = new Map(options.channels.map((c) => [c.id, c.vertical]));
  const growth = growthAll.filter(
    (g) =>
      (!f.vertical || universeOf.get(g.channelId) === f.vertical) &&
      (!scope || scope.channelIds.includes(g.channelId)),
  );
  const keys = periodDayKeys(f.period);
  const multiDay = f.period.days > 1;
  const sum = (k: Figure) => growth.reduce((a, g) => a + valueOf(g, k), 0);
  const prevSum = (k: Figure) =>
    growth.reduce((a, g) => a + (g.previous ? valueOf(g.previous, k) : 0), 0);
  const net = sumSeries(
    growth.map((g) => g.net),
    keys.length,
  );
  const channelName = options.channels.find((c) => c.id === f.channelId)?.title;
  const calendarHref = f.channelId
    ? `/messages?${new URLSearchParams({ channelId: f.channelId }).toString()}`
    : "/messages";

  const rows: DataTableRow[] = growth.map((g) => {
    // Croissance nette d'avant négative : pas de pourcentage (son signe serait trompeur), voir comparableDelta.
    const d = (k: Figure) =>
      f.compare && g.previous
        ? comparableDelta(deltaPct(valueOf(g, k), valueOf(g.previous, k)), valueOf(g.previous, k))
        : undefined;
    const figures: DetailFigure[] = FIGURES.map((x) => ({
      key: x.key,
      label: x.label,
      value: fmtFigure(x.key, valueOf(g, x.key)),
      previous: f.compare && g.previous ? fmtFigure(x.key, valueOf(g.previous, x.key)) : undefined,
      delta: f.compare ? (d(x.key) ?? null) : undefined,
      favorable: x.favorable,
    }));
    return {
      id: g.channelId,
      detailTitle: g.title,
      detailDescription: periodLabel(f.period),
      cells: {
        name: (
          <span className="flex min-w-0 items-center gap-2">
            <UniverseDot universe={universeOf.get(g.channelId) ?? null} />
            <span className="min-w-0">{g.title}</span>
          </span>
        ),
        trend:
          multiDay && trendOrNone(g.net) ? (
            <MiniTrend values={g.net} />
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
        joined: <NumCell value={fmtNum(g.joined)} delta={d("joined")} />,
        left: <NumCell value={fmtNum(g.left)} delta={d("left")} favorable="down" />,
        net: (
          <span className={cn(valueOf(g, "net") < 0 && "text-danger")}>
            <NumCell value={fmtSigned(valueOf(g, "net"))} delta={d("net")} />
          </span>
        ),
      },
      sortValues: {
        name: g.title,
        joined: g.joined,
        left: g.left,
        net: valueOf(g, "net"),
      },
      detail: (
        <div className="space-y-4">
          <MetricDetail figures={figures} compare={f.compare} />
          {multiDay && trendOrNone(g.net) ? (
            <div>
              <p className="mb-1 text-note text-muted-foreground">Croissance nette jour par jour</p>
              <MiniTrend values={g.net} />
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/channels/${g.channelId}`}
              className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
            >
              Ouvrir le canal
            </Link>
            <Link
              href={`/messages?${new URLSearchParams({ channelId: g.channelId }).toString()}`}
              className={cn(buttonVariants({ variant: "ghost" }), "max-md:h-10")}
            >
              Ses meilleurs créneaux
            </Link>
          </div>
        </div>
      ),
    };
  });

  return (
    <>
      <StatsTop
        page="channels"
        filters={f}
        options={options}
        sp={sp}
        channelHelp="Un seul canal : sa croissance et ses meilleures catégories de messages."
      />

      <section aria-label="Chiffres clés des canaux" className="mb-8">
        <div className={cn("grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4", STAT_GRID_PHONE)}>
          {FIGURES.map((x) => (
            <StatCard
              key={x.key}
              label={x.label}
              value={fmtFigure(x.key, sum(x.key))}
              delta={
                f.compare
                  ? comparableDelta(deltaPct(sum(x.key), prevSum(x.key)), prevSum(x.key))
                  : undefined
              }
              favorable={x.favorable}
              hint={f.compare ? `Avant : ${fmtFigure(x.key, prevSum(x.key))}` : undefined}
              trend={x.key === "net" && multiDay ? net : undefined}
            />
          ))}
        </div>
      </section>

      <FormSection
        id="channels-daily"
        className="mb-8 rounded-xl border border-border bg-card p-4 md:p-5"
        title="Croissance nette jour par jour"
        description={`Membres entrés moins départs, pour ${
          growth.length === 1 ? "ce canal" : "les canaux affichés"
        }. Sous la ligne du zéro, le canal a perdu des membres.`}
      >
        {multiDay ? (
          <MetricChart
            metrics={[
              {
                key: "net",
                label: "Croissance nette",
                format: "number",
                integer: true,
                values: net,
              },
            ]}
            labels={dayLabels(keys)}
            period={periodLabel(f.period)}
          />
        ) : (
          <p className="text-body text-muted-foreground">
            Choisissez une période de plusieurs jours pour voir l&apos;évolution jour par jour.
          </p>
        )}
      </FormSection>

      <FormSection
        id="channels-table"
        className="mb-8"
        title="Par canal"
        description="Cliquez sur un canal pour voir ses demandes et la période précédente."
      >
        <DataTable
          label="Croissance par canal"
          defaultSort={{ key: "net", direction: "desc" }}
          columns={[
            { key: "name", header: "Canal", className: "max-md:whitespace-normal" },
            { key: "trend", header: "Tendance", sortable: false, hideOnMobile: true },
            { key: "joined", header: "Membres entrés", align: "right" },
            { key: "left", header: "Départs", align: "right", hideOnMobile: true },
            { key: "net", header: "Croissance nette", align: "right" },
          ]}
          rows={rows}
          empty={{
            title:
              f.vertical || f.campaignId ? "Aucun canal pour ces filtres" : "Aucun canal actif",
            description:
              f.vertical || f.campaignId
                ? "Choisissez un autre univers ou une autre campagne."
                : "Ajoutez un de vos bots comme administrateur d'un canal Telegram : il apparaîtra ici.",
            action: { href: "/channels", label: "Voir les canaux", variant: "outline" },
          }}
        />
      </FormSection>

      <FormSection
        id="channels-categories"
        className="mb-8 rounded-xl border border-border bg-card p-4 md:p-5"
        title="Meilleures catégories"
        description={`Clics par message envoyé, ${
          channelName ? `sur « ${channelName} »` : "sur tous vos canaux"
        }.`}
        actions={
          best.categories.length > 0 ? (
            <Link
              href="/messages/categories"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-10")}
            >
              Comparer en détail
            </Link>
          ) : null
        }
      >
        {best.categories.length === 0 ? (
          <EmptyState
            title="Aucun message envoyé sur la période"
            description="Donnez une catégorie à vos messages (bonus, pronostic, rappel…) pour comparer ce qui marche le mieux."
            action={{
              href: "/settings/categories",
              label: "Gérer les catégories",
              variant: "outline",
            }}
          />
        ) : (
          <BarList
            label="Clics par message, par catégorie"
            items={best.categories.map((c) => ({
              key: c.categoryId ?? "none",
              label: (
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: c.color }}
                  />
                  <span className="min-w-0 break-words">{c.name}</span>
                </span>
              ),
              value: c.clicksPerPost,
              valueText: perPostText(c.clicksPerPost),
              note: postsClicksNote(c.posts, c.clicks),
            }))}
          />
        )}
      </FormSection>

      <FormSection
        id="channels-hours"
        className="rounded-xl border border-border bg-card p-4 md:p-5"
        title="Meilleurs horaires d'envoi"
        description={`Clics par message selon l'heure d'envoi (heure de Paris), ${
          channelName ? `sur « ${channelName} »` : "sur tous vos canaux"
        }.`}
        actions={
          <Link
            href={calendarHref}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-10")}
          >
            <CalendarClock aria-hidden />
            Voir dans le calendrier
          </Link>
        }
      >
        {best.hours.length === 0 ? (
          <EmptyState
            title="Aucun message envoyé sur la période"
            description="Programmez des messages dans vos canaux : les heures qui font le plus cliquer ressortiront ici."
            action={{ href: "/messages/new", label: "Nouveau message", variant: "outline" }}
          />
        ) : (
          <>
            <BarList label="Clics par message, par heure d'envoi" items={hourBars(best.hours)} />
            <p className="mt-4 text-note text-muted-foreground">
              {best.hours.length > 8 ? "Les 8 meilleures heures de la période. " : null}Le
              calendrier des messages surligne aussi les meilleurs créneaux de chaque canal (jour et
              heure).
            </p>
          </>
        )}
      </FormSection>
    </>
  );
}

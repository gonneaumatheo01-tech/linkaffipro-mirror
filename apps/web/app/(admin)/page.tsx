import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { VERTICALS, VERTICAL_LABELS, isVertical } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { EmptyState } from "@/components/admin/empty-state";
import { HelpTip } from "@/components/admin/help-tip";
import { Bars, Sparkline } from "@/components/dashboard/sparkline";
import { METRIC_HELP } from "@/components/dashboard/metric-help";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format";
import {
  parseCompare,
  periodLabel,
  periodParams,
  previousPeriod,
  resolvePeriod,
} from "@/lib/periods";
import { PeriodSelect } from "@/components/admin/period-select";
import { Delta } from "@/components/dashboard/delta";
import { deltaPct } from "@/lib/dashboard/metrics";
import { loadDashboard } from "@/lib/dashboard/queries";
import {
  loadAdsTable,
  loadBestTimes,
  loadChannelGrowth,
  loadCohorts,
  loadFunnel,
  type CohortFilters,
} from "@/lib/dashboard/daily";
import { AdsTable, type AdsSortKey } from "@/components/dashboard/ads-table";
import { Funnel } from "@/components/dashboard/funnel";
import { CampaignFilter } from "@/components/dashboard/campaign-filter";
import { loadLastEvents } from "@/lib/dashboard/events";
import { Button } from "@/components/ui/button";
import { recomputeStatsAction } from "./dashboard/actions";

const TABS = [
  { key: "overview", label: "Vue d'ensemble" },
  { key: "ads", label: "Campagnes" },
  { key: "funnel", label: "Entonnoir" },
  { key: "cohorts", label: "Cohortes" },
  { key: "channels", label: "Canaux" },
] as const;
type Tab = (typeof TABS)[number]["key"];
function parseTab(v: string): Tab {
  return (TABS.some((t) => t.key === v) ? v : "overview") as Tab;
}

const TAB_HELP: Record<Tab, string> = {
  overview:
    "Les chiffres clés de la période choisie, pour vos joueurs seulement. Changez la période ou filtrez par univers, canal ou campagne en haut à droite.",
  ads: "Une ligne par campagne : ce qu'elle a coûté et ce qu'elle a rapporté. Cliquez un en-tête de colonne pour trier.",
  funnel:
    "Le parcours complet, du clic sur la pub jusqu'au dépôt : à chaque étape, la part conservée et la perte.",
  cohorts:
    "Les membres arrivés pendant la période, regroupés par semaine : combien se sont inscrits, ont déposé, et ce qu'ils rapportent.",
  channels: "Croissance de chaque canal, meilleurs horaires et meilleures catégories de messages.",
};

export const metadata: Metadata = { title: "Tableau de bord" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** En-tête de colonne avec infobulle. */
function Head({
  k,
  children,
  className,
}: {
  k: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <TableHead className={className}>
      <span className="inline-flex items-center gap-1">
        {children}
        {METRIC_HELP[k] ? (
          <HelpTip label={`Définition : ${String(children)}`}>{METRIC_HELP[k]}</HelpTip>
        ) : null}
      </span>
    </TableHead>
  );
}

export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const period = resolvePeriod(sp);
  const compare = parseCompare(sp.compare);
  const prevPeriod = previousPeriod(period);
  const verticalRaw = one(sp.vertical);
  const vertical = isVertical(verticalRaw) ? verticalRaw : "";
  const channelId = one(sp.channelId);
  const campaignId = one(sp.campaignId);
  const tab = parseTab(one(sp.tab));
  const sort = (one(sp.sort) || "spend") as AdsSortKey;
  const dir = one(sp.dir) === "asc" ? "asc" : "desc";
  // Entonnoir : par défaut, la dimension du filtre posé (même périmètre que la vue d'ensemble).
  const funnelDim =
    one(sp.dim) ||
    (campaignId
      ? `campaign:${campaignId}`
      : channelId
        ? `channel:${channelId}`
        : vertical
          ? `vertical:${vertical}`
          : "all");
  const filters: CohortFilters = { vertical, channelId, ...(campaignId ? { campaignId } : {}) };
  const [bots, channels, members, campaignList, lastEvents, channelList, dash] = await Promise.all([
    prisma.bot.count({ where: { isActive: true } }),
    prisma.channel.count({ where: { isActive: true } }),
    prisma.member.count(),
    prisma.campaign.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    tab === "overview" ? loadLastEvents(12) : Promise.resolve([]),
    prisma.channel.findMany({
      where: { isActive: true },
      orderBy: { title: "asc" },
      select: { id: true, title: true },
    }),
    tab === "overview" ? loadDashboard({ period, ...filters }) : Promise.resolve(null),
  ]);
  const campaignCount = campaignList.length;
  const [ads, funnelData, cohortRows, growth, best, prevDash] = await Promise.all([
    tab === "ads" ? loadAdsTable(period, { vertical, campaignId }) : Promise.resolve(null),
    tab === "funnel" ? loadFunnel(funnelDim, period, compare) : Promise.resolve(null),
    tab === "cohorts" ? loadCohorts(period, filters) : Promise.resolve(null),
    tab === "channels" ? loadChannelGrowth(period, channelId, compare) : Promise.resolve(null),
    tab === "channels" ? loadBestTimes(period, channelId) : Promise.resolve(null),
    tab === "overview" && compare
      ? loadDashboard({ period: prevPeriod, ...filters })
      : Promise.resolve(null),
  ]);
  const prevMetric = (key: string) =>
    prevDash?.metrics.find((m) => m.key === key)?.series.total ?? 0;
  const prevChannel = (id: string) => prevDash?.channels.find((c) => c.channelId === id) ?? null;
  const tiles = [
    { label: "Bots actifs", value: bots, help: "Bots Telegram en service (page Bots)." },
    {
      label: "Canaux actifs",
      value: channels,
      help: "Canaux et groupes Telegram où un de nos bots est administrateur (page Canaux).",
    },
    {
      label: "Membres vus",
      value: members,
      help: "Personnes vues au moins une fois par un de nos bots (demande d'adhésion, /start, clic).",
    },
  ];
  const base = {
    ...(vertical ? { vertical } : {}),
    ...(channelId ? { channelId } : {}),
    ...(campaignId ? { campaignId } : {}),
  };
  const pp = periodParams(period, compare);
  const q = (t: Tab = tab) =>
    `/?${new URLSearchParams({ tab: t, ...pp, ...base, ...(t === "funnel" ? { dim: funnelDim } : {}) }).toString()}`;
  const sortHref = (k: AdsSortKey) =>
    `/?${new URLSearchParams({ tab: "ads", ...pp, ...base, sort: k, dir: sort === k && dir === "desc" ? "asc" : "desc" }).toString()}`;
  const label = periodLabel(period);
  const rangeBar = (
    <PeriodSelect
      period={period}
      compare={compare}
      action="/"
      extra={{
        tab,
        ...base,
        ...(tab === "funnel" ? { dim: funnelDim } : {}),
        ...(tab === "ads" ? { sort, dir } : {}),
      }}
    />
  );
  const compareNote = compare ? (
    <p className="mb-3 text-xs text-muted-foreground">
      Période : {label} · comparée à la précédente ({periodLabel(prevPeriod)}). Les variations en
      vert sont favorables, en rouge défavorables (pour les coûts, une baisse est favorable).
    </p>
  ) : (
    <p className="mb-3 text-xs text-muted-foreground">
      Période : {label}. Cochez « Comparer » pour afficher la variation par rapport à la période
      précédente.
    </p>
  );
  const selectCls = "h-10 rounded-md border bg-background px-2 text-sm md:h-8";
  const fmtVal = (m: { money?: boolean }, v: number) =>
    m.money ? fmtMoney(v, "EUR", { digits: 0 }) : fmtNum(v);
  const pct = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0);

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        description="Ce que vos campagnes, vos canaux et vos messages rapportent, en un coup d'œil."
        help={TAB_HELP[tab]}
      >
        <form method="get" className="flex flex-wrap items-center gap-2">
          {Object.entries(pp).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <input type="hidden" name="tab" value={tab} />
          <select
            name="vertical"
            aria-label="Univers"
            defaultValue={vertical}
            className={selectCls}
          >
            <option value="">Tous les univers</option>
            {VERTICALS.map((v) => (
              <option key={v} value={v}>
                {VERTICAL_LABELS[v]}
              </option>
            ))}
          </select>
          <select
            name="channelId"
            aria-label="Canal"
            defaultValue={channelId}
            className={selectCls}
          >
            <option value="">Tous les canaux</option>
            {channelList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          <Suspense fallback={null}>
            <CampaignFilter campaigns={campaignList} value={campaignId} />
          </Suspense>
          <Button type="submit" variant="outline" className="max-md:h-10">
            Appliquer
          </Button>
        </form>
      </PageHeader>
      <Flash
        ok={sp.ok}
        error={sp.forbidden ? "Cette page est réservée aux administrateurs." : sp.error}
      />

      <nav
        aria-label="Onglets du tableau de bord"
        className="mb-6 flex flex-wrap items-center gap-2 border-b"
      >
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={q(t.key)}
            aria-current={t.key === tab ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${t.key === tab ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "ads" && ads ? (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            {rangeBar}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>
                Chiffres calculés{" "}
                {ads.lastComputedAt ? `le ${fmtDate(ads.lastComputedAt)}` : "jamais"}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="max-md:h-10"
                render={
                  <a
                    href={`/dashboard/export?${new URLSearchParams({ ...pp, ...(vertical ? { vertical } : {}), ...(campaignId ? { campaignId } : {}) }).toString()}`}
                  />
                }
              >
                Exporter CSV{compare ? " (avec comparaison)" : ""}
              </Button>
              <form action={recomputeStatsAction}>
                <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
                  Recalculer les statistiques
                </Button>
              </form>
            </div>
          </div>
          {compareNote}
          <Card>
            <CardContent className="pt-6">
              {ads.rows.length === 0 ? (
                <EmptyState
                  title="Aucune campagne sur cette période"
                  description="Créez une campagne (offre Link Affi, canaux et pubs) : ses coûts et ses résultats apparaîtront ici, jour par jour."
                  action={{ href: "/campaigns/new", label: "Nouvelle campagne" }}
                />
              ) : (
                <AdsTable
                  rows={ads.rows}
                  total={ads.total}
                  totalDerived={ads.totalDerived}
                  totalDeltas={ads.totalDeltas}
                  sort={sort}
                  dir={dir}
                  hrefFor={sortHref}
                  showDeltas={compare}
                />
              )}
            </CardContent>
          </Card>
          <p className="mt-2 text-xs text-muted-foreground">
            Coût par membre arrivé (CPL) = dépense ÷ membres entrés · coût par inscription (CPA) =
            dépense ÷ inscriptions · ROAS = revenu net (NGR) ÷ dépense · bénéfice = NGR − dépense.
            Les dépenses viennent des comptes publicitaires connectés, des imports et des saisies de
            la page Campagnes (onglet Pubs). La ligne Total compte chaque joueur une seule fois,
            même quand deux campagnes partagent la même offre. Survolez un « ? » pour la définition
            de chaque colonne.
          </p>
        </>
      ) : null}

      {tab === "funnel" && funnelData ? (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            {rangeBar}
            <form method="get" className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="tab" value="funnel" />
              {Object.entries({ ...pp, ...base }).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              <select
                name="dim"
                aria-label="Afficher l'entonnoir pour"
                defaultValue={funnelDim}
                className={selectCls}
              >
                <option value="all">Tout</option>
                <optgroup label="Campagnes">
                  {campaignList.map((c) => (
                    <option key={c.id} value={`campaign:${c.id}`}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Canaux">
                  {channelList.map((c) => (
                    <option key={c.id} value={`channel:${c.id}`}>
                      {c.title}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Univers">
                  {VERTICALS.map((v) => (
                    <option key={v} value={`vertical:${v}`}>
                      {VERTICAL_LABELS[v]}
                    </option>
                  ))}
                </optgroup>
              </select>
              <Button type="submit" variant="outline" className="max-md:h-10">
                Appliquer
              </Button>
            </form>
          </div>
          {compareNote}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                Entonnoir ({label.toLowerCase()}) <HelpTip>{METRIC_HELP.funnel}</HelpTip>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {funnelData.steps.every((s) => s.value === 0) ? (
                <EmptyState
                  title="Aucune donnée sur cette période"
                  description="L'entonnoir se remplit dès qu'une pub reçoit des clics ou qu'un canal reçoit des demandes d'adhésion."
                  action={{ href: "/links", label: "Créer un lien de pub", variant: "outline" }}
                />
              ) : (
                <Funnel steps={funnelData.steps} previous={funnelData.previous?.steps ?? null} />
              )}
            </CardContent>
          </Card>
          <p className="mt-2 text-xs text-muted-foreground">
            Chaque étape affiche le pourcentage conservé par rapport à l&apos;étape précédente et la
            perte correspondante. Les dépôts peuvent dépasser les premiers dépôts (FTD) : un joueur
            peut déposer plusieurs fois.
          </p>
        </>
      ) : null}

      {tab === "cohorts" && cohortRows ? (
        <>
          <div className="mb-3">{rangeBar}</div>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                Cohortes par semaine d&apos;arrivée ({label.toLowerCase()}){" "}
                <HelpTip>{METRIC_HELP.cohort}</HelpTip>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {cohortRows.length === 0 ? (
                <EmptyState
                  title="Aucun membre arrivé sur cette période"
                  description="Les cohortes apparaissent dès que des membres demandent à rejoindre un canal."
                  action={{ href: "/channels", label: "Voir les canaux", variant: "outline" }}
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Semaine du</TableHead>
                      <Head k="members" className="text-right">
                        Membres
                      </Head>
                      <Head k="registered" className="text-right">
                        Inscrits
                      </Head>
                      <Head k="ftds" className="text-right">
                        FTD
                      </Head>
                      <Head k="deposits7" className="hidden text-right md:table-cell">
                        Dépôts J+7
                      </Head>
                      <Head k="deposits30" className="hidden text-right md:table-cell">
                        Dépôts J+30
                      </Head>
                      <Head k="ltv" className="text-right">
                        LTV moyenne
                      </Head>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cohortRows.map((r) => (
                      <TableRow key={r.week}>
                        <TableCell className="whitespace-nowrap">{r.week}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtNum(r.members)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtNum(r.registered)}{" "}
                          <span className="text-xs text-muted-foreground">
                            ({pct(r.registered, r.members)} %)
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtNum(r.ftd)}{" "}
                          <span className="text-xs text-muted-foreground">
                            ({pct(r.ftd, r.members)} %)
                          </span>
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums md:table-cell">
                          {fmtMoney(r.deposits7)}
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums md:table-cell">
                          {fmtMoney(r.deposits30)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMoney(r.ltv)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Arrivée = première demande d&apos;adhésion sur la période. LTV (valeur par membre) =
                revenu net (NGR) de vos joueurs rattachés (somme des variations datées) ÷ membres de
                la cohorte.
              </p>
            </CardContent>
          </Card>
        </>
      ) : null}

      {tab === "channels" && growth && best ? (
        <>
          <div className="mb-3">{rangeBar}</div>
          {compareNote}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                Croissance nette par jour (entrées − départs) <HelpTip>{METRIC_HELP.net}</HelpTip>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {growth.length === 0 ? (
                <EmptyState
                  title="Aucun canal actif"
                  description="Ajoutez un de nos bots comme administrateur d'un canal Telegram : il apparaîtra ici automatiquement."
                  action={{ href: "/channels", label: "Voir les canaux", variant: "outline" }}
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Canal</TableHead>
                      <TableHead className="hidden md:table-cell">Tendance</TableHead>
                      <Head k="requests" className="hidden text-right md:table-cell">
                        Demandes
                      </Head>
                      <Head k="joined" className="text-right">
                        Entrées
                      </Head>
                      <Head k="left" className="text-right">
                        Départs
                      </Head>
                      <Head k="net" className="text-right">
                        Net
                      </Head>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {growth.map((g) => (
                      <TableRow key={g.channelId}>
                        <TableCell>
                          <Link href={`/channels/${g.channelId}`} className="hover:underline">
                            {g.title}
                          </Link>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <Bars
                            values={g.net.map((v) => Math.max(0, v))}
                            keys={g.keys}
                            height={28}
                            className="w-40"
                          />
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums md:table-cell">
                          <div>{fmtNum(g.requests)}</div>
                          {g.previous ? (
                            <Delta value={deltaPct(g.requests, g.previous.requests)} />
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <div>{fmtNum(g.joined)}</div>
                          {g.previous ? (
                            <Delta value={deltaPct(g.joined, g.previous.joined)} />
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <div>{fmtNum(g.left)}</div>
                          {g.previous ? (
                            <Delta value={deltaPct(g.left, g.previous.left)} invert />
                          ) : null}
                        </TableCell>
                        <TableCell
                          className={`text-right font-medium tabular-nums ${g.joined - g.left < 0 ? "text-red-600" : ""}`}
                        >
                          <div>
                            {g.joined - g.left > 0 ? "+" : ""}
                            {fmtNum(g.joined - g.left)}
                          </div>
                          {g.previous ? (
                            <Delta
                              value={deltaPct(
                                g.joined - g.left,
                                g.previous.joined - g.previous.left,
                              )}
                            />
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  Meilleurs horaires d&apos;envoi <HelpTip>{METRIC_HELP.clicksPerPost}</HelpTip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {best.hours.length === 0 ? (
                  <EmptyState
                    title="Aucun message envoyé sur la période"
                    description="Programmez des messages dans vos canaux : les meilleures heures ressortiront ici."
                    action={{ href: "/messages/new", label: "Nouveau message", variant: "outline" }}
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Heure (Paris)</TableHead>
                        <TableHead className="text-right">Messages</TableHead>
                        <TableHead className="text-right">Clics</TableHead>
                        <TableHead className="text-right">Clics / message</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {best.hours.slice(0, 8).map((h) => (
                        <TableRow key={h.hour}>
                          <TableCell>{String(h.hour).padStart(2, "0")} h</TableCell>
                          <TableCell className="text-right tabular-nums">{h.posts}</TableCell>
                          <TableCell className="text-right tabular-nums">{h.clicks}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {h.clicksPerPost}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Meilleures catégories</CardTitle>
              </CardHeader>
              <CardContent>
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
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Catégorie</TableHead>
                        <TableHead className="text-right">Messages</TableHead>
                        <TableHead className="text-right">Clics</TableHead>
                        <TableHead className="text-right">Clics / message</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {best.categories.map((c) => (
                        <TableRow key={c.categoryId ?? "none"}>
                          <TableCell>
                            <span
                              className="mr-2 inline-block size-2.5 rounded-full align-middle"
                              style={{ backgroundColor: c.color }}
                              aria-hidden="true"
                            />
                            {c.name}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{c.posts}</TableCell>
                          <TableCell className="text-right tabular-nums">{c.clicks}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {c.clicksPerPost}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}

      {tab === "overview" && dash ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {tiles.map((t) => (
              <Card key={t.label}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                    {t.label} <HelpTip label={`Définition : ${t.label}`}>{t.help}</HelpTip>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-semibold tabular-nums">{fmtNum(t.value)}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mt-8 mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">Activité</h2>
            <div className="ml-2">{rangeBar}</div>
          </div>
          {compareNote}
          {campaignCount === 0 ? (
            <EmptyState
              title="Pas encore de chiffres : créez votre première campagne"
              description="Une campagne relie une offre Link Affi, vos canaux Telegram et vos pubs. Dès qu'elle existe, les clics, inscriptions, dépôts et le NGR de vos joueurs apparaissent ici, jour par jour."
              action={{ href: "/campaigns/new", label: "Nouvelle campagne" }}
            />
          ) : null}
          {(["telegram", "argent"] as const).map((group) => (
            <div key={group} className="mb-4">
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">
                {group === "telegram"
                  ? "Telegram : demandes → acceptés → entrées → départs"
                  : "Argent : clics pub → clics offre → inscriptions → premiers dépôts → dépôts → NGR"}
              </h3>
              <div
                className={
                  group === "telegram"
                    ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
                    : "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
                }
              >
                {dash.metrics
                  .filter((m) => m.group === group)
                  .map((m) => (
                    <Card key={m.key}>
                      <CardHeader className="pb-1">
                        <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                          {m.label}{" "}
                          {METRIC_HELP[m.key] ? (
                            <HelpTip label={`Définition : ${m.label}`}>
                              {METRIC_HELP[m.key]}
                            </HelpTip>
                          ) : null}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="flex items-end justify-between gap-2">
                        <div>
                          <p className="text-2xl font-semibold tabular-nums">
                            {fmtVal(m, m.series.total)}
                          </p>
                          {compare ? (
                            <p>
                              <Delta
                                value={deltaPct(m.series.total, prevMetric(m.key))}
                                invert={m.key === "left"}
                              />{" "}
                              <span className="text-[10px] text-muted-foreground">
                                (avant : {fmtVal(m, prevMetric(m.key))})
                              </span>
                            </p>
                          ) : null}
                        </div>
                        {period.days === 1 ? null : (
                          <Sparkline values={m.series.values} className="text-brand-ink" />
                        )}
                      </CardContent>
                    </Card>
                  ))}
              </div>
            </div>
          ))}

          {period.days > 1 ? (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  Demandes d&apos;adhésion par jour <HelpTip>{METRIC_HELP.requests}</HelpTip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Bars values={dash.metrics[0]!.series.values} keys={dash.keys} height={64} />
                <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                  <span>{dash.keys[0]}</span>
                  <span>{dash.keys[dash.keys.length - 1]}</span>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-base">Par canal ({label.toLowerCase()})</CardTitle>
            </CardHeader>
            <CardContent>
              {dash.channels.length === 0 ? (
                <EmptyState
                  title="Aucune activité sur la période"
                  description="Dès qu'un canal reçoit des demandes d'adhésion ou des clics, il apparaît ici."
                  action={{ href: "/channels", label: "Voir les canaux", variant: "outline" }}
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Canal</TableHead>
                      <Head k="requests" className="text-right">
                        Demandes
                      </Head>
                      <Head k="approved" className="hidden text-right md:table-cell">
                        Acceptés
                      </Head>
                      <Head k="joined" className="text-right">
                        Entrées
                      </Head>
                      <Head k="left" className="hidden text-right md:table-cell">
                        Départs
                      </Head>
                      <Head k="offerClicks" className="hidden text-right md:table-cell">
                        Clics offres
                      </Head>
                      <Head k="registrations" className="text-right">
                        Inscriptions
                      </Head>
                      <Head k="ftds" className="text-right">
                        FTD
                      </Head>
                      <Head k="depositAmount" className="hidden text-right md:table-cell">
                        Dépôts (€)
                      </Head>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dash.channels.map((r) => {
                      const pc = compare ? prevChannel(r.channelId) : null;
                      const d = (k: "requests" | "joined" | "registrations" | "ftds") =>
                        compare ? <Delta value={deltaPct(r[k], pc?.[k] ?? 0)} /> : null;
                      return (
                        <TableRow key={r.channelId}>
                          <TableCell>
                            <Link href={`/channels/${r.channelId}`} className="hover:underline">
                              {r.title}
                            </Link>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <div>{r.requests}</div>
                            {d("requests")}
                          </TableCell>
                          <TableCell className="hidden text-right tabular-nums md:table-cell">
                            {r.approved}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <div>{r.joined}</div>
                            {d("joined")}
                          </TableCell>
                          <TableCell className="hidden text-right tabular-nums md:table-cell">
                            {r.left}
                          </TableCell>
                          <TableCell className="hidden text-right tabular-nums md:table-cell">
                            {r.offerClicks}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <div>{r.registrations}</div>
                            {d("registrations")}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <div>{r.ftds}</div>
                            {d("ftds")}
                          </TableCell>
                          <TableCell className="hidden text-right tabular-nums md:table-cell">
                            {fmtMoney(r.depositAmount, "EUR", { digits: 0 })}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-base">Derniers événements</CardTitle>
            </CardHeader>
            <CardContent>
              {lastEvents.length === 0 ? (
                <EmptyState
                  title="Aucun événement pour l'instant"
                  description="Envoyez /start à un de vos bots ou publiez dans un canal : la première ligne apparaîtra ici."
                  action={{ href: "/bots", label: "Voir les bots", variant: "outline" }}
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Quand</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="hidden md:table-cell">Bot</TableHead>
                      <TableHead className="hidden md:table-cell">Canal</TableHead>
                      <TableHead>Membre</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lastEvents.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {fmtDate(e.occurredAt)}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">{e.label}</div>
                          <div className="font-mono text-[11px] text-muted-foreground">
                            {e.type}
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {e.bot ? `@${e.bot.username}` : "—"}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {e.channel?.title ?? "—"}
                        </TableCell>
                        <TableCell>
                          {e.member ? (
                            <Link href={`/members/${e.member.id}`} className="hover:underline">
                              {e.member.username ? `@${e.member.username}` : e.member.firstName}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                La liste complète, avec filtres et export, est dans le{" "}
                <Link href="/journal/events" className="underline underline-offset-2">
                  Journal (vue « Événements »)
                </Link>
                .
              </p>
            </CardContent>
          </Card>
        </>
      ) : null}
    </>
  );
}

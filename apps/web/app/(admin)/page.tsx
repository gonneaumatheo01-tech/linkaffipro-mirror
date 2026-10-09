import type { Metadata } from "next";
import Link from "next/link";
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
import { RANGE_LABELS, parseRange, type Range } from "@/lib/dashboard/aggregate";
import { loadDashboard } from "@/lib/dashboard/queries";
import {
  loadAdsTable,
  loadBestTimes,
  loadChannelGrowth,
  loadCohorts,
  loadFunnel,
} from "@/lib/dashboard/daily";
import { AdsTable, type AdsSortKey } from "@/components/dashboard/ads-table";
import { Funnel } from "@/components/dashboard/funnel";
import { Button } from "@/components/ui/button";
import { recomputeStatsAction } from "./dashboard/actions";

const TABS = [
  { key: "overview", label: "Vue d'ensemble" },
  { key: "ads", label: "Pubs" },
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
    "Les chiffres clés de la période choisie. Changez la période ou filtrez par univers et par canal en haut à droite.",
  ads: "Une ligne par pub : ce qu'elle a coûté et ce qu'elle a rapporté. Cliquez un en-tête de colonne pour trier.",
  funnel:
    "Le parcours complet, du clic sur la pub jusqu'au dépôt : à chaque étape, la part conservée et la perte.",
  cohorts:
    "Les membres regroupés par semaine d'arrivée : combien se sont inscrits, ont déposé, et ce qu'ils rapportent.",
  channels: "Croissance de chaque canal, meilleurs horaires et meilleures catégories de messages.",
};

export const metadata: Metadata = { title: "Tableau de bord" };

function since24h(): Date {
  return new Date(Date.now() - 24 * 3600 * 1000);
}

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
  const range = parseRange(one(sp.range));
  const verticalRaw = one(sp.vertical);
  const vertical = isVertical(verticalRaw) ? verticalRaw : "";
  const channelId = one(sp.channelId);
  const tab = parseTab(one(sp.tab));
  const sort = (one(sp.sort) || "spend") as AdsSortKey;
  const dir = one(sp.dir) === "asc" ? "asc" : "desc";
  const funnelDim = one(sp.dim) || (channelId ? `channel:${channelId}` : "all");
  const since = since24h();
  const [bots, channels, members, events24h, lastEvents, channelList, dash] = await Promise.all([
    prisma.bot.count({ where: { isActive: true } }),
    prisma.channel.count({ where: { isActive: true } }),
    prisma.member.count(),
    prisma.event.count({ where: { occurredAt: { gte: since } } }),
    prisma.event.findMany({
      orderBy: { occurredAt: "desc" },
      take: 12,
      include: {
        bot: { select: { username: true } },
        channel: { select: { title: true } },
        member: { select: { id: true, firstName: true, username: true } },
      },
    }),
    prisma.channel.findMany({
      where: { isActive: true },
      orderBy: { title: "asc" },
      select: { id: true, title: true },
    }),
    tab === "overview" ? loadDashboard({ range, vertical, channelId }) : Promise.resolve(null),
  ]);
  const [ads, funnelData, cohortRows, growth, best, campaignList] = await Promise.all([
    tab === "ads" ? loadAdsTable(range, { vertical }) : Promise.resolve(null),
    tab === "funnel" ? loadFunnel(funnelDim, range) : Promise.resolve(null),
    tab === "cohorts" ? loadCohorts(12) : Promise.resolve(null),
    tab === "channels" ? loadChannelGrowth(range, channelId) : Promise.resolve(null),
    tab === "channels" ? loadBestTimes(range, channelId) : Promise.resolve(null),
    tab === "funnel"
      ? prisma.campaign.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
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
    {
      label: "Événements (24 h)",
      value: events24h,
      help: "Tout ce qui s'est passé ces dernières 24 heures : demandes, entrées, clics, inscriptions… (page Journal).",
    },
  ];
  const base = { ...(vertical ? { vertical } : {}), ...(channelId ? { channelId } : {}) };
  const q = (r: Range, t: Tab = tab) =>
    `/?${new URLSearchParams({ tab: t, range: r, ...base, ...(t === "funnel" ? { dim: funnelDim } : {}) }).toString()}`;
  const sortHref = (k: AdsSortKey) =>
    `/?${new URLSearchParams({ tab: "ads", range, ...base, sort: k, dir: sort === k && dir === "desc" ? "asc" : "desc" }).toString()}`;
  const rangeBar = (
    <nav aria-label="Période" className="flex rounded-md border text-sm">
      {(Object.keys(RANGE_LABELS) as Range[]).map((r) => (
        <Link
          key={r}
          href={q(r)}
          aria-current={r === range ? "page" : undefined}
          className={`flex items-center px-3 py-2 md:py-1 ${r === range ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/50"}`}
        >
          {RANGE_LABELS[r]}
        </Link>
      ))}
    </nav>
  );
  const selectCls = "h-10 rounded-md border bg-background px-2 text-sm md:h-8";
  const fmtVal = (m: { money?: boolean }, v: number) =>
    m.money ? fmtMoney(v, "EUR", { digits: 0 }) : fmtNum(v);
  const pct = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0);

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        description="Ce que vos pubs, vos canaux et vos messages rapportent, en un coup d'œil."
        help={TAB_HELP[tab]}
      >
        <form method="get" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="range" value={range} />
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
            href={q(range, t.key)}
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
                {ads.lastComputedAt ? `le ${fmtDate(ads.lastComputedAt)}` : "jamais"} · comparés à
                la période précédente
              </span>
              <Button
                variant="outline"
                size="sm"
                className="max-md:h-10"
                render={
                  <a
                    href={`/dashboard/export?${new URLSearchParams({ range, ...(vertical ? { vertical } : {}) }).toString()}`}
                  />
                }
              >
                Exporter CSV
              </Button>
              <form action={recomputeStatsAction}>
                <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
                  Recalculer les statistiques
                </Button>
              </form>
            </div>
          </div>
          <Card>
            <CardContent className="pt-6">
              {ads.rows.length === 0 ? (
                <EmptyState
                  title="Aucune pub sur cette période"
                  description="Créez une pub dans la page Pubs et rattachez-lui son lien d'entrée : ses coûts et ses résultats apparaîtront ici."
                  action={{ href: "/campaigns/new", label: "Créer une pub" }}
                />
              ) : (
                <AdsTable
                  rows={ads.rows}
                  total={ads.total}
                  totalDerived={ads.totalDerived}
                  sort={sort}
                  dir={dir}
                  hrefFor={sortHref}
                />
              )}
            </CardContent>
          </Card>
          <p className="mt-2 text-xs text-muted-foreground">
            Coût par membre arrivé (CPL) = dépense ÷ membres entrés · coût par inscription (CPA) =
            dépense ÷ inscriptions · ROAS = revenu net (NGR) ÷ dépense · bénéfice = NGR − dépense.
            Les dépenses viennent des imports et saisies de la page Pubs. Survolez un « ? » pour la
            définition de chaque colonne.
          </p>
        </>
      ) : null}

      {tab === "funnel" && funnelData ? (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            {rangeBar}
            <form method="get" className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="tab" value="funnel" />
              <input type="hidden" name="range" value={range} />
              <select
                name="dim"
                aria-label="Afficher l'entonnoir pour"
                defaultValue={funnelDim}
                className={selectCls}
              >
                <option value="all">Tout</option>
                <optgroup label="Pubs">
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
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                Entonnoir ({RANGE_LABELS[range].toLowerCase()}){" "}
                <HelpTip>{METRIC_HELP.funnel}</HelpTip>
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
                <Funnel steps={funnelData.steps} />
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
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              Cohortes par semaine d&apos;arrivée (12 dernières semaines){" "}
              <HelpTip>{METRIC_HELP.cohort}</HelpTip>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {cohortRows.length === 0 ? (
              <EmptyState
                title="Aucun membre arrivé sur les 12 dernières semaines"
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
                      <TableCell className="text-right tabular-nums">{fmtNum(r.members)}</TableCell>
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
              Arrivée = première demande d&apos;adhésion. LTV (valeur par membre) = revenu net (NGR)
              cumulé des joueurs rattachés ÷ membres de la cohorte.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {tab === "channels" && growth && best ? (
        <>
          <div className="mb-3">{rangeBar}</div>
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
                          {fmtNum(g.requests)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtNum(g.joined)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNum(g.left)}</TableCell>
                        <TableCell
                          className={`text-right font-medium tabular-nums ${g.joined - g.left < 0 ? "text-red-600" : ""}`}
                        >
                          {g.joined - g.left > 0 ? "+" : ""}
                          {fmtNum(g.joined - g.left)}
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {dash.metrics.map((m) => (
              <Card key={m.key}>
                <CardHeader className="pb-1">
                  <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                    {m.label}{" "}
                    {METRIC_HELP[m.key] ? (
                      <HelpTip label={`Définition : ${m.label}`}>{METRIC_HELP[m.key]}</HelpTip>
                    ) : null}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex items-end justify-between gap-2">
                  <p className="text-2xl font-semibold tabular-nums">{fmtVal(m, m.series.total)}</p>
                  {range === "today" ? null : (
                    <Sparkline values={m.series.values} className="text-primary" />
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {range !== "today" ? (
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
              <CardTitle className="text-base">
                Par canal ({RANGE_LABELS[range].toLowerCase()})
              </CardTitle>
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
                    {dash.channels.map((r) => (
                      <TableRow key={r.channelId}>
                        <TableCell>
                          <Link href={`/channels/${r.channelId}`} className="hover:underline">
                            {r.title}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.requests}</TableCell>
                        <TableCell className="hidden text-right tabular-nums md:table-cell">
                          {r.approved}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.joined}</TableCell>
                        <TableCell className="hidden text-right tabular-nums md:table-cell">
                          {r.left}
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums md:table-cell">
                          {r.offerClicks}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.registrations}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.ftds}</TableCell>
                        <TableCell className="hidden text-right tabular-nums md:table-cell">
                          {fmtMoney(r.depositAmount, "EUR", { digits: 0 })}
                        </TableCell>
                      </TableRow>
                    ))}
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
                        <TableCell className="font-mono text-xs">{e.type}</TableCell>
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
                La liste complète, avec filtres, est dans la page Journal.
              </p>
            </CardContent>
          </Card>
        </>
      ) : null}
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { VERTICALS, VERTICAL_LABELS, isVertical } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { Bars, Sparkline } from "@/components/dashboard/sparkline";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtNum } from "@/lib/format";
import { RANGE_LABELS, parseRange, type Range } from "@/lib/dashboard/aggregate";
import { loadDashboard } from "@/lib/dashboard/queries";
import { loadAdsTable, loadBestTimes, loadChannelGrowth, loadCohorts, loadFunnel } from "@/lib/dashboard/daily";
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

export const metadata: Metadata = { title: "Tableau de bord" };

function since24h(): Date {
  return new Date(Date.now() - 24 * 3600 * 1000);
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

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
    prisma.event.findMany({ orderBy: { occurredAt: "desc" }, take: 12, include: { bot: { select: { username: true } }, channel: { select: { title: true } }, member: { select: { id: true, firstName: true, username: true } } } }),
    prisma.channel.findMany({ where: { isActive: true }, orderBy: { title: "asc" }, select: { id: true, title: true } }),
    tab === "overview" ? loadDashboard({ range, vertical, channelId }) : Promise.resolve(null),
  ]);
  const [ads, funnelData, cohortRows, growth, best, campaignList] = await Promise.all([
    tab === "ads" ? loadAdsTable(range, { vertical }) : Promise.resolve(null),
    tab === "funnel" ? loadFunnel(funnelDim, range) : Promise.resolve(null),
    tab === "cohorts" ? loadCohorts(12) : Promise.resolve(null),
    tab === "channels" ? loadChannelGrowth(range, channelId) : Promise.resolve(null),
    tab === "channels" ? loadBestTimes(range, channelId) : Promise.resolve(null),
    tab === "funnel" ? prisma.campaign.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const tiles = [
    { label: "Bots actifs", value: bots },
    { label: "Canaux", value: channels },
    { label: "Membres vus", value: members },
    { label: "Événements (24 h)", value: events24h },
  ];
  const base = { ...(vertical ? { vertical } : {}), ...(channelId ? { channelId } : {}) };
  const q = (r: Range, t: Tab = tab) => `/?${new URLSearchParams({ tab: t, range: r, ...base, ...(t === "funnel" ? { dim: funnelDim } : {}) }).toString()}`;
  const sortHref = (k: AdsSortKey) => `/?${new URLSearchParams({ tab: "ads", range, ...base, sort: k, dir: sort === k && dir === "desc" ? "asc" : "desc" }).toString()}`;
  const rangeBar = (
    <div className="flex rounded-md border text-sm">
      {(Object.keys(RANGE_LABELS) as Range[]).map((r) => (
        <Link key={r} href={q(r)} className={`px-3 py-1 ${r === range ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/50"}`}>{RANGE_LABELS[r]}</Link>
      ))}
    </div>
  );
  const selectCls = "h-8 rounded-md border bg-background px-2 text-sm";
  const fmtVal = (m: { money?: boolean }, v: number) => (m.money ? `${fmtNum(Math.round(v))} €` : fmtNum(v));

  return (
    <>
      <PageHeader title="Tableau de bord" description="Vue d'ensemble de la plateforme.">
        <form method="get" className="flex items-center gap-2">
          <input type="hidden" name="range" value={range} />
          <input type="hidden" name="tab" value={tab} />
          <select name="vertical" defaultValue={vertical} className={selectCls}>
            <option value="">Tous les univers</option>
            {VERTICALS.map((v) => <option key={v} value={v}>{VERTICAL_LABELS[v]}</option>)}
          </select>
          <select name="channelId" defaultValue={channelId} className={selectCls}>
            <option value="">Tous les canaux</option>
            {channelList.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
          <button type="submit" className="h-8 rounded-md border px-3 text-sm hover:bg-accent">OK</button>
        </form>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.forbidden ? "Cette page est réservée aux administrateurs." : sp.error} />

      <div className="mb-6 flex flex-wrap items-center gap-2 border-b">
        {TABS.map((t) => (
          <Link key={t.key} href={q(range, t.key)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${t.key === tab ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{t.label}</Link>
        ))}
      </div>

      {tab === "ads" && ads ? (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            {rangeBar}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Chiffres calculés {ads.lastComputedAt ? `le ${fmtDate(ads.lastComputedAt)}` : "jamais"} · comparés à la période précédente</span>
              <a href={`/dashboard/export?${new URLSearchParams({ range, ...(vertical ? { vertical } : {}) }).toString()}`} className="rounded-md border px-2 py-1 hover:bg-accent">Export CSV</a>
              <form action={recomputeStatsAction}><Button type="submit" size="sm" variant="outline">Recalculer les statistiques</Button></form>
            </div>
          </div>
          <Card>
            <CardContent className="overflow-x-auto pt-6">
              {ads.rows.length === 0 ? <p className="text-sm text-muted-foreground">Aucune pub : créez-en dans la page Pubs et rattachez vos liens d&apos;entrée.</p> : <AdsTable rows={ads.rows} total={ads.total} totalDerived={ads.totalDerived} sort={sort} dir={dir} hrefFor={sortHref} />}
            </CardContent>
          </Card>
          <p className="mt-2 text-xs text-muted-foreground">CPL = dépense / entrés · CPA = dépense / inscriptions · ROAS = NGR / dépense · bénéfice = NGR − dépense. Les dépenses viennent des imports et saisies de la page Pubs.</p>
        </>
      ) : null}

      {tab === "funnel" && funnelData ? (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            {rangeBar}
            <form method="get" className="flex items-center gap-2">
              <input type="hidden" name="tab" value="funnel" />
              <input type="hidden" name="range" value={range} />
              <select name="dim" defaultValue={funnelDim} className={selectCls}>
                <option value="all">Tout</option>
                <optgroup label="Pubs">{campaignList.map((c) => <option key={c.id} value={`campaign:${c.id}`}>{c.name}</option>)}</optgroup>
                <optgroup label="Canaux">{channelList.map((c) => <option key={c.id} value={`channel:${c.id}`}>{c.title}</option>)}</optgroup>
                <optgroup label="Univers">{VERTICALS.map((v) => <option key={v} value={`vertical:${v}`}>{VERTICAL_LABELS[v]}</option>)}</optgroup>
              </select>
              <button type="submit" className="h-8 rounded-md border px-3 text-sm hover:bg-accent">OK</button>
            </form>
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base">Entonnoir ({RANGE_LABELS[range].toLowerCase()})</CardTitle></CardHeader>
            <CardContent><Funnel steps={funnelData.steps} /></CardContent>
          </Card>
          <p className="mt-2 text-xs text-muted-foreground">Chaque étape affiche le pourcentage conservé par rapport à l&apos;étape précédente et la perte correspondante. Les dépôts peuvent dépasser les FTD (plusieurs dépôts par joueur).</p>
        </>
      ) : null}

      {tab === "cohorts" && cohortRows ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Cohortes par semaine d&apos;arrivée (12 dernières semaines)</CardTitle></CardHeader>
          <CardContent>
            {cohortRows.length === 0 ? <p className="text-sm text-muted-foreground">Aucun membre arrivé sur la période.</p> : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Semaine du</TableHead>
                    <TableHead className="text-right">Membres</TableHead>
                    <TableHead className="text-right">Inscrits</TableHead>
                    <TableHead className="text-right">FTD</TableHead>
                    <TableHead className="text-right">Dépôts J+7 (€)</TableHead>
                    <TableHead className="text-right">Dépôts J+30 (€)</TableHead>
                    <TableHead className="text-right">LTV moyenne (€)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cohortRows.map((r) => (
                    <TableRow key={r.week}>
                      <TableCell>{r.week}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(r.members)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(r.registered)} <span className="text-xs text-muted-foreground">({r.members ? Math.round((r.registered / r.members) * 100) : 0} %)</span></TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(r.ftd)} <span className="text-xs text-muted-foreground">({r.members ? Math.round((r.ftd / r.members) * 100) : 0} %)</span></TableCell>
                      <TableCell className="text-right tabular-nums">{r.deposits7.toLocaleString("fr-FR", { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.deposits30.toLocaleString("fr-FR", { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.ltv.toLocaleString("fr-FR", { minimumFractionDigits: 2 })}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <p className="mt-2 text-xs text-muted-foreground">Arrivée = première demande d&apos;adhésion. LTV = NGR cumulé des joueurs rattachés / membres de la cohorte.</p>
          </CardContent>
        </Card>
      ) : null}

      {tab === "channels" && growth && best ? (
        <>
          <div className="mb-3">{rangeBar}</div>
          <Card>
            <CardHeader><CardTitle className="text-base">Croissance nette par jour (entrées − départs)</CardTitle></CardHeader>
            <CardContent>
              {growth.length === 0 ? <p className="text-sm text-muted-foreground">Aucun canal actif.</p> : (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Canal</TableHead><TableHead>Tendance</TableHead><TableHead className="text-right">Demandes</TableHead><TableHead className="text-right">Entrées</TableHead><TableHead className="text-right">Départs</TableHead><TableHead className="text-right">Net</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {growth.map((g) => (
                      <TableRow key={g.channelId}>
                        <TableCell><Link href={`/channels/${g.channelId}`} className="hover:underline">{g.title}</Link></TableCell>
                        <TableCell><Bars values={g.net.map((v) => Math.max(0, v))} keys={g.keys} height={28} className="w-40" /></TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNum(g.requests)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNum(g.joined)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNum(g.left)}</TableCell>
                        <TableCell className={`text-right font-medium tabular-nums ${g.joined - g.left < 0 ? "text-red-600" : ""}`}>{g.joined - g.left > 0 ? "+" : ""}{fmtNum(g.joined - g.left)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Meilleurs horaires d&apos;envoi</CardTitle></CardHeader>
              <CardContent>
                {best.hours.length === 0 ? <p className="text-sm text-muted-foreground">Aucun message envoyé sur la période.</p> : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Heure (Paris)</TableHead><TableHead className="text-right">Messages</TableHead><TableHead className="text-right">Clics</TableHead><TableHead className="text-right">Clics / message</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {best.hours.slice(0, 8).map((h) => (
                        <TableRow key={h.hour}><TableCell>{String(h.hour).padStart(2, "0")}h</TableCell><TableCell className="text-right tabular-nums">{h.posts}</TableCell><TableCell className="text-right tabular-nums">{h.clicks}</TableCell><TableCell className="text-right font-medium tabular-nums">{h.clicksPerPost}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Meilleures catégories</CardTitle></CardHeader>
              <CardContent>
                {best.categories.length === 0 ? <p className="text-sm text-muted-foreground">Aucun message envoyé sur la période.</p> : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Catégorie</TableHead><TableHead className="text-right">Messages</TableHead><TableHead className="text-right">Clics</TableHead><TableHead className="text-right">Clics / message</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {best.categories.map((c) => (
                        <TableRow key={c.categoryId ?? "none"}><TableCell><span className="mr-2 inline-block size-2.5 rounded-full align-middle" style={{ backgroundColor: c.color }} />{c.name}</TableCell><TableCell className="text-right tabular-nums">{c.posts}</TableCell><TableCell className="text-right tabular-nums">{c.clicks}</TableCell><TableCell className="text-right font-medium tabular-nums">{c.clicksPerPost}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}

      {tab === "overview" && dash ? (<>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{t.label}</CardTitle></CardHeader>
            <CardContent><p className="text-3xl font-semibold tabular-nums">{fmtNum(t.value)}</p></CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-8 mb-3 flex items-center gap-2">
        <h2 className="text-lg font-semibold">Activité</h2>
        <div className="ml-2">{rangeBar}</div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {dash.metrics.map((m) => (
          <Card key={m.key}>
            <CardHeader className="pb-1"><CardTitle className="text-sm font-medium text-muted-foreground">{m.label}</CardTitle></CardHeader>
            <CardContent className="flex items-end justify-between gap-2">
              <p className="text-2xl font-semibold tabular-nums">{fmtVal(m, m.series.total)}</p>
              {range === "today" ? null : <Sparkline values={m.series.values} className="text-primary" />}
            </CardContent>
          </Card>
        ))}
      </div>

      {range !== "today" ? (
        <Card className="mt-6">
          <CardHeader><CardTitle className="text-base">Demandes d&apos;adhésion par jour</CardTitle></CardHeader>
          <CardContent>
            <Bars values={dash.metrics[0]!.series.values} keys={dash.keys} height={64} />
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>{dash.keys[0]}</span><span>{dash.keys[dash.keys.length - 1]}</span></div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Par canal ({RANGE_LABELS[range].toLowerCase()})</CardTitle></CardHeader>
        <CardContent>
          {dash.channels.length === 0 ? <p className="text-sm text-muted-foreground">Aucune activité sur la période.</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Canal</TableHead>
                  <TableHead className="text-right">Demandes</TableHead>
                  <TableHead className="text-right">Acceptés</TableHead>
                  <TableHead className="text-right">Entrées</TableHead>
                  <TableHead className="text-right">Départs</TableHead>
                  <TableHead className="text-right">Clics offres</TableHead>
                  <TableHead className="text-right">Inscriptions</TableHead>
                  <TableHead className="text-right">FTD</TableHead>
                  <TableHead className="text-right">Dépôts (€)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dash.channels.map((r) => (
                  <TableRow key={r.channelId}>
                    <TableCell><Link href={`/channels/${r.channelId}`} className="hover:underline">{r.title}</Link></TableCell>
                    <TableCell className="text-right tabular-nums">{r.requests}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.approved}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.joined}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.left}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.offerClicks}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.registrations}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.ftds}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(Math.round(r.depositAmount))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Derniers événements</CardTitle></CardHeader>
        <CardContent>
          {lastEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun événement pour l&apos;instant. Envoyez /start à un bot ou publiez dans un canal.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Quand</TableHead><TableHead>Type</TableHead><TableHead>Bot</TableHead><TableHead>Canal</TableHead><TableHead>Membre</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {lastEvents.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(e.occurredAt)}</TableCell>
                    <TableCell className="font-mono text-xs">{e.type}</TableCell>
                    <TableCell>{e.bot ? `@${e.bot.username}` : "—"}</TableCell>
                    <TableCell>{e.channel?.title ?? "—"}</TableCell>
                    <TableCell>{e.member ? <Link href={`/members/${e.member.id}`} className="hover:underline">{e.member.username ? `@${e.member.username}` : e.member.firstName}</Link> : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      </>) : null}
    </>
  );
}

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
  const since = since24h();
  const [bots, channels, members, events24h, lastEvents, channelList, dash] = await Promise.all([
    prisma.bot.count({ where: { isActive: true } }),
    prisma.channel.count({ where: { isActive: true } }),
    prisma.member.count(),
    prisma.event.count({ where: { occurredAt: { gte: since } } }),
    prisma.event.findMany({ orderBy: { occurredAt: "desc" }, take: 12, include: { bot: { select: { username: true } }, channel: { select: { title: true } }, member: { select: { id: true, firstName: true, username: true } } } }),
    prisma.channel.findMany({ where: { isActive: true }, orderBy: { title: "asc" }, select: { id: true, title: true } }),
    loadDashboard({ range, vertical, channelId }),
  ]);
  const tiles = [
    { label: "Bots actifs", value: bots },
    { label: "Canaux", value: channels },
    { label: "Membres vus", value: members },
    { label: "Événements (24 h)", value: events24h },
  ];
  const q = (r: Range) => `/?${new URLSearchParams({ range: r, ...(vertical ? { vertical } : {}), ...(channelId ? { channelId } : {}) }).toString()}`;
  const selectCls = "h-8 rounded-md border bg-background px-2 text-sm";
  const fmtVal = (m: { money?: boolean }, v: number) => (m.money ? `${fmtNum(Math.round(v))} €` : fmtNum(v));

  return (
    <>
      <PageHeader title="Tableau de bord" description="Vue d'ensemble de la plateforme.">
        <form method="get" className="flex items-center gap-2">
          <input type="hidden" name="range" value={range} />
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
      <Flash error={sp.forbidden ? "Cette page est réservée aux administrateurs." : undefined} />

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
        <div className="ml-2 flex rounded-md border text-sm">
          {(Object.keys(RANGE_LABELS) as Range[]).map((r) => (
            <Link key={r} href={q(r)} className={`px-3 py-1 ${r === range ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/50"}`}>{RANGE_LABELS[r]}</Link>
          ))}
        </div>
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
    </>
  );
}

import type { Metadata } from "next";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtNum } from "@/lib/format";

export const metadata: Metadata = { title: "Tableau de bord" };

function since24h(): Date {
  return new Date(Date.now() - 24 * 3600 * 1000);
}

export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const since = since24h();
  const [bots, channels, members, events24h, lastEvents] = await Promise.all([
    prisma.bot.count({ where: { isActive: true } }),
    prisma.channel.count({ where: { isActive: true } }),
    prisma.member.count(),
    prisma.event.count({ where: { occurredAt: { gte: since } } }),
    prisma.event.findMany({ orderBy: { occurredAt: "desc" }, take: 15, include: { bot: { select: { username: true } }, channel: { select: { title: true } }, member: { select: { firstName: true, username: true } } } }),
  ]);
  const tiles = [
    { label: "Bots actifs", value: bots },
    { label: "Canaux", value: channels },
    { label: "Membres vus", value: members },
    { label: "Événements (24 h)", value: events24h },
  ];
  return (
    <>
      <PageHeader title="Tableau de bord" description="Vue d'ensemble de la plateforme." />
      <Flash error={sp.forbidden ? "Cette page est réservée aux administrateurs." : undefined} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tabular-nums">{fmtNum(t.value)}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Derniers événements</CardTitle>
        </CardHeader>
        <CardContent>
          {lastEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun événement pour l&apos;instant. Envoyez /start à un bot ou publiez dans un canal.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quand</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Bot</TableHead>
                  <TableHead>Canal</TableHead>
                  <TableHead>Membre</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lastEvents.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(e.occurredAt)}</TableCell>
                    <TableCell className="font-mono text-xs">{e.type}</TableCell>
                    <TableCell>{e.bot ? `@${e.bot.username}` : "—"}</TableCell>
                    <TableCell>{e.channel?.title ?? "—"}</TableCell>
                    <TableCell>{e.member ? (e.member.username ? `@${e.member.username}` : e.member.firstName) : "—"}</TableCell>
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

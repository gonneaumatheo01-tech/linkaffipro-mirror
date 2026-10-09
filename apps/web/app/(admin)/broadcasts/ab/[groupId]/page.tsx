import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { describeSegment, parseSegment } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtNum } from "@/lib/format";
import { AB_MIN_SENT, ctr, fmtPct, pickWinner } from "@/lib/broadcasts/ab";
import { loadAbComparison } from "@/lib/broadcasts/ab-queries";
import { BROADCAST_STATUS_LABELS } from "@/lib/broadcasts/queries";
import { sendWinnerToRestAction } from "../../actions";

export const metadata: Metadata = { title: "Test A/B" };

export default async function AbComparisonPage({ params, searchParams }: PageProps<"/broadcasts/ab/[groupId]">) {
  const { groupId } = await params;
  const sp = await searchParams;
  const cmp = await loadAbComparison(groupId);
  if (!cmp) notFound();
  const [channels, inviteLinks, campaigns, categories] = await Promise.all([
    prisma.channel.findMany({ select: { id: true, title: true } }),
    prisma.inviteLink.findMany({ select: { id: true, name: true } }),
    prisma.campaign.findMany({ select: { id: true, name: true } }),
    prisma.messageCategory.findMany({ select: { id: true, name: true } }),
  ]);
  const toMap = (xs: Array<{ id: string; title?: string; name?: string }>) => Object.fromEntries(xs.map((x) => [x.id, x.title ?? x.name ?? x.id]));
  const winner = pickWinner(cmp.variants);
  const rows: Array<(typeof cmp.variants)[number] | (NonNullable<typeof cmp.rest> & { abSplit?: number | null })> = [...cmp.variants, ...(cmp.rest ? [cmp.rest] : [])];
  const metricRows: Array<[string, (v: (typeof rows)[number]) => string]> = [
    ["Statut", (v) => BROADCAST_STATUS_LABELS[v.status] ?? v.status],
    ["Ciblés", (v) => fmtNum(v.targeted)],
    ["Envoyés", (v) => fmtNum(v.sent)],
    ["Échoués", (v) => fmtNum(v.failed)],
    ["Bloqués", (v) => fmtNum(v.blocked)],
    ["Clics (boutons traqués)", (v) => fmtNum(v.clicks)],
    ["Cliqueurs uniques", (v) => fmtNum(v.uniqueClicks)],
    ["Clics offres", (v) => fmtNum(v.offerClicks)],
    ["Taux de clic (uniques / envoyés)", (v) => fmtPct(ctr(v))],
    ["Inscriptions rattachées", (v) => fmtNum(v.registrations)],
    ["FTD rattachés", (v) => fmtNum(v.ftds)],
  ];
  return (
    <>
      <PageHeader title={`Test A/B — ${cmp.name}`} description={`@${cmp.botUsername} · ${cmp.variants.length} versions comparées`}>
        <Button variant="outline" render={<Link href="/broadcasts" />}>
          Retour aux envois
        </Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Résultat</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {winner.status === "winner" ? (
            <p>
              Gagnante provisoire : <Badge>version {winner.variant}</Badge> avec un taux de clic de {fmtPct(winner.ctr)}.
            </p>
          ) : winner.status === "tie" ? (
            <p>Égalité entre les versions : attendez davantage d&apos;envois ou de clics.</p>
          ) : (
            <p className="text-muted-foreground">Pas encore significatif : il faut au moins {AB_MIN_SENT} envois par version (et des clics) pour désigner une gagnante.</p>
          )}
          {cmp.rest ? (
            <p>
              Envoi au reste du segment : <Link href={`/broadcasts/${cmp.rest.id}`} className="underline underline-offset-2">{cmp.rest.name}</Link> ({BROADCAST_STATUS_LABELS[cmp.rest.status] ?? cmp.rest.status}, {fmtNum(cmp.rest.sent)} envoyés).
            </p>
          ) : (
            <form action={sendWinnerToRestAction}>
              <input type="hidden" name="groupId" value={groupId} />
              <Button type="submit" disabled={winner.status !== "winner"}>
                Envoyer la version gagnante au reste du segment
              </Button>
              <p className="mt-1 text-xs text-muted-foreground">Crée un nouvel envoi avec le message gagnant vers les membres du segment qui n&apos;ont encore reçu aucune version.</p>
            </form>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Comparaison</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Indicateur</TableHead>
                  {rows.map((v) => (
                    <TableHead key={v.id} className="text-right">
                      <Link href={`/broadcasts/${v.id}`} className="underline-offset-2 hover:underline">
                        {v.variant === "REST" ? "Reste" : `Version ${v.variant}`}
                      </Link>
                      {v.variant !== "REST" && typeof v.abSplit === "number" ? <div className="text-xs font-normal text-muted-foreground">{v.abSplit} % des destinataires</div> : null}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {metricRows.map(([label, f]) => (
                  <TableRow key={label}>
                    <TableCell>{label}</TableCell>
                    {rows.map((v) => (
                      <TableCell key={v.id} className="text-right tabular-nums">
                        {f(v)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Destinataires</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">{describeSegment(parseSegment(cmp.segment), { channels: toMap(channels), inviteLinks: toMap(inviteLinks), campaigns: toMap(campaigns), categories: toMap(categories) })}</CardContent>
          </Card>
          {cmp.variants.map((v) => (
            <Card key={v.id}>
              <CardHeader>
                <CardTitle className="text-base">Version {v.variant}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 font-mono text-xs">{v.text}</div>
                <div className="text-xs text-muted-foreground">
                  créé le {fmtDate(v.createdAt)}
                  {v.finishedAt ? ` · terminé le ${fmtDate(v.finishedAt)}` : ""}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { VERTICAL_LABELS, type Vertical } from "@linkaffipro/core";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtNum } from "@/lib/format";
import { fmtEur, fmtRatio } from "@/lib/campaigns/metrics";
import { listCampaigns, rangeKeyOf, RANGES } from "@/lib/campaigns/queries";
import { requireUser } from "@/lib/session";
import { PLATFORM_LABELS, STATUS_LABELS } from "./campaign-form";

export const metadata: Metadata = { title: "Pubs" };

export default async function CampaignsPage({ searchParams }: PageProps<"/campaigns">) {
  await requireUser();
  const sp = await searchParams;
  const range = rangeKeyOf(sp.range);
  const rows = await listCampaigns(range);
  const totals = rows.reduce((t, r) => ({ spend: t.spend + r.metrics.spend, members: t.members + r.metrics.members, registrations: t.registrations + r.metrics.registrations, ftds: t.ftds + r.metrics.ftds, revenue: t.revenue + r.metrics.revenue }), { spend: 0, members: 0, registrations: 0, ftds: 0, revenue: 0 });

  return (
    <>
      <PageHeader title="Pubs" description="Coûts et rentabilité par pub : dépense, membres arrivés, inscriptions, FTD, CPL, CPA, ROAS.">
        <Button variant="outline" render={<Link href="/campaigns/import" />}>Importer un CSV</Button>
        <Button variant="outline" render={<Link href="/campaigns/imports" />}>Historique des imports</Button>
        <Button render={<Link href="/campaigns/new" />}>Nouvelle pub</Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      <div className="mb-4 flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Période :</span>
        {(Object.keys(RANGES) as Array<keyof typeof RANGES>).map((k) => (
          <Link key={k} href={`/campaigns?range=${k}`} className={`rounded-md border px-2 py-1 ${k === range ? "bg-accent font-medium" : "text-muted-foreground"}`}>{k} jours</Link>
        ))}
      </div>
      <Card>
        <CardContent className="pt-6">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune pub. Créez-en une, ou importez un CSV TikTok / Meta : les pubs seront créées automatiquement à partir des noms de campagne.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pub</TableHead>
                  <TableHead>Plateforme</TableHead>
                  <TableHead>Canaux</TableHead>
                  <TableHead className="text-right">Dépense</TableHead>
                  <TableHead className="text-right">Clics</TableHead>
                  <TableHead className="text-right">Membres</TableHead>
                  <TableHead className="text-right">Inscrits</TableHead>
                  <TableHead className="text-right">FTD</TableHead>
                  <TableHead className="text-right">CPL</TableHead>
                  <TableHead className="text-right">CPA</TableHead>
                  <TableHead className="text-right">Coût/FTD</TableHead>
                  <TableHead className="text-right">Revenu</TableHead>
                  <TableHead className="text-right">ROAS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link href={`/campaigns/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
                      <div className="text-xs text-muted-foreground">
                        {STATUS_LABELS[r.status] ?? r.status}{r.vertical ? ` · ${VERTICAL_LABELS[r.vertical as Vertical]}` : ""} · {r.links} lien{r.links > 1 ? "s" : ""}
                      </div>
                    </TableCell>
                    <TableCell>{r.adPlatform ? <Badge variant="outline">{PLATFORM_LABELS[r.adPlatform]}</Badge> : "—"}</TableCell>
                    <TableCell className="text-xs">{r.channels.join(", ") || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtEur(r.metrics.spend)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(r.metrics.entryClicks ?? 0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(r.metrics.members)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(r.metrics.registrations)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(r.metrics.ftds)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtEur(r.metrics.cpl)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtEur(r.metrics.cpa)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtEur(r.metrics.costPerFtd)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtEur(r.metrics.revenue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtRatio(r.metrics.roas)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-medium">
                  <TableCell colSpan={3}>Total</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtEur(totals.spend)}</TableCell>
                  <TableCell />
                  <TableCell className="text-right tabular-nums">{fmtNum(totals.members)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(totals.registrations)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(totals.ftds)}</TableCell>
                  <TableCell colSpan={3} />
                  <TableCell className="text-right tabular-nums">{fmtEur(totals.revenue)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtRatio(totals.spend > 0 ? totals.revenue / totals.spend : null)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <p className="mt-3 text-xs text-muted-foreground">Membres = demandes acceptées via les liens d&apos;entrée de la pub. Inscrits / FTD / revenu = joueurs rattachés par sub-ID aux clics des liens de la pub (revenu = NGR). CPL = dépense / membres, CPA = dépense / inscrits, ROAS = revenu / dépense.</p>
    </>
  );
}

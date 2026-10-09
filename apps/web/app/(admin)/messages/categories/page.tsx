import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtNum } from "@/lib/format";
import { RANGE_DAYS, groupByCategory, sinceFor, withAverages } from "@/lib/posts/category-stats";

export const metadata: Metadata = { title: "Comparer par catégorie" };

function n(v: number): string {
  return Number.isInteger(v) ? fmtNum(v) : v.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

export default async function CategoryComparisonPage({ searchParams }: PageProps<"/messages/categories">) {
  const sp = await searchParams;
  const range = typeof sp.range === "string" && sp.range in RANGE_DAYS ? sp.range : "30d";
  const channelId = typeof sp.channel === "string" ? sp.channel : "";
  const since = sinceFor(range);
  const [channels, categories, posts] = await Promise.all([
    prisma.channel.findMany({ where: { isActive: true }, orderBy: { title: "asc" }, select: { id: true, title: true } }),
    prisma.messageCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, color: true } }),
    prisma.post.findMany({
      where: { status: "SENT", isTemplate: false, sentAt: { gte: since }, ...(channelId ? { channelId } : {}) },
      select: { categoryId: true, stats: { select: { clicks: true, uniqueClickers: true, offerClicks: true, reactionsTotal: true, registrations: true, ftds: true, deposits: true, depositAmount: true } } },
    }),
  ]);
  const rows = withAverages(groupByCategory(posts, categories));
  const selectCls = "h-8 rounded-md border bg-background px-2 text-sm";
  const metrics: Array<[string, keyof (typeof rows)[number]["avg"]]> = [["Clics", "clicks"], ["Clics uniques", "uniqueClickers"], ["Clics offres", "offerClicks"], ["Réactions", "reactions"], ["Inscriptions", "registrations"], ["FTD", "ftds"], ["Dépôts", "deposits"], ["Montant déposé (€)", "depositAmount"]];

  return (
    <>
      <PageHeader title="Comparer par catégorie" description="Messages envoyés sur la période, totaux et moyennes par message. Les inscriptions, FTD et dépôts viennent des joueurs rattachés par sub-ID.">
        <Button variant="ghost" size="sm" render={<Link href="/messages?view=list" />}>← Messages</Button>
      </PageHeader>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{posts.length} message{posts.length > 1 ? "s" : ""} envoyé{posts.length > 1 ? "s" : ""}</CardTitle>
          <CardDescription>
            <form method="get" className="mt-2 flex flex-wrap items-center gap-2">
              <select name="range" defaultValue={range} className={selectCls}>
                <option value="7d">7 derniers jours</option>
                <option value="30d">30 derniers jours</option>
                <option value="90d">90 derniers jours</option>
              </select>
              <select name="channel" defaultValue={channelId} className={selectCls}>
                <option value="">Tous les canaux</option>
                {channels.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
              <Button type="submit" size="sm" variant="outline">Appliquer</Button>
            </form>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun message envoyé sur la période.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Catégorie</TableHead>
                    <TableHead className="text-right">Messages</TableHead>
                    {metrics.map(([label]) => (
                      <TableHead key={label} className="text-right whitespace-nowrap">{label}<div className="text-[10px] font-normal text-muted-foreground">total · par message</div></TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.categoryId ?? "none"} className={r.posts === 0 ? "text-muted-foreground" : ""}>
                      <TableCell><span className="inline-flex items-center gap-2"><span className="inline-block size-2.5 rounded-full" style={{ background: r.color }} />{r.name}</span></TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(r.posts)}</TableCell>
                      {metrics.map(([label, key]) => (
                        <TableCell key={label} className="text-right tabular-nums whitespace-nowrap">
                          {n(r[key])} <span className="text-xs text-muted-foreground">· {n(r.avg[key])}</span>
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

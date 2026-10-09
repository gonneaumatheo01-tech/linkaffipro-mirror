import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { EmptyState } from "@/components/admin/empty-state";
import { HelpTip } from "@/components/admin/help-tip";
import { METRIC_HELP } from "@/components/dashboard/metric-help";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtNum } from "@/lib/format";
import { RANGE_DAYS, groupByCategory, sinceFor, withAverages } from "@/lib/posts/category-stats";

export const metadata: Metadata = { title: "Comparer par catégorie" };

function n(v: number): string {
  return Number.isInteger(v) ? fmtNum(v) : v.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

export default async function CategoryComparisonPage({
  searchParams,
}: PageProps<"/messages/categories">) {
  const sp = await searchParams;
  const range = typeof sp.range === "string" && sp.range in RANGE_DAYS ? sp.range : "30d";
  const channelId = typeof sp.channel === "string" ? sp.channel : "";
  const since = sinceFor(range);
  const [channels, categories, posts] = await Promise.all([
    prisma.channel.findMany({
      where: { isActive: true },
      orderBy: { title: "asc" },
      select: { id: true, title: true },
    }),
    prisma.messageCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, color: true },
    }),
    prisma.post.findMany({
      where: {
        status: "SENT",
        isTemplate: false,
        sentAt: { gte: since },
        ...(channelId ? { channelId } : {}),
      },
      select: {
        categoryId: true,
        stats: {
          select: {
            clicks: true,
            uniqueClickers: true,
            offerClicks: true,
            reactionsTotal: true,
            registrations: true,
            ftds: true,
            deposits: true,
            depositAmount: true,
          },
        },
      },
    }),
  ]);
  const rows = withAverages(groupByCategory(posts, categories));
  const selectCls = "h-10 rounded-md border bg-background px-2 text-sm md:h-8";
  const metrics: Array<[string, keyof (typeof rows)[number]["avg"], string]> = [
    ["Clics", "clicks", "clicks"],
    ["Clics uniques", "uniqueClickers", "uniqueClickers"],
    ["Clics offres", "offerClicks", "offerClicks"],
    ["Réactions", "reactions", "reactions"],
    ["Inscriptions", "registrations", "registrations"],
    ["FTD", "ftds", "ftds"],
    ["Dépôts", "deposits", "deposits"],
    ["Montant déposé (€)", "depositAmount", "depositAmount"],
  ];

  return (
    <>
      <PageHeader
        title="Comparer par catégorie"
        description="Quelles catégories de messages (bonus, pronostic, rappel…) font le plus cliquer, s'inscrire et déposer."
        help="Choisissez une période et éventuellement un canal, puis cliquez « Appliquer ». Chaque colonne donne le total et la moyenne par message."
      >
        <Button
          variant="ghost"
          size="sm"
          className="max-md:h-10"
          render={<Link href="/messages?view=list" />}
        >
          ← Messages
        </Button>
      </PageHeader>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {posts.length} message{posts.length > 1 ? "s" : ""} envoyé{posts.length > 1 ? "s" : ""}
          </CardTitle>
          <form method="get" className="mt-2 flex flex-wrap items-center gap-2">
            <select name="range" aria-label="Période" defaultValue={range} className={selectCls}>
              <option value="7d">7 derniers jours</option>
              <option value="30d">30 derniers jours</option>
              <option value="90d">90 derniers jours</option>
            </select>
            <select
              name="channel"
              aria-label="Canal"
              defaultValue={channelId}
              className={selectCls}
            >
              <option value="">Tous les canaux</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
              Appliquer
            </Button>
          </form>
        </CardHeader>
        <CardContent>
          {rows.length === 0 || posts.length === 0 ? (
            <EmptyState
              title="Aucun message envoyé sur la période"
              description="Donnez une catégorie à vos messages lors de leur création : vous pourrez ensuite comparer ce qui marche le mieux."
              action={{ href: "/messages/new", label: "Nouveau message", variant: "outline" }}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Catégorie</TableHead>
                  <TableHead className="text-right">Messages</TableHead>
                  {metrics.map(([label, , helpKey]) => (
                    <TableHead key={label} className="text-right whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        {label}
                        {METRIC_HELP[helpKey] ? (
                          <HelpTip label={`Définition : ${label}`}>{METRIC_HELP[helpKey]}</HelpTip>
                        ) : null}
                      </span>
                      <div className="text-[10px] font-normal text-muted-foreground">
                        total · par message
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={r.categoryId ?? "none"}
                    className={r.posts === 0 ? "text-muted-foreground" : ""}
                  >
                    <TableCell className="whitespace-nowrap">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="inline-block size-2.5 rounded-full"
                          style={{ background: r.color }}
                          aria-hidden="true"
                        />
                        {r.name}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(r.posts)}</TableCell>
                    {metrics.map(([label, key]) => (
                      <TableCell key={label} className="text-right tabular-nums whitespace-nowrap">
                        {n(r[key])}{" "}
                        <span className="text-xs text-muted-foreground">· {n(r.avg[key])}</span>
                      </TableCell>
                    ))}
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

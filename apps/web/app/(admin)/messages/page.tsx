import type { Metadata } from "next";
import Link from "next/link";
import { prisma, type PostStatus } from "@linkaffipro/db";
import { stripHtml } from "@linkaffipro/core";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { Pagination, pageHref, pageOf } from "@/components/admin/pagination";
import { WeekCalendar } from "@/components/messages/week-calendar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate } from "@/lib/format";
import { listPosts, POST_STATUS_LABELS, POST_STATUS_VARIANT } from "@/lib/posts/queries";
import { addDays, fromParisLocal, startOfParisWeek, toParisLocalInput } from "@/lib/posts/time";

export const metadata: Metadata = { title: "Messages" };

const STATUSES = Object.keys(POST_STATUS_LABELS) as PostStatus[];

export default async function MessagesPage({ searchParams }: PageProps<"/messages">) {
  const sp = await searchParams;
  const view = sp.view === "list" ? "list" : sp.view === "templates" ? "templates" : "calendar";
  const weekParam = typeof sp.week === "string" ? fromParisLocal(`${sp.week}T00:00`) : null;
  const weekStart = startOfParisWeek(weekParam ?? new Date());
  const weekEnd = addDays(weekStart, 7);
  const [channels, categories] = await Promise.all([
    prisma.channel.findMany({ where: { isActive: true }, orderBy: { title: "asc" }, select: { id: true, title: true } }),
    prisma.messageCategory.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, color: true } }),
  ]);

  const f = { channelId: typeof sp.channel === "string" ? sp.channel : "", status: typeof sp.status === "string" ? sp.status : "", categoryId: typeof sp.category === "string" ? sp.category : "", from: typeof sp.from === "string" ? sp.from : "", to: typeof sp.to === "string" ? sp.to : "" };

  const page = pageOf(sp);
  const listed = view === "calendar" ? null : await listPosts({ view, filters: f, page });
  const posts =
    view === "calendar"
      ? await prisma.post.findMany({ where: { isTemplate: false, scheduledAt: { gte: weekStart, lt: weekEnd } }, orderBy: { scheduledAt: "asc" }, include: { channel: { select: { title: true } }, category: { select: { name: true, color: true } } } })
      : listed!.rows;

  const weekKey = toParisLocalInput(weekStart).slice(0, 10);
  const prevWeek = toParisLocalInput(addDays(weekStart, -7)).slice(0, 10);
  const nextWeek = toParisLocalInput(addDays(weekStart, 7)).slice(0, 10);
  const tabCls = (v: string) => `rounded-md px-3 py-1.5 text-sm ${view === v ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`;
  const selectCls = "h-8 rounded-md border bg-background px-2 text-sm";

  return (
    <>
      <PageHeader title="Messages" description="Messages programmés dans les canaux, avec boutons traqués et offres personnalisées.">
        <Button variant="outline" size="sm" render={<Link href="/messages/categories" />}>Comparer par catégorie</Button>
        <Button render={<Link href="/messages/new" />}>Nouveau message</Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href="/messages?view=calendar" className={tabCls("calendar")}>Calendrier</Link>
        <Link href="/messages?view=list" className={tabCls("list")}>Liste</Link>
        <Link href="/messages?view=templates" className={tabCls("templates")}>Modèles</Link>
      </div>

      {view === "calendar" ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <Button size="sm" variant="outline" render={<Link href={`/messages?view=calendar&week=${prevWeek}`} />}>← Semaine précédente</Button>
            <span className="font-medium">Semaine du {fmtDate(weekStart).slice(0, 8)}</span>
            <Button size="sm" variant="outline" render={<Link href={`/messages?view=calendar&week=${nextWeek}`} />}>Semaine suivante →</Button>
            <Button size="sm" variant="ghost" render={<Link href="/messages?view=calendar" />}>Aujourd&apos;hui</Button>
            <span className="text-muted-foreground">({posts.length} message{posts.length > 1 ? "s" : ""}, semaine {weekKey})</span>
          </div>
          <WeekCalendar weekStart={weekStart} posts={posts} />
        </div>
      ) : (
        <Card>
          <CardContent className="pt-6">
            {view === "list" ? (
              <form method="get" className="mb-4 flex flex-wrap items-end gap-2 text-sm">
                <input type="hidden" name="view" value="list" />
                {/* Changer un filtre ramène à la page 1 (pas de champ « page » dans ce formulaire). */}
                <select name="channel" defaultValue={f.channelId} className={selectCls}><option value="">Tous les canaux</option>{channels.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select>
                <select name="status" defaultValue={f.status} className={selectCls}><option value="">Tous les statuts</option>{STATUSES.map((s) => <option key={s} value={s}>{POST_STATUS_LABELS[s]}</option>)}</select>
                <select name="category" defaultValue={f.categoryId} className={selectCls}><option value="">Toutes les catégories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                <input type="date" name="from" defaultValue={f.from} className={selectCls} />
                <input type="date" name="to" defaultValue={f.to} className={selectCls} />
                <Button type="submit" size="sm" variant="outline">Filtrer</Button>
              </form>
            ) : null}
            {posts.length === 0 ? (
              <p className="text-sm text-muted-foreground">{view === "templates" ? "Aucun modèle. Depuis un message, cliquez « Enregistrer comme modèle »." : "Aucun message."}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{view === "templates" ? "Modèle" : "Date"}</TableHead>
                    <TableHead>Canal</TableHead>
                    <TableHead>Catégorie</TableHead>
                    <TableHead>Texte</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {posts.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="whitespace-nowrap">{view === "templates" ? p.templateName : fmtDate(p.scheduledAt)}</TableCell>
                      <TableCell>{p.channel.title}</TableCell>
                      <TableCell>{p.category ? <span className="inline-flex items-center gap-1"><span className="inline-block size-2 rounded-full" style={{ background: p.category.color }} />{p.category.name}</span> : "—"}</TableCell>
                      <TableCell className="max-w-md truncate text-muted-foreground">{stripHtml(p.text).slice(0, 80) || "(média)"}</TableCell>
                      <TableCell>{view === "templates" ? null : <Badge variant={POST_STATUS_VARIANT[p.status]}>{POST_STATUS_LABELS[p.status]}</Badge>}</TableCell>
                      <TableCell className="text-right">
                        {view === "templates" ? (
                          <Button size="sm" variant="outline" render={<Link href={`/messages/new?from=${p.id}`} />}>Nouveau depuis ce modèle</Button>
                        ) : (
                          <Button size="sm" variant="ghost" render={<Link href={`/messages/${p.id}`} />}>Ouvrir</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {listed ? <Pagination page={page} pages={listed.pages} total={listed.total} noun={view === "templates" ? "modèle" : "message"} hrefFor={(p) => pageHref("/messages", { ...sp, view, ok: undefined, error: undefined }, p)} /> : null}
          </CardContent>
        </Card>
      )}
    </>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { prisma, type PostStatus } from "@linkaffipro/db";
import { stripHtml, VERTICAL_LABELS, VERTICALS } from "@linkaffipro/core";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { EmptyState } from "@/components/admin/empty-state";
import { Pagination, pageHref, pageOf } from "@/components/admin/pagination";
import { RememberFilters } from "@/components/admin/remember-filters";
import { listCampaignOptions } from "@/lib/campaigns/queries";
import { WeekCalendar } from "@/components/messages/week-calendar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDate } from "@/lib/format";
import { listPosts, POST_STATUS_LABELS } from "@/lib/posts/queries";
import { addDays, fromParisLocal, startOfParisWeek, toParisLocalInput } from "@/lib/posts/time";
import { StatusBadge } from "@/lib/status-badges";

export const metadata: Metadata = { title: "Messages" };

const STATUSES = Object.keys(POST_STATUS_LABELS) as PostStatus[];

const VIEW_HELP = {
  calendar:
    "Le calendrier de la semaine, heure par heure. Cliquez un message pour l'ouvrir ; « Nouveau message » pour en programmer un.",
  list: "Tous les messages, avec filtres par canal, statut, catégorie et dates. « Exporter CSV » télécharge la liste filtrée avec les statistiques.",
  templates:
    "Vos modèles : des messages prêts à réutiliser, classés par univers et catégorie. Cliquez « Utiliser ce modèle » pour créer un message pré-rempli.",
} as const;

export default async function MessagesPage({ searchParams }: PageProps<"/messages">) {
  const sp = await searchParams;
  const view = sp.view === "list" ? "list" : sp.view === "templates" ? "templates" : "calendar";
  const weekParam = typeof sp.week === "string" ? fromParisLocal(`${sp.week}T00:00`) : null;
  const weekStart = startOfParisWeek(weekParam ?? new Date());
  const weekEnd = addDays(weekStart, 7);
  const [channels, categories, campaigns] = await Promise.all([
    prisma.channel.findMany({
      where: { isActive: true },
      orderBy: { title: "asc" },
      select: { id: true, title: true },
    }),
    prisma.messageCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, color: true },
    }),
    listCampaignOptions(),
  ]);

  const f = {
    channelId: typeof sp.channel === "string" ? sp.channel : "",
    campaignId: typeof sp.campaign === "string" ? sp.campaign : "",
    status: typeof sp.status === "string" ? sp.status : "",
    categoryId: typeof sp.category === "string" ? sp.category : "",
    from: typeof sp.from === "string" ? sp.from : "",
    to: typeof sp.to === "string" ? sp.to : "",
    vertical: typeof sp.vertical === "string" ? sp.vertical : "",
  };
  const hasFilters = Boolean(
    f.channelId || f.campaignId || f.status || f.categoryId || f.from || f.to || f.vertical,
  );
  const exportHref = `/messages/export?${new URLSearchParams({ ...(f.channelId ? { channel: f.channelId } : {}), ...(f.campaignId ? { campaign: f.campaignId } : {}), ...(f.status ? { status: f.status } : {}), ...(f.categoryId ? { category: f.categoryId } : {}), ...(f.from ? { from: f.from } : {}), ...(f.to ? { to: f.to } : {}) }).toString()}`;

  const page = pageOf(sp);
  const listed = view === "calendar" ? null : await listPosts({ view, filters: f, page });
  const posts =
    view === "calendar"
      ? await prisma.post.findMany({
          where: { isTemplate: false, scheduledAt: { gte: weekStart, lt: weekEnd } },
          orderBy: { scheduledAt: "asc" },
          include: {
            channel: { select: { title: true } },
            category: { select: { name: true, color: true } },
          },
        })
      : listed!.rows;

  const weekKey = toParisLocalInput(weekStart).slice(0, 10);
  const prevWeek = toParisLocalInput(addDays(weekStart, -7)).slice(0, 10);
  const nextWeek = toParisLocalInput(addDays(weekStart, 7)).slice(0, 10);
  const tabCls = (v: string) =>
    `flex items-center rounded-md px-3 py-2 text-sm md:py-1.5 ${view === v ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`;
  const selectCls = "h-10 rounded-md border bg-background px-2 text-sm md:h-8";

  return (
    <>
      <PageHeader
        title="Messages"
        description="Les messages publiés par vos bots dans les canaux : programmés à l'avance, avec boutons traqués et offres personnalisées."
        help={VIEW_HELP[view]}
      >
        <Button
          variant="outline"
          size="sm"
          className="max-md:h-10"
          render={<Link href="/messages/categories" />}
        >
          Comparer par catégorie
        </Button>
        <Button className="max-md:h-10" render={<Link href="/messages/new" />}>
          Nouveau message
        </Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      <nav aria-label="Vue" className="mb-4 flex flex-wrap items-center gap-2">
        <Link
          href="/messages?view=calendar"
          aria-current={view === "calendar" ? "page" : undefined}
          className={tabCls("calendar")}
        >
          Calendrier
        </Link>
        <Link
          href="/messages?view=list"
          aria-current={view === "list" ? "page" : undefined}
          className={tabCls("list")}
        >
          Liste
        </Link>
        <Link
          href="/messages?view=templates"
          aria-current={view === "templates" ? "page" : undefined}
          className={tabCls("templates")}
        >
          Modèles
        </Link>
      </nav>

      {view === "calendar" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Button
              size="sm"
              variant="outline"
              className="max-md:h-10"
              render={<Link href={`/messages?view=calendar&week=${prevWeek}`} />}
            >
              ← Semaine précédente
            </Button>
            <span className="font-medium">Semaine du {fmtDate(weekStart).slice(0, 8)}</span>
            <Button
              size="sm"
              variant="outline"
              className="max-md:h-10"
              render={<Link href={`/messages?view=calendar&week=${nextWeek}`} />}
            >
              Semaine suivante →
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="max-md:h-10"
              render={<Link href="/messages?view=calendar" />}
            >
              Aujourd&apos;hui
            </Button>
            <span className="text-muted-foreground">
              ({posts.length} message{posts.length > 1 ? "s" : ""}, semaine {weekKey})
            </span>
          </div>
          {posts.length === 0 ? (
            <EmptyState
              title="Aucun message cette semaine"
              description="Programmez un message : choisissez les canaux, écrivez le texte, ajoutez des boutons, puis une date et une heure."
              action={{ href: "/messages/new", label: "Nouveau message" }}
            />
          ) : null}
          <WeekCalendar weekStart={weekStart} posts={posts} />
        </div>
      ) : (
        <Card>
          <CardContent className="pt-6">
            {view === "list" ? (
              <form
                method="get"
                className="mb-4 grid gap-2 text-sm sm:grid-cols-2 md:flex md:flex-wrap md:items-end"
              >
                <input type="hidden" name="view" value="list" />
                {/* Changer un filtre ramène à la page 1 (pas de champ « page » dans ce formulaire). */}
                <select
                  name="channel"
                  aria-label="Canal"
                  defaultValue={f.channelId}
                  className={selectCls}
                >
                  <option value="">Tous les canaux</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
                <select
                  name="campaign"
                  aria-label="Campagne"
                  title="Messages des canaux de la campagne ou portant un bouton Offre vers une de ses offres"
                  defaultValue={f.campaignId}
                  className={selectCls}
                >
                  <option value="">Toutes les campagnes</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select
                  name="status"
                  aria-label="Statut"
                  defaultValue={f.status}
                  className={selectCls}
                >
                  <option value="">Tous les statuts</option>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {POST_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
                <select
                  name="category"
                  aria-label="Catégorie"
                  defaultValue={f.categoryId}
                  className={selectCls}
                >
                  <option value="">Toutes les catégories</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  name="from"
                  aria-label="Du"
                  defaultValue={f.from}
                  className={selectCls}
                />
                <input
                  type="date"
                  name="to"
                  aria-label="Au"
                  defaultValue={f.to}
                  className={selectCls}
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
                    Filtrer
                  </Button>
                  <Suspense fallback={null}>
                    <RememberFilters storageKey="messages" />
                  </Suspense>
                  <Button
                    size="sm"
                    variant="outline"
                    className="max-md:h-10"
                    render={<a href={exportHref} />}
                  >
                    Exporter CSV
                  </Button>
                </div>
              </form>
            ) : null}
            {view === "templates" ? (
              <form
                method="get"
                className="mb-4 grid gap-2 text-sm sm:grid-cols-2 md:flex md:flex-wrap md:items-end"
              >
                <input type="hidden" name="view" value="templates" />
                <select
                  name="vertical"
                  aria-label="Univers"
                  defaultValue={f.vertical}
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
                  name="category"
                  aria-label="Catégorie"
                  defaultValue={f.categoryId}
                  className={selectCls}
                >
                  <option value="">Toutes les catégories</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
                  Filtrer
                </Button>
              </form>
            ) : null}
            {posts.length === 0 ? (
              view === "templates" ? (
                hasFilters ? (
                  <EmptyState
                    title="Aucun modèle pour ces filtres"
                    description="Changez d'univers ou de catégorie, ou retirez les filtres."
                    action={{
                      href: "/messages?view=templates",
                      label: "Tous les modèles",
                      variant: "outline",
                    }}
                  />
                ) : (
                  <EmptyState
                    title="Aucun modèle"
                    description="Ouvrez un message et cliquez « Enregistrer comme modèle » : vous pourrez le réutiliser en un clic. Des modèles prêts à l'emploi par univers peuvent aussi être installés (pnpm seed:templates)."
                    action={{
                      href: "/messages?view=list",
                      label: "Voir les messages",
                      variant: "outline",
                    }}
                  />
                )
              ) : hasFilters ? (
                <EmptyState
                  title="Aucun message ne correspond à ces filtres"
                  description="Élargissez les dates ou retirez un filtre."
                  action={{
                    href: "/messages?view=list",
                    label: "Réinitialiser les filtres",
                    variant: "outline",
                  }}
                />
              ) : (
                <EmptyState
                  title="Aucun message pour l'instant"
                  description="Programmez votre premier message : choisissez les canaux, écrivez le texte, ajoutez des boutons, puis une date et une heure."
                  action={{ href: "/messages/new", label: "Nouveau message" }}
                />
              )
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{view === "templates" ? "Modèle" : "Date"}</TableHead>
                    <TableHead>{view === "templates" ? "Univers" : "Canal"}</TableHead>
                    <TableHead className="hidden md:table-cell">Catégorie</TableHead>
                    <TableHead className="hidden md:table-cell">Texte</TableHead>
                    {view === "templates" ? null : <TableHead>Statut</TableHead>}
                    <TableHead className="text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {posts.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="whitespace-nowrap">
                        {view === "templates" ? p.templateName : fmtDate(p.scheduledAt)}
                        {p.abGroupId ? (
                          <Link
                            href={`/messages/ab/${p.abGroupId}`}
                            className="ml-2 inline-flex"
                            title="Voir la comparaison A/B"
                          >
                            <Badge variant="outline">
                              A/B{p.abVariant ? ` · ${p.abVariant}` : ""}
                            </Badge>
                          </Link>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {view === "templates"
                          ? p.vertical
                            ? VERTICAL_LABELS[p.vertical]
                            : "—"
                          : p.channel.title}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {p.category ? (
                          <span className="inline-flex items-center gap-1">
                            <span
                              className="inline-block size-2 rounded-full"
                              style={{ background: p.category.color }}
                              aria-hidden="true"
                            />
                            {p.category.name}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="hidden max-w-md truncate text-muted-foreground md:table-cell">
                        {stripHtml(p.text).slice(0, 80) || "(média)"}
                      </TableCell>
                      {view === "templates" ? null : (
                        <TableCell>
                          <StatusBadge kind="post" value={p.status} />
                        </TableCell>
                      )}
                      <TableCell className="text-right">
                        {view === "templates" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="max-md:h-10"
                            render={<Link href={`/messages/new?from=${p.id}`} />}
                          >
                            Utiliser ce modèle
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="max-md:h-10"
                            render={<Link href={`/messages/${p.id}`} />}
                          >
                            Ouvrir
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {listed ? (
              <Pagination
                page={page}
                pages={listed.pages}
                total={listed.total}
                noun={view === "templates" ? "modèle" : "message"}
                hrefFor={(p) =>
                  pageHref("/messages", { ...sp, view, ok: undefined, error: undefined }, p)
                }
              />
            ) : null}
          </CardContent>
        </Card>
      )}
    </>
  );
}

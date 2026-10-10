import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { EmptyState } from "@/components/admin/empty-state";
import {
  PAGE_SIZE,
  Pagination,
  pageCount,
  pageHref,
  pageSkip,
} from "@/components/admin/pagination";
import { RememberFilters } from "@/components/admin/remember-filters";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDate, fmtNum } from "@/lib/format";
import { EVENT_FAMILIES, eventLabel } from "@/lib/journal/event-labels";
import {
  VISIBLE_EVENT_WHERE,
  eventsQuery,
  eventsWhere,
  parseEventFilters,
} from "@/lib/journal/events";
import { ViewTabs } from "../view-tabs";

export const metadata: Metadata = { title: "Journal — Événements" };

/** Données de la vue « Événements » : page demandée, total filtré, compteur 24 h, listes des canaux et des bots. */
async function loadEventsView(f: ReturnType<typeof parseEventFilters>, now = new Date()) {
  const where = eventsWhere(f);
  const since24h = new Date(now.getTime() - 24 * 3600 * 1000);
  const [total, last24h, events, channels, bots] = await Promise.all([
    prisma.event.count({ where }),
    prisma.event.count({
      where: { AND: [VISIBLE_EVENT_WHERE, { occurredAt: { gte: since24h } }] },
    }),
    prisma.event.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      skip: pageSkip(f.page),
      take: PAGE_SIZE,
      select: {
        id: true,
        type: true,
        occurredAt: true,
        bot: { select: { username: true } },
        channel: { select: { id: true, title: true } },
        member: { select: { id: true, firstName: true, username: true, anonymizedAt: true } },
      },
    }),
    prisma.channel.findMany({ orderBy: { title: "asc" }, select: { id: true, title: true } }),
    prisma.bot.findMany({ orderBy: { username: "asc" }, select: { id: true, username: true } }),
  ]);
  return { total, last24h, events, channels, bots };
}

/**
 * Vue « Événements » du Journal (`/settings/journal/events`) : tout ce que les bots et les membres ont fait (mises à jour
 * Telegram, adhésions, clics, messages privés, publications…), filtrable, paginée et exportable. Lisible par les MANAGER.
 * Les événements joueurs d'autres affiliés Link Affi (sans membre) n'y figurent pas.
 * Adresse propre (pas de paramètre `view`) : les filtres mémorisés reviennent et « Réinitialiser » reste sur cette vue ;
 * l'ancienne adresse `/settings/journal?view=events` y renvoie.
 */
export default async function JournalEventsPage({
  searchParams,
}: PageProps<"/settings/journal/events">) {
  const sp = await searchParams;
  const f = parseEventFilters(sp);
  const { total, last24h, events, channels, bots } = await loadEventsView(f);
  const pages = pageCount(total);
  const hasFilters = Boolean(f.type || f.channelId || f.botId || f.from || f.to);
  const query = eventsQuery(f);
  const selectCls = "h-10 rounded-md border bg-background px-2 text-sm md:h-9";
  return (
    <>
      <PageHeader
        backHref="/settings"
        backLabel="Réglages"
        title="Journal"
        description="Événements des bots et des membres : demandes d'adhésion, entrées, clics, messages privés, publications, mises à jour reçues de Telegram."
        help="Filtrez par type, canal, bot ou période. Le compteur indique le nombre d'événements des dernières 24 heures. Les filtres sont mémorisés sur cet appareil."
      >
        <Button
          variant="outline"
          className="max-md:h-10"
          render={<a href={`/settings/journal/export?${query}`} />}
        >
          Exporter CSV
        </Button>
      </PageHeader>
      <ViewTabs view="events" />
      <Card className="mb-4">
        <CardContent className="space-y-3 pt-6">
          <p className="text-sm">
            <span className="text-2xl font-semibold tabular-nums">{fmtNum(last24h)}</span>{" "}
            <span className="text-muted-foreground">événements sur les dernières 24 heures</span>
          </p>
          <form method="get" className="grid gap-2 text-sm sm:flex sm:flex-wrap sm:items-end">
            <div>
              <Label htmlFor="events-type" className="sr-only">
                Type
              </Label>
              <select
                id="events-type"
                name="type"
                defaultValue={f.type}
                className={`${selectCls} w-full`}
              >
                <option value="">Tous les types</option>
                {EVENT_FAMILIES.map((t) => (
                  <option key={t.prefix} value={t.prefix}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="events-channel" className="sr-only">
                Canal
              </Label>
              <select
                id="events-channel"
                name="channelId"
                defaultValue={f.channelId}
                className={`${selectCls} w-full`}
              >
                <option value="">Tous les canaux</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="events-bot" className="sr-only">
                Bot
              </Label>
              <select
                id="events-bot"
                name="botId"
                defaultValue={f.botId}
                className={`${selectCls} w-full`}
              >
                <option value="">Tous les bots</option>
                {bots.map((b) => (
                  <option key={b.id} value={b.id}>
                    @{b.username}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="events-from" className="sr-only">
                Du
              </Label>
              <Input
                id="events-from"
                type="date"
                name="from"
                defaultValue={f.from}
                title="Du"
                className="h-10 w-full sm:w-40 md:h-9"
              />
            </div>
            <div>
              <Label htmlFor="events-to" className="sr-only">
                Au
              </Label>
              <Input
                id="events-to"
                type="date"
                name="to"
                defaultValue={f.to}
                title="Au"
                className="h-10 w-full sm:w-40 md:h-9"
              />
            </div>
            <Button type="submit" size="sm" className="max-md:h-10">
              Filtrer
            </Button>
            <Suspense fallback={null}>
              <RememberFilters storageKey="journal-events" className="max-md:h-10" />
            </Suspense>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          {events.length === 0 ? (
            hasFilters ? (
              <EmptyState
                title="Aucun événement ne correspond à ces filtres."
                action={{
                  href: "/settings/journal/events",
                  label: "Voir tous les événements",
                  variant: "outline",
                }}
              />
            ) : (
              <EmptyState
                title="Aucun événement pour l'instant."
                description="Envoyez /start à un de vos bots ou publiez dans un canal : la première ligne apparaîtra ici."
                action={{ href: "/settings/bots", label: "Voir les bots", variant: "outline" }}
              />
            )
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
                {events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {fmtDate(e.occurredAt)}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{eventLabel(e.type)}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">{e.type}</div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {e.bot ? `@${e.bot.username}` : "—"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {e.channel ? (
                        <Link href={`/channels/${e.channel.id}`} className="hover:underline">
                          {e.channel.title}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {e.member ? (
                        <Link href={`/members/${e.member.id}`} className="hover:underline">
                          {e.member.anonymizedAt
                            ? "Membre anonymisé"
                            : e.member.username
                              ? `@${e.member.username}`
                              : (e.member.firstName ?? "Membre")}
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
          <Pagination
            page={f.page}
            pages={pages}
            total={total}
            noun="événement"
            hrefFor={(p) => pageHref("/settings/journal/events", sp, p)}
          />
        </CardContent>
      </Card>
    </>
  );
}

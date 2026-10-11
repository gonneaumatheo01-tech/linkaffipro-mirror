import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Download } from "lucide-react";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable } from "@/components/admin/data-table";
import {
  PAGE_SIZE,
  Pagination,
  pageCount,
  pageHref,
  pageSkip,
} from "@/components/admin/pagination";
import { RememberFilters } from "@/components/admin/remember-filters";
import { CollapsibleFilters } from "@/components/admin/collapsible-filters";
import { StatCard } from "@/components/admin/stat-card";
import { DetailList, DetailRow } from "@/components/admin/detail-list";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
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

const linkClass =
  "rounded-xs text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

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

type EventMember = {
  id: string;
  firstName: string | null;
  username: string | null;
  anonymizedAt: Date | null;
};

function memberName(m: EventMember): string {
  if (m.anonymizedAt) return "Membre anonymisé";
  return m.username ? `@${m.username}` : (m.firstName ?? "Membre");
}

/**
 * Vue « Événements » du Journal (`/settings/journal/events`) : tout ce que les bots et les membres ont fait (mises à jour
 * Telegram, adhésions, clics, messages privés, publications…), filtrable, paginée et exportable. Lisible par les MANAGER.
 * Les événements joueurs d'autres affiliés Link Affi (sans membre) n'y figurent pas.
 * Adresse propre (pas de paramètre `view`) : les filtres mémorisés reviennent et « Effacer les filtres » reste sur cette vue ;
 * l'ancienne adresse `/settings/journal?view=events` y renvoie.
 */
export default async function JournalEventsPage({
  searchParams,
}: PageProps<"/settings/journal/events">) {
  const sp = await searchParams;
  const f = parseEventFilters(sp);
  const { total, last24h, events, channels, bots } = await loadEventsView(f);
  const pages = pageCount(total);
  const activeFilters = [f.type, f.channelId, f.botId, f.from, f.to].filter(Boolean).length;
  const hasFilters = activeFilters > 0;
  const query = eventsQuery(f);
  return (
    <>
      <PageHeader
        backHref="/settings"
        backLabel="Réglages"
        title="Journal"
        description="L'activité des bots et des membres : demandes d'adhésion, entrées, clics, messages privés, publications, mises à jour reçues de Telegram."
        help="Filtrez par type, canal, bot ou période. Les filtres sont mémorisés sur cet appareil."
        secondaryActions={
          <a
            href={`/settings/journal/export?${query}`}
            className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
          >
            <Download aria-hidden />
            Exporter (CSV)
          </a>
        }
      />
      <ViewTabs view="events" />
      {/* Filtres sur 3 colonnes et 2 lignes (5 champs + boutons) : jamais tronqués à côté du compteur 24 h. */}
      <div className="mb-6 grid gap-4 xl:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <StatCard
          label="Ces dernières 24 heures"
          value={fmtNum(last24h)}
          hint="événements des bots et des membres"
        />
        {/* Même barre de filtres que les Statistiques (libellés en note, « Appliquer ») ; repliée sur téléphone. */}
        <CollapsibleFilters activeCount={activeFilters}>
          <form
            method="get"
            aria-label="Filtrer les événements"
            className="grid gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-2 md:p-4 lg:grid-cols-3 lg:items-end"
          >
            <div className="min-w-0 space-y-1">
              <Label htmlFor="events-type" className="text-note font-medium text-muted-foreground">
                Type
              </Label>
              <NativeSelect
                id="events-type"
                name="type"
                defaultValue={f.type}
                wrapperClassName="w-full"
              >
                <option value="">Tous les types</option>
                {EVENT_FAMILIES.map((t) => (
                  <option key={t.prefix} value={t.prefix}>
                    {t.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="min-w-0 space-y-1">
              <Label
                htmlFor="events-channel"
                className="text-note font-medium text-muted-foreground"
              >
                Canal
              </Label>
              <NativeSelect
                id="events-channel"
                name="channelId"
                defaultValue={f.channelId}
                wrapperClassName="w-full"
              >
                <option value="">Tous les canaux</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor="events-bot" className="text-note font-medium text-muted-foreground">
                Bot
              </Label>
              <NativeSelect
                id="events-bot"
                name="botId"
                defaultValue={f.botId}
                wrapperClassName="w-full"
              >
                <option value="">Tous les bots</option>
                {bots.map((b) => (
                  <option key={b.id} value={b.id}>
                    @{b.username}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor="events-from" className="text-note font-medium text-muted-foreground">
                Du
              </Label>
              <Input id="events-from" type="date" name="from" defaultValue={f.from} />
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor="events-to" className="text-note font-medium text-muted-foreground">
                Au
              </Label>
              <Input id="events-to" type="date" name="to" defaultValue={f.to} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="outline" className="max-md:h-10">
                Appliquer
              </Button>
              <Suspense fallback={null}>
                <RememberFilters storageKey="journal-events" className="max-md:h-10" />
              </Suspense>
            </div>
          </form>
        </CollapsibleFilters>
      </div>
      <div className="space-y-4">
        <DataTable
          label="Activité des bots et des membres"
          columns={[
            { key: "when", header: "Quand" },
            { key: "type", header: "Type", className: "whitespace-normal md:min-w-44" },
            { key: "bot", header: "Bot", hideOnMobile: true },
            { key: "channel", header: "Canal", hideOnMobile: true },
            { key: "member", header: "Membre", hideOnMobile: true },
          ]}
          rows={events.map((e) => {
            const channel = e.channel ? (
              <Link href={`/channels/${e.channel.id}`} className={linkClass}>
                {e.channel.title}
              </Link>
            ) : (
              "—"
            );
            const member = e.member ? (
              <Link href={`/members/${e.member.id}`} className={linkClass}>
                {memberName(e.member)}
              </Link>
            ) : (
              "—"
            );
            return {
              id: e.id,
              cells: {
                when: fmtDate(e.occurredAt),
                type: eventLabel(e.type),
                bot: e.bot ? `@${e.bot.username}` : "—",
                channel,
                member,
              },
              sortValues: {
                channel: e.channel?.title ?? null,
                member: e.member ? memberName(e.member) : null,
              },
              detailTitle: eventLabel(e.type),
              detailDescription: fmtDate(e.occurredAt),
              detail: (
                <div className="space-y-6">
                  <DetailList>
                    <DetailRow label="Quand">{fmtDate(e.occurredAt)}</DetailRow>
                    <DetailRow label="Type">{eventLabel(e.type)}</DetailRow>
                    <DetailRow label="Code technique" mono>
                      {e.type}
                    </DetailRow>
                    <DetailRow label="Bot">{e.bot ? `@${e.bot.username}` : "—"}</DetailRow>
                    <DetailRow label="Canal">{channel}</DetailRow>
                    <DetailRow label="Membre">{member}</DetailRow>
                  </DetailList>
                  {e.member && !e.member.anonymizedAt ? (
                    <Link
                      href={`/members/${e.member.id}`}
                      className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
                    >
                      Ouvrir la fiche du membre
                    </Link>
                  ) : null}
                </div>
              ),
            };
          })}
          empty={
            hasFilters
              ? {
                  title: "Aucun événement ne correspond à ces filtres.",
                  action: {
                    href: "/settings/journal/events",
                    label: "Voir tous les événements",
                    variant: "outline",
                  },
                }
              : {
                  title: "Aucun événement pour l'instant.",
                  description:
                    "Envoyez /start à un de vos bots ou publiez dans un canal : la première ligne apparaîtra ici.",
                  action: { href: "/settings/bots", label: "Voir les bots", variant: "outline" },
                }
          }
        />
        <Pagination
          page={f.page}
          pages={pages}
          total={total}
          noun="événement"
          hrefFor={(p) => pageHref("/settings/journal/events", sp, p)}
        />
      </div>
    </>
  );
}

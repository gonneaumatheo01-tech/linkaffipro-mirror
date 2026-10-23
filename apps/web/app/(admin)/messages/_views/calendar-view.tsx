import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { CollapsibleFilters } from "@/components/admin/collapsible-filters";
import { MessagesCalendar } from "@/components/messages/calendar/messages-calendar";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { calendarBestSlots, slotsInWeek } from "@/lib/posts/best-slots";
import {
  addDayKey,
  calendarHref,
  parisTodayKey,
  resolveDay,
  resolveWeek,
  weekLabel,
  type CalendarQuery,
} from "@/lib/posts/calendar";
import { loadBestHoursFromAlgo, loadChannelsBestHours } from "@/lib/posts/calendar-queries";
import { fmtDate } from "@/lib/format";
import { listCalendarPosts, scopeForFilters, type PostListFilters } from "@/lib/posts/queries";
import { fromParisLocal } from "@/lib/posts/time";
import { toUniverse, UNIVERSE_LABELS, UNIVERSES } from "@/lib/universe";
import { first, toPanelItem, type MessagesOptions, type SearchParams } from "./shared";

/**
 * Vue Calendrier (par défaut) : la semaine en heure de Paris, filtres canal / univers / campagne / catégorie,
 * meilleurs créneaux d'après les clics (canal filtré, sinon tous les canaux du filtre).
 */
export async function CalendarView({
  sp,
  filters: f,
  options,
  tabs,
}: {
  sp: SearchParams;
  filters: PostListFilters;
  options: MessagesOptions;
  tabs: React.ReactNode;
}) {
  const now = new Date();
  const today = parisTodayKey(now);
  const monday = resolveWeek(first(sp.week), now);
  const day = resolveDay(first(sp.day), monday, now);
  const vertical = toUniverse(f.vertical) ?? undefined;
  const query: CalendarQuery = {
    channelId: f.channelId || undefined,
    vertical,
    campaignId: f.campaignId || undefined,
    categoryId: f.categoryId || undefined,
  };

  const weekStart = fromParisLocal(`${monday}T00:00`)!;
  const weekEnd = fromParisLocal(`${addDayKey(monday, 7)}T00:00`)!;
  const posts = await listCalendarPosts({
    weekStart,
    weekEnd,
    campaignId: query.campaignId,
    channelId: query.channelId,
    categoryId: query.categoryId,
    vertical,
  });

  // Canaux dont les meilleurs horaires comptent : le canal filtré, sinon ceux de l'univers et de la campagne.
  let bestChannelIds = query.channelId
    ? [query.channelId]
    : options.channels.filter((c) => !vertical || c.vertical === vertical).map((c) => c.id);
  if (!query.channelId && query.campaignId) {
    const scope = await scopeForFilters(f);
    bestChannelIds = bestChannelIds.filter((id) => scope?.channelIds.includes(id));
  }
  const [bestData, algoGlobal] = await Promise.all([
    loadChannelsBestHours(bestChannelIds),
    loadBestHoursFromAlgo(),
  ]);
  // Phase 21 : source affichée quand l'agent Horaires de l'équipe Algorithme a fait le calcul.
  const byAlgo = algoGlobal || bestData.some((d) => d.source === "algo");
  const best = calendarBestSlots(bestData, {
    channelId: query.channelId,
    categoryId: query.categoryId,
  });
  // Date du dernier calcul (chaque nuit, ou « Recalculer » ci-dessous).
  const computedAt = bestData
    .map((d) => new Date(d.computedAt))
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const slots = slotsInWeek(best.slots, monday);
  const slotsNote = query.channelId
    ? `Pas encore assez de messages envoyés dans ce canal pour conseiller des créneaux : il en faut ${best.minPosts} le même jour à la même heure (8 dernières semaines).`
    : `Pas encore assez de messages envoyés pour conseiller des créneaux : il en faut ${best.minPosts} le même jour à la même heure (8 dernières semaines).`;

  const items = posts.filter((p) => p.scheduledAt).map(toPanelItem);

  const activeCount = [query.channelId, query.vertical, query.campaignId, query.categoryId].filter(
    Boolean,
  ).length;
  const campaignName = options.campaigns.find((c) => c.id === query.campaignId)?.name;
  const prevWeek = addDayKey(monday, -7);
  const nextWeek = addDayKey(monday, 7);
  const isThisWeek = monday === resolveWeek(undefined, now);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {tabs}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-title text-foreground">{weekLabel(monday, today)}</h2>
          <span className="text-note text-muted-foreground">
            {items.length === 0
              ? "aucun message"
              : `${items.length} message${items.length > 1 ? "s" : ""}`}
          </span>
          <div className="flex items-center gap-1">
            <Link
              href={calendarHref({ ...query, week: prevWeek })}
              aria-label="Semaine précédente"
              title="Semaine précédente"
              className={buttonVariants({ variant: "outline", size: "icon" })}
            >
              <ChevronLeft aria-hidden />
            </Link>
            <Link
              href={calendarHref(query)}
              aria-current={isThisWeek ? "date" : undefined}
              className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
            >
              Aujourd&apos;hui
            </Link>
            <Link
              href={calendarHref({ ...query, week: nextWeek })}
              aria-label="Semaine suivante"
              title="Semaine suivante"
              className={buttonVariants({ variant: "outline", size: "icon" })}
            >
              <ChevronRight aria-hidden />
            </Link>
          </div>
        </div>
      </div>

      <CollapsibleFilters activeCount={activeCount}>
        <form
          method="get"
          action="/messages"
          className="grid gap-3 rounded-xl border border-border bg-surface p-3 sm:grid-cols-2 md:flex md:flex-wrap md:items-end"
        >
          <input type="hidden" name="week" value={monday} />
          <div className="space-y-1.5">
            <Label htmlFor="cal-channel" className="text-note">
              Canal
            </Label>
            <NativeSelect
              id="cal-channel"
              name="channelId"
              defaultValue={query.channelId ?? ""}
              wrapperClassName="w-full md:w-52"
            >
              <option value="">Tous les canaux</option>
              {options.channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cal-vertical" className="text-note">
              Univers
            </Label>
            <NativeSelect
              id="cal-vertical"
              name="vertical"
              defaultValue={vertical ?? ""}
              wrapperClassName="w-full md:w-40"
            >
              <option value="">Tous les univers</option>
              {UNIVERSES.map((u) => (
                <option key={u} value={u}>
                  {UNIVERSE_LABELS[u]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cal-campaign" className="text-note">
              Campagne
            </Label>
            <NativeSelect
              id="cal-campaign"
              name="campaignId"
              defaultValue={query.campaignId ?? ""}
              title="Messages des canaux de la campagne ou avec un bouton Offre vers une de ses offres"
              wrapperClassName="w-full md:w-52"
            >
              <option value="">Toutes les campagnes</option>
              {options.campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cal-category" className="text-note">
              Catégorie
            </Label>
            <NativeSelect
              id="cal-category"
              name="category"
              defaultValue={query.categoryId ?? ""}
              wrapperClassName="w-full md:w-52"
            >
              <option value="">Toutes les catégories</option>
              {options.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex gap-2 sm:col-span-2 md:col-auto">
            <Button type="submit" variant="outline">
              Filtrer
            </Button>
            {activeCount > 0 ? (
              <Link
                href={calendarHref({ week: isThisWeek ? undefined : monday })}
                className={cn(buttonVariants({ variant: "ghost" }), "max-md:h-10")}
              >
                Effacer les filtres
              </Link>
            ) : null}
          </div>
        </form>
      </CollapsibleFilters>

      {items.length === 0 ? (
        <p
          role="status"
          className="rounded-xl border border-dashed border-border px-4 py-3 text-body text-muted-foreground"
        >
          {query.campaignId
            ? `Aucun message de la campagne « ${campaignName ?? "inconnue"} » cette semaine. `
            : activeCount > 0
              ? "Aucun message pour ces filtres cette semaine. "
              : "Aucun message cette semaine. "}
          Cliquez une case du calendrier, ou « Programmer un message ».
        </p>
      ) : null}

      {/* Une instance par semaine : le jour choisi sur téléphone repart du jour demandé à chaque semaine. */}
      <MessagesCalendar
        key={monday}
        monday={monday}
        todayKey={today}
        nowIso={now.toISOString()}
        items={items}
        slots={slots}
        slotsNote={slotsNote}
        computedLabel={
          computedAt
            ? `Calculés le ${fmtDate(computedAt)}${byAlgo ? " par l'équipe Algorithme" : ""}`
            : undefined
        }
        recomputeChannelId={query.channelId}
        initialDay={day}
        query={query}
        prefill={{ channelId: query.channelId, categoryId: query.categoryId }}
      />
    </div>
  );
}

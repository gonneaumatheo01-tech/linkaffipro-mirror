"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Plus,
  Star,
  Undo2,
  X,
} from "lucide-react";
import { EmptyState } from "@/components/admin/empty-state";
import { UniverseDot } from "@/components/admin/universe-dot";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { horizontalScrollState } from "@/components/ui/table-logic";
import { recomputeBestHoursAction } from "@/app/(admin)/channels/[id]/actions";
import { movePostAction, type MovePostResult } from "@/app/(admin)/messages/move-action";
import {
  calendarHref,
  cellKey,
  countByDay,
  dayAgenda,
  dayInitial,
  dayLabelLong,
  dayLabelShort,
  dayNeighbours,
  dayOfMonth,
  dropTarget,
  hourLabel,
  isPastLocal,
  isPastSlot,
  localInput,
  momentLabel,
  newPostHref,
  placeInWeek,
  slotStartLocal,
  splitLocal,
  timeLabel,
  toLocal,
  visibleHours,
  weekDayKeys,
  weekdayOf,
  type CalendarQuery,
  type DayKey,
  type DaySlot,
} from "@/lib/posts/calendar";
import { nextOccurrence } from "@/lib/posts/time";
import { StatusBadge, statusLabel } from "@/lib/status-badges";
import { UNIVERSES, universeLabel, type Universe } from "@/lib/universe";
import { PostPanel } from "./post-panel";
import type { CalendarItem } from "./types";

/** Bordure gauche de la couleur d'univers (jamais un fond plein). Classes écrites en entier pour Tailwind. */
const UNIVERSE_BORDER: Record<Universe | "none", string> = {
  CASINO: "border-l-casino",
  SPORTS: "border-l-sports",
  DATING: "border-l-dating",
  none: "border-l-muted-foreground/40",
};

type Toast = {
  id: number;
  kind: "ok" | "error";
  text: string;
  undo?: { item: CalendarItem; from: string };
};

/** « Aucun message », « 1 message », « 3 messages ». */
function messageCount(n: number): string {
  return n === 0 ? "aucun message" : `${n} message${n > 1 ? "s" : ""}`;
}

/** Clic simple (sans touche ni bouton du milieu) : ouvre le volet ; sinon le lien ouvre la fiche normalement. */
function plainClick(e: React.MouseEvent): boolean {
  return !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0);
}

/**
 * Calendrier des messages, semaine par semaine (heure de Paris) :
 * - ordinateur : une colonne par jour, une ligne par heure ; chaque message à son heure (heure, statut, version A/B,
 *   début du texte, canal), bordé de la couleur de son univers ; glisser un brouillon ou un message programmé vers une autre case le déplace
 *   (confirmation et « Annuler ») ; les 3 meilleurs créneaux sont surlignés ; une case libre propose
 *   « Programmer un message à ce créneau » ;
 * - téléphone : un jour à la fois (bande des 7 jours, flèches jour précédent / suivant), messages et meilleurs
 *   créneaux du jour en liste ;
 * - clic sur un message : volet de détail (Ouvrir, Modifier, Dupliquer, Déplacer au clavier).
 */
export function MessagesCalendar({
  monday,
  todayKey,
  nowIso,
  items,
  slots,
  slotsNote,
  computedLabel,
  recomputeChannelId,
  initialDay,
  query,
  prefill,
}: {
  monday: DayKey;
  todayKey: DayKey;
  /** Heure du serveur au rendu : même calcul des cases passées côté serveur et côté navigateur. */
  nowIso: string;
  items: CalendarItem[];
  /** Meilleurs créneaux placés dans la semaine (rang 1 à 3). */
  slots: DaySlot[];
  /** Phrase affichée quand aucun créneau ne peut être conseillé. */
  slotsNote: string;
  /** Après les créneaux : « Calculés le … » (date du dernier calcul des meilleurs horaires). */
  computedLabel?: string;
  /** Canal filtré : bouton « Recalculer maintenant » (meilleurs horaires de ce canal). */
  recomputeChannelId?: string;
  initialDay: DayKey;
  /** Filtres en cours (sans la semaine ni le jour), conservés par les liens. */
  query: CalendarQuery;
  /** Canal et catégorie pré-remplis dans « Programmer un message à ce créneau ». */
  prefill: { channelId?: string; categoryId?: string };
}) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const days = useMemo(() => weekDayKeys(monday), [monday]);
  // Déplacements en cours ou faits, appliqués tout de suite (avant que la page ne soit rechargée) : valables tant
  // que la date reçue du serveur est encore `base`.
  const [overrides, setOverrides] = useState<Record<string, { base: string; to: string }>>({});
  const [pending, setPending] = useState<string[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [hoverCell, setHoverCell] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [day, setDay] = useState<DayKey>(initialDay);
  const [toast, setToast] = useState<Toast | null>(null);
  const [, startTransition] = useTransition();
  // La grille ne prend une tabulation (défilement au clavier) que si elle déborde, comme `Table`.
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const [gridOverflows, setGridOverflows] = useState(false);

  useEffect(() => {
    const el = gridScrollRef.current;
    if (!el) return;
    const update = () => setGridOverflows(horizontalScrollState(el).overflowing);
    update();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => ro?.disconnect();
  }, []);

  const effective = useMemo(
    () =>
      items.map((i) => {
        const o = overrides[i.id];
        return o && o.base === i.local ? { ...i, local: o.to } : i;
      }),
    [items, overrides],
  );
  const grid = useMemo(() => placeInWeek(effective, days), [effective, days]);
  const hours = useMemo(
    () =>
      visibleHours([
        ...effective
          .filter((i) => days.includes(i.local.slice(0, 10)))
          .map((i) => splitLocal(i.local)?.hour ?? 23),
        ...slots.map((s) => s.hour),
      ]),
    [effective, slots, days],
  );
  const slotByCell = useMemo(() => new Map(slots.map((s) => [cellKey(s.day, s.hour), s])), [slots]);
  const counts = useMemo(() => countByDay(effective, days), [effective, days]);
  const agenda = useMemo(() => dayAgenda(effective, slots, day, now), [effective, slots, day, now]);
  const selected = effective.find((i) => i.id === selectedId) ?? null;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === "ok" ? 10_000 : 8_000);
    return () => clearTimeout(t);
  }, [toast]);

  function showToast(t: Omit<Toast, "id">) {
    setToast((prev) => ({ ...t, id: (prev?.id ?? 0) + 1 }));
  }

  function open(id: string) {
    setSelectedId(id);
    setPanelOpen(true);
  }

  function propsLocal(id: string, fallback: string): string {
    return items.find((i) => i.id === id)?.local ?? fallback;
  }

  /** Déplace un message (glisser-déposer ou « Annuler ») : affichage immédiat, action serveur, retour visuel. */
  function move(item: CalendarItem, to: string, opts: { isUndo?: boolean } = {}) {
    if (to === item.local) return;
    if (!item.movable) {
      showToast({ kind: "error", text: "Ce message est déjà parti : il ne se déplace plus." });
      return;
    }
    if (isPastLocal(to, new Date())) {
      showToast({
        kind: "error",
        text: "Ce moment est déjà passé : déposez le message sur un créneau à venir.",
      });
      return;
    }
    const from = item.local;
    setOverrides((o) => ({ ...o, [item.id]: { base: propsLocal(item.id, from), to } }));
    setPending((p) => [...p, item.id]);
    startTransition(async () => {
      let r: MovePostResult;
      try {
        r = await movePostAction({ postId: item.id, scheduledAt: to });
      } catch {
        r = {
          ok: false,
          error: "Connexion impossible : le message n'a pas été déplacé. Réessayez.",
        };
      }
      setPending((p) => p.filter((x) => x !== item.id));
      if (!r.ok) {
        setOverrides((o) => {
          const next = { ...o };
          delete next[item.id];
          return next;
        });
        showToast({ kind: "error", text: r.error });
        return;
      }
      showToast({
        kind: "ok",
        text: opts.isUndo ? `Déplacement annulé : retour au ${momentLabel(to)}.` : r.message,
        undo: opts.isUndo ? undefined : { item: { ...item, local: to }, from: r.from ?? from },
      });
    });
  }

  /** Déplacement fait depuis le volet (« Déplacer ») : fermeture du volet, affichage immédiat, « Annuler ». */
  function onPanelMoved(item: CalendarItem, r: MovePostResult, from: string) {
    if (!r.ok) return;
    setOverrides((o) => ({ ...o, [item.id]: { base: propsLocal(item.id, from), to: r.to } }));
    setPanelOpen(false);
    showToast({ kind: "ok", text: r.message, undo: { item: { ...item, local: r.to }, from } });
  }

  /** Adresse « Programmer un message à ce créneau » (prochaine occurrence si le créneau de la semaine est passé). */
  function slotHref(slot: DaySlot): string {
    const local = isPastSlot(slot.day, slot.hour, now)
      ? toLocal(nextOccurrence(weekdayOf(slot.day), slot.hour, now))
      : slotStartLocal(slot.day, slot.hour, now);
    return newPostHref({ local, ...prefill });
  }

  function onDrop(e: React.DragEvent, d: DayKey, h: number) {
    e.preventDefault();
    const id = dragId ?? e.dataTransfer.getData("text/x-linkaffi-post");
    setDragId(null);
    setHoverCell(null);
    const item = effective.find((i) => i.id === id);
    if (item) move(item, dropTarget(item.local, d, h));
  }

  const chipLabel = (p: CalendarItem, time: string) =>
    [
      time,
      p.abVariant ? `version ${p.abVariant}` : null,
      p.excerpt ? p.excerpt.slice(0, 80) : "média seul",
      p.channelTitle,
      statusLabel("post", p.status),
      universeLabel(p.universe),
      p.category?.name,
    ]
      .filter(Boolean)
      .join(", ");

  const neighbours = dayNeighbours(day);
  const inWeek = (d: DayKey) => days.includes(d);
  const dayNavButton = (dir: "prev" | "next") => {
    const target = neighbours[dir];
    const label = dir === "prev" ? "Jour précédent" : "Jour suivant";
    const Icon = dir === "prev" ? ChevronLeft : ChevronRight;
    if (inWeek(target.day))
      return (
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={label}
          onClick={() => setDay(target.day)}
        >
          <Icon aria-hidden />
        </Button>
      );
    return (
      <Link
        href={calendarHref({ ...query, week: target.week, day: target.day })}
        aria-label={label}
        className={buttonVariants({ variant: "outline", size: "icon" })}
      >
        <Icon aria-hidden />
      </Link>
    );
  };

  // Créneau libre le plus proche pour « Programmer un message ce jour-là » (téléphone).
  const dayNewHref = (() => {
    if (isPastSlot(day, 23, now)) return null;
    const nowLocal = splitLocal(toLocal(now));
    const hour = day === nowLocal?.day ? Math.min(23, nowLocal.hour + 1) : 12;
    return newPostHref({ local: localInput(day, hour), ...prefill });
  })();

  return (
    <div className="space-y-4">
      {/* Légende : meilleurs créneaux et couleurs d'univers. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-note text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <span
            aria-hidden
            className="inline-flex size-5 items-center justify-center rounded-md bg-brand-soft text-brand-ink"
          >
            <Star className="size-3 fill-current" />
          </span>
          Meilleurs créneaux (d&apos;après vos clics)
        </span>
        {slots.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label="Meilleurs créneaux de la semaine">
            {slots.map((s) => (
              <li key={`${s.day}-${s.hour}`}>
                <Link
                  href={slotHref(s)}
                  title={s.detail}
                  aria-label={`Programmer un message au meilleur créneau n° ${s.rank} : ${s.label} (${s.detail})`}
                  className="inline-flex h-7 items-center gap-1 rounded-full border border-brand/50 bg-brand-soft px-2.5 font-medium text-brand-ink hover:bg-brand-soft/60 max-md:h-10"
                >
                  <span className="tabular-nums">{s.rank}.</span> {s.label}
                  <span className="font-normal text-muted-foreground max-md:hidden">
                    · {s.detail}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <span>{slotsNote}</span>
        )}
        {computedLabel || recomputeChannelId ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            {computedLabel ? <span>{computedLabel}</span> : null}
            {recomputeChannelId ? (
              <form action={recomputeBestHoursAction}>
                <input type="hidden" name="channelId" value={recomputeChannelId} />
                {/* Retour sur la même semaine et les mêmes filtres après le recalcul. */}
                <input type="hidden" name="week" value={monday} />
                {query.vertical ? <input type="hidden" name="vertical" value={query.vertical} /> : null}
                {query.campaignId ? (
                  <input type="hidden" name="campaignId" value={query.campaignId} />
                ) : null}
                {query.categoryId ? (
                  <input type="hidden" name="category" value={query.categoryId} />
                ) : null}
                <Button type="submit" size="xs" variant="ghost" className="text-brand-ink">
                  Recalculer maintenant
                </Button>
              </form>
            ) : null}
          </span>
        ) : null}
        <span className="flex flex-wrap items-center gap-3 max-md:hidden md:ml-auto">
          {UNIVERSES.map((u) => (
            <UniverseDot key={u} universe={u} withLabel />
          ))}
        </span>
      </div>

      {/* Ordinateur : la semaine en grille. */}
      <div className="hidden md:block">
        <div
          ref={gridScrollRef}
          {...(gridOverflows
            ? {
                role: "region",
                "aria-label": "Calendrier de la semaine (faites défiler horizontalement)",
                tabIndex: 0,
              }
            : {})}
          className="overflow-x-auto rounded-xl border border-border bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <table className="w-full min-w-[56rem] table-fixed border-collapse text-note">
            <caption className="sr-only">
              Messages de la semaine, par jour et par heure (heure de Paris). Glissez un message
              vers une autre case pour le déplacer, ou ouvrez-le puis choisissez « Déplacer ».
            </caption>
            <colgroup>
              <col className="w-14" />
              {days.map((d) => (
                <col key={d} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="border-b border-border">
                  <span className="sr-only">Heure</span>
                </th>
                {days.map((d) => {
                  const isToday = d === todayKey;
                  return (
                    <th
                      key={d}
                      scope="col"
                      aria-current={isToday ? "date" : undefined}
                      title={isToday ? "Aujourd'hui" : undefined}
                      className={cn(
                        "border-b border-l border-border px-2 py-2 text-left font-medium",
                        isToday
                          ? "border-t-2 border-t-brand bg-brand-soft text-brand-ink"
                          : "text-foreground",
                      )}
                    >
                      {/* Aujourd'hui : colonne surlignée (le mot ne tient pas avec le nombre de messages). */}
                      <span className="block text-body font-semibold first-letter:uppercase">
                        {dayLabelShort(d)}
                        {isToday ? <span className="sr-only">, aujourd&apos;hui</span> : null}
                      </span>
                      <span
                        className={cn(
                          "block font-normal",
                          isToday ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {messageCount(counts[d] ?? 0)}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {hours.map((h) => (
                <tr key={h}>
                  <th
                    scope="row"
                    className="border-b border-border px-2 py-1 text-right align-top font-normal text-muted-foreground tabular-nums"
                  >
                    {hourLabel(h)}
                  </th>
                  {days.map((d) => {
                    const key = cellKey(d, h);
                    const posts = grid.get(key) ?? [];
                    const past = isPastSlot(d, h, now);
                    const slot = slotByCell.get(key);
                    const hovered = hoverCell === key && dragId !== null;
                    const when = `${dayLabelLong(d)} à ${hourLabel(h)}`;
                    return (
                      <td
                        key={d}
                        data-cell={key}
                        className={cn(
                          "relative h-12 border-b border-l border-border p-1 align-top",
                          past && "bg-muted/50",
                          slot && (past ? "bg-brand-soft/50" : "bg-brand-soft"),
                          hovered && "bg-brand-soft ring-2 ring-brand ring-inset",
                        )}
                        onDragOver={(e) => {
                          if (!dragId || past) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          if (hoverCell !== key) setHoverCell(key);
                        }}
                        onDrop={(e) => (past ? undefined : onDrop(e, d, h))}
                      >
                        {!past && !slot ? (
                          <Link
                            href={newPostHref({ local: slotStartLocal(d, h, now), ...prefill })}
                            prefetch={false}
                            tabIndex={-1}
                            aria-hidden
                            title={`Programmer un message le ${when}`}
                            className="group/new absolute inset-0 flex items-start justify-end p-1 text-brand-ink transition-colors hover:bg-brand-soft/60"
                          >
                            <span className="inline-flex items-center gap-0.5 font-medium opacity-0 transition-opacity group-hover/new:opacity-100">
                              <Plus className="size-3.5" />
                              {posts.length === 0 ? "Programmer" : null}
                            </span>
                          </Link>
                        ) : null}
                        {slot ? (
                          <div className="relative z-10 mb-1 flex items-center gap-1 font-medium text-brand-ink">
                            <Star aria-hidden className="size-3 shrink-0 fill-current" />
                            {past ? (
                              <span>Meilleur créneau</span>
                            ) : (
                              <Link
                                href={slotHref(slot)}
                                prefetch={false}
                                aria-label={`Programmer un message à ce créneau : ${when} (meilleur créneau n° ${slot.rank}, ${slot.detail})`}
                                className="truncate rounded-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                              >
                                Programmer ici
                              </Link>
                            )}
                          </div>
                        ) : null}
                        {posts.length > 0 ? (
                          <ul className="relative z-10 space-y-1">
                            {posts.map((p) => {
                              const s = splitLocal(p.local);
                              const time = s ? timeLabel(s.hour, s.minute) : "";
                              return (
                                <li key={p.id}>
                                  <Link
                                    href={`/messages/${p.id}`}
                                    prefetch={false}
                                    draggable={p.movable}
                                    aria-haspopup="dialog"
                                    aria-label={chipLabel(p, time)}
                                    title={p.excerpt || undefined}
                                    onClick={(e) => {
                                      if (!plainClick(e)) return;
                                      e.preventDefault();
                                      open(p.id);
                                    }}
                                    onDragStart={(e) => {
                                      if (!p.movable) return e.preventDefault();
                                      e.dataTransfer.setData("text/x-linkaffi-post", p.id);
                                      e.dataTransfer.effectAllowed = "move";
                                      setDragId(p.id);
                                    }}
                                    onDragEnd={() => {
                                      setDragId(null);
                                      setHoverCell(null);
                                    }}
                                    className={cn(
                                      "block rounded-md border border-l-[3px] border-border bg-surface px-1.5 py-1 text-foreground shadow-xs transition-opacity hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                                      UNIVERSE_BORDER[p.universe ?? "none"],
                                      p.movable && "cursor-grab active:cursor-grabbing",
                                      (pending.includes(p.id) || dragId === p.id) && "opacity-50",
                                    )}
                                  >
                                    <span className="flex items-center gap-1 overflow-hidden">
                                      <span className="font-semibold tabular-nums">{time}</span>
                                      <StatusBadge
                                        kind="post"
                                        value={p.status}
                                        className="h-5 px-1.5"
                                      />
                                      {p.abVariant ? (
                                        <span className="ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-sm border border-border bg-muted px-1 font-semibold">
                                          {p.abVariant}
                                        </span>
                                      ) : null}
                                    </span>
                                    <span className="mt-0.5 line-clamp-2 break-words">
                                      {p.excerpt || "(média seul)"}
                                    </span>
                                    <span className="mt-0.5 block truncate text-muted-foreground">
                                      {p.channelTitle}
                                    </span>
                                  </Link>
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-note text-muted-foreground">
          Glissez un brouillon ou un message programmé vers une autre case pour le déplacer. Cliquez
          une case libre pour y programmer un message.
        </p>
      </div>

      {/* Téléphone : un jour à la fois. */}
      <div className="space-y-3 md:hidden">
        <div role="group" aria-label="Jours de la semaine" className="grid grid-cols-7 gap-1">
          {days.map((d) => {
            const n = counts[d] ?? 0;
            const isSel = d === day;
            return (
              <button
                key={d}
                type="button"
                aria-pressed={isSel}
                aria-label={`${dayLabelLong(d)}${d === todayKey ? " (aujourd'hui)" : ""} : ${messageCount(n)}`}
                onClick={() => setDay(d)}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-0.5 rounded-lg border text-note focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  isSel
                    ? "border-brand bg-brand-soft text-brand-ink"
                    : "border-border bg-surface text-foreground",
                )}
              >
                <span aria-hidden className={cn(d === todayKey && !isSel && "text-brand-ink")}>
                  {dayInitial(d)}
                </span>
                <span aria-hidden className="text-body font-semibold tabular-nums">
                  {dayOfMonth(d)}
                </span>
                <span
                  aria-hidden
                  className={cn("size-1.5 rounded-full", n > 0 ? "bg-brand-ink" : "bg-transparent")}
                />
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between gap-2">
          {dayNavButton("prev")}
          <h2
            className="text-center text-body font-semibold first-letter:uppercase"
            aria-live="polite"
          >
            {dayLabelLong(day)}
            {day === todayKey ? (
              <span className="font-normal text-brand-ink"> · aujourd&apos;hui</span>
            ) : null}
          </h2>
          {dayNavButton("next")}
        </div>
        {agenda.length === 0 ? (
          <EmptyState
            title="Aucun message ce jour-là"
            description={
              dayNewHref
                ? "Programmez un message pour ce jour, ou changez de jour."
                : "Ce jour est passé."
            }
            action={
              dayNewHref
                ? { href: dayNewHref, label: "Programmer ce jour-là", variant: "outline" }
                : undefined
            }
          />
        ) : (
          <ul className="space-y-2" aria-label={`Messages du ${dayLabelLong(day)}`}>
            {agenda.map((entry) => {
              if (entry.kind === "slot") {
                const s = entry.slot;
                return (
                  <li
                    key={entry.key}
                    className="flex items-center gap-3 rounded-xl border border-dashed border-brand/60 bg-brand-soft p-3"
                  >
                    <span className="w-12 shrink-0 text-body font-semibold text-brand-ink tabular-nums">
                      {hourLabel(s.hour)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1 text-body font-medium text-foreground">
                        <Star aria-hidden className="size-3.5 fill-current text-brand-ink" />
                        Meilleur créneau
                      </span>
                      <span className="block text-note text-muted-foreground">{s.detail}</span>
                    </span>
                    {entry.past ? (
                      <span className="text-note text-muted-foreground">Passé</span>
                    ) : (
                      <Link
                        href={slotHref(s)}
                        aria-label={`Programmer un message à ce créneau : ${dayLabelLong(s.day)} à ${hourLabel(s.hour)}`}
                        className={buttonVariants({ variant: "outline", size: "sm" })}
                      >
                        Programmer ici
                      </Link>
                    )}
                  </li>
                );
              }
              const p = entry.item;
              const s = splitLocal(p.local);
              const time = s ? timeLabel(s.hour, s.minute) : "";
              return (
                <li key={entry.key}>
                  <Link
                    href={`/messages/${p.id}`}
                    prefetch={false}
                    aria-haspopup="dialog"
                    onClick={(e) => {
                      if (!plainClick(e)) return;
                      e.preventDefault();
                      open(p.id);
                    }}
                    className={cn(
                      "flex min-h-14 gap-3 rounded-xl border border-l-4 border-border bg-surface p-3 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      UNIVERSE_BORDER[p.universe ?? "none"],
                      pending.includes(p.id) && "opacity-50",
                    )}
                  >
                    <span className="w-12 shrink-0 text-body font-semibold tabular-nums">
                      {time}
                    </span>
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="min-w-0 truncate text-body font-medium">
                          {p.channelTitle}
                        </span>
                        <StatusBadge kind="post" value={p.status} />
                        {p.abVariant ? (
                          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-sm border border-border bg-muted px-1 text-note font-semibold">
                            <span className="sr-only">version </span>
                            {p.abVariant}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex items-center gap-1.5 text-note text-muted-foreground">
                        <UniverseDot universe={p.universe} />
                        <span className="line-clamp-2">{p.excerpt || "(média seul)"}</span>
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <PostPanel
        item={selected}
        open={panelOpen && selected !== null}
        onOpenChange={setPanelOpen}
        onMoved={onPanelMoved}
      />

      {/* Retour d'un déplacement : confirmation, « Annuler », ou erreur. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex justify-center md:inset-x-auto md:right-6 md:bottom-6"
      >
        {toast ? (
          <div
            key={toast.id}
            className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border border-border bg-surface p-3 text-body text-foreground shadow-lg"
          >
            {toast.kind === "ok" ? (
              <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
            ) : (
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
            )}
            <p className="min-w-0 flex-1">{toast.text}</p>
            {toast.undo ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  const u = toast.undo!;
                  setToast(null);
                  move(u.item, u.from, { isUndo: true });
                }}
              >
                <Undo2 aria-hidden />
                Annuler
              </Button>
            ) : null}
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Fermer ce message"
              onClick={() => setToast(null)}
            >
              <X aria-hidden />
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

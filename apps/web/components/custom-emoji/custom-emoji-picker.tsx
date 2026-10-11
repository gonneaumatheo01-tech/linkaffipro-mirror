"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { ExternalLink, Search, Sticker } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { emojiCount, packLabel } from "@/lib/custom-emoji/library";
import { CustomEmojiPreview } from "./custom-emoji-preview";
import {
  emojiButtonLabel,
  GRID_COLUMNS,
  gridMove,
  initialTab,
  pickerItems,
  pickerTabs,
  RECENT_TAB,
  tabMove,
} from "./picker-logic";
import { useCustomEmojiLibrary } from "./use-library";

/** Emoji choisi dans le sélecteur : à insérer par `customEmojiTag(id, fallback)` de @linkaffipro/core. */
export type PickedEmoji = { id: string; fallback: string };

/** Adresse de la bibliothèque (Messages → Emojis animés) ; `?ajouter=1` ouvre le volet « Ajouter des emojis animés ». */
export const CUSTOM_EMOJI_LIBRARY_HREF = "/messages/emojis";
export const CUSTOM_EMOJI_ADD_HREF = "/messages/emojis?ajouter=1";

/** Dernier onglet ouvert (gardé pour la page : on retrouve son pack d'un message à l'autre). */
let lastTab: string | null = null;

/**
 * Contenu du sélecteur d'emojis animés : recherche (emoji ou nom du pack), onglets (« Récents de l'équipe », puis un
 * par pack), grille de 8 colonnes au clavier (flèches, Début, Fin, Entrée), état vide qui explique comment ajouter
 * des emojis. Réutilisable hors de l'éditeur (`onPick` reçoit l'emoji choisi).
 */
export function CustomEmojiPicker({
  onPick,
  searchRef,
}: {
  onPick: (emoji: PickedEmoji) => void;
  /** Champ de recherche (premier focus de la fenêtre). */
  searchRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const uid = useId();
  const { items, error, reload } = useCustomEmojiLibrary();
  const [query, setQuery] = useState("");
  const tabs = useMemo(() => (items ? pickerTabs(items) : []), [items]);
  const [tab, setTab] = useState<string | null>(null);
  const activeTab = tab && tabs.some((t) => t.key === tab) ? tab : initialTab(tabs, lastTab);
  const shown = useMemo(
    () => (items ? pickerItems(items, activeTab, query) : []),
    [items, activeTab, query],
  );
  const [focusIndex, setFocusIndex] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const ownSearch = useRef<HTMLInputElement>(null);
  const search = searchRef ?? ownSearch;
  const index = Math.min(focusIndex, Math.max(shown.length - 1, 0));
  const searching = query.trim().length > 0;
  const showTabs = !searching && tabs.length > 1;
  const activeLabel = tabs.find((t) => t.key === activeTab)?.label ?? "Emojis animés";
  const gridLabel = searching ? `Résultats pour « ${query.trim()} »` : activeLabel;

  useEffect(() => {
    if (tab) lastTab = tab;
  }, [tab]);

  // La fenêtre s'ouvre parfois avant que la bibliothèque soit lue : le curseur va dans la recherche dès qu'elle est là.
  const loaded = items !== null;
  useEffect(() => {
    if (!loaded) return;
    const active = document.activeElement;
    if (!active || active === document.body || active.closest('[data-slot="custom-emoji-picker"]'))
      search.current?.focus();
  }, [loaded, search]);

  const focusCell = (i: number) => {
    setFocusIndex(i);
    gridRef.current?.querySelectorAll<HTMLButtonElement>("button[data-emoji]")[i]?.focus();
  };

  const selectTab = (key: string) => {
    setTab(key);
    setFocusIndex(0);
    gridRef.current?.scrollTo?.({ top: 0 });
  };

  if (error)
    return (
      <div className="flex flex-col items-start gap-2 p-3 text-body">
        <p className="text-foreground">La bibliothèque ne répond pas pour l&apos;instant.</p>
        <Button type="button" variant="outline" size="sm" onClick={reload}>
          Réessayer
        </Button>
      </div>
    );

  if (!items)
    return (
      <p className="p-3 text-body text-muted-foreground" role="status">
        Chargement des emojis animés…
      </p>
    );

  if (items.length === 0)
    return (
      <div className="flex flex-col items-center gap-2 px-3 py-5 text-center">
        <span
          aria-hidden
          className="flex size-10 items-center justify-center rounded-full bg-brand-soft text-brand-ink [&>svg]:size-5"
        >
          <Sticker />
        </span>
        <p className="text-body font-semibold text-foreground">
          Aucun emoji animé pour l&apos;instant
        </p>
        <p className="text-body text-muted-foreground">
          Transférez au bot un message qui contient vos emojis animés : ils arrivent ici tout seuls.
        </p>
        {/* Nouvel onglet : le message en cours d'écriture n'est pas perdu. */}
        <a
          href={CUSTOM_EMOJI_ADD_HREF}
          target="_blank"
          rel="noreferrer"
          aria-label="Ajouter des emojis animés (nouvel onglet)"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-1 max-md:h-10")}
        >
          Ajouter des emojis animés
          <ExternalLink aria-hidden />
        </a>
      </div>
    );

  const grid = (
    <div
      ref={gridRef}
      role="group"
      aria-label={gridLabel}
      className="grid max-h-[min(16rem,40vh)] grid-cols-8 gap-0.5 overflow-y-auto overscroll-contain"
      onKeyDown={(e) => {
        const next = gridMove(index, e.key, shown.length, GRID_COLUMNS);
        if (next === null) return;
        e.preventDefault();
        if (next === -1) {
          (showTabs
            ? tabsRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
            : search.current
          )?.focus();
          return;
        }
        focusCell(next);
      }}
    >
      {shown.map((em, i) => (
        <button
          key={em.id}
          type="button"
          data-emoji={em.id}
          tabIndex={i === index ? 0 : -1}
          aria-label={emojiButtonLabel(em)}
          title={`${em.fallback} ${packLabel(em)}`}
          onFocus={() => setFocusIndex(i)}
          onClick={() => onPick({ id: em.id, fallback: em.fallback })}
          className="flex size-10 items-center justify-center rounded-md transition-colors outline-none hover:bg-muted focus-visible:bg-brand-soft focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring focus-visible:outline-solid"
        >
          <CustomEmojiPreview id={em.id} fallback={em.fallback} hasPreview={em.hasPreview} />
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={search}
          type="search"
          value={query}
          aria-label="Rechercher un emoji animé (emoji ou nom du pack)"
          placeholder="Emoji ou nom du pack"
          autoComplete="off"
          className="pl-8"
          onChange={(e) => {
            setQuery(e.target.value);
            setFocusIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && shown.length > 0) {
              e.preventDefault();
              if (showTabs)
                tabsRef.current
                  ?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
                  ?.focus();
              else focusCell(0);
            } else if (e.key === "Enter") {
              // Entrée dans la recherche : le premier résultat (le formulaire autour n'est pas envoyé).
              e.preventDefault();
              const first = shown[0];
              if (first) onPick({ id: first.id, fallback: first.fallback });
            }
          }}
        />
      </div>

      {showTabs ? (
        <div
          ref={tabsRef}
          role="tablist"
          aria-label="Packs d'emojis animés"
          className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5"
          onKeyDown={(e) => {
            const current = tabs.findIndex((t) => t.key === activeTab);
            if (e.key === "ArrowDown") {
              e.preventDefault();
              focusCell(0);
              return;
            }
            const next = tabMove(current, e.key, tabs.length);
            if (next === null) return;
            e.preventDefault();
            selectTab(tabs[next]!.key);
            tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
          }}
        >
          {tabs.map((t) => {
            const selected = t.key === activeTab;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`${uid}-tab-${t.key}`}
                aria-selected={selected}
                aria-controls={`${uid}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => selectTab(t.key)}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center rounded-md px-2.5 text-note font-medium whitespace-nowrap transition-colors outline-none max-md:h-10",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
                  selected
                    ? "bg-muted text-foreground shadow-[inset_0_-2px_0_var(--brand-ink)]"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                {t.key === RECENT_TAB ? "Récents de l'équipe" : t.label}
                <span className="sr-only"> ({emojiCount(t.count)})</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {shown.length === 0 ? (
        <p className="px-1 py-4 text-center text-body text-muted-foreground" role="status">
          Aucun emoji animé pour « {query.trim()} ».
        </p>
      ) : showTabs ? (
        <div role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${activeTab}`}>
          {grid}
        </div>
      ) : (
        grid
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
        <span className="text-note text-muted-foreground" aria-live="polite">
          {searching ? emojiCount(shown.length) : emojiCount(items.length)}
        </span>
        <a
          href={CUSTOM_EMOJI_LIBRARY_HREF}
          target="_blank"
          rel="noreferrer"
          aria-label="Gérer la bibliothèque des emojis animés (nouvel onglet)"
          className="inline-flex items-center gap-1 rounded-sm text-note font-medium text-brand-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-md:min-h-10 [&_svg]:size-3.5"
        >
          Gérer la bibliothèque
          <ExternalLink aria-hidden />
        </a>
      </div>
    </div>
  );
}

/**
 * Bouton « Emoji animé » de la barre d'outils de l'éditeur et sa fenêtre (sélecteur). `onOpen` : juste avant
 * l'ouverture (l'éditeur retient alors la position du curseur) ; `onClosed(emoji)` : fenêtre fermée, avec l'emoji
 * choisi ou null (Échap, clic à côté) ; c'est à l'appelant de remettre le curseur et d'insérer l'emoji.
 */
export function CustomEmojiPickerButton({
  onOpen,
  onClosed,
  className,
}: {
  onOpen?: () => void;
  onClosed: (emoji: PickedEmoji | null) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const picked = useRef<PickedEmoji | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) {
          picked.current = null;
          onOpen?.();
        }
        setOpen(next);
      }}
      onOpenChangeComplete={(isOpen) => {
        if (isOpen) return;
        const emoji = picked.current;
        picked.current = null;
        onClosed(emoji);
      }}
    >
      {/* Nom visible « Emoji animé » : c'est celui que donnent le guide et les écrans (pas d'info-bulle sur téléphone). */}
      <Popover.Trigger
        render={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={cn("px-2 max-md:h-10", className)}
            aria-label="Insérer un emoji animé"
            title="Insérer un emoji animé"
            aria-haspopup="dialog"
          />
        }
      >
        <Sticker aria-hidden />
        <span>Emoji animé</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="isolate z-50 outline-none"
        >
          <Popover.Popup
            aria-label="Emojis animés"
            initialFocus={searchRef}
            finalFocus={false}
            data-slot="custom-emoji-picker"
            className="w-[min(22rem,calc(100vw-1rem))] origin-(--transform-origin) rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-md outline-none data-ending-style:opacity-0 data-starting-style:opacity-0 motion-safe:transition-opacity motion-safe:duration-100"
          >
            <CustomEmojiPicker
              searchRef={searchRef}
              onPick={(emoji) => {
                picked.current = emoji;
                setOpen(false);
              }}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import type { SearchHit, SearchResponse } from "@/lib/search/query";

/** Événement global pour ouvrir la recherche (raccourcis, autres composants). */
export const SEARCH_OPEN_EVENT = "lap:search";

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/**
 * Recherche globale : bouton loupe dans l'en-tête, fenêtre avec champ, résultats groupés,
 * navigation au clavier (↑ ↓ Entrée Échap). Ouverture par ⌘K / Ctrl+K, par `/` hors d'un champ,
 * ou par l'événement `lap:search`.
 */
export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const titleId = useId();

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setData(null);
    setActive(0);
    setError(null);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !isEditable(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(SEARCH_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(SEARCH_OPEN_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const term = q.trim();
  const shortQuery = term.length < 2;

  useEffect(() => {
    if (!open || term.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: ctrl.signal,
          headers: { accept: "application/json" },
        });
        if (!res.ok) throw new Error(String(res.status));
        setData((await res.json()) as SearchResponse);
        setActive(0);
      } catch (err) {
        if ((err as { name?: string }).name !== "AbortError")
          setError("La recherche n'a pas abouti. Réessayez.");
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [term, open]);

  // Résultats affichés : jamais ceux d'une requête précédente quand le champ est (presque) vide.
  const results = shortQuery ? null : data;
  const flat: Array<SearchHit & { group: string }> = results
    ? results.groups.flatMap((g) => g.hits.map((h) => ({ ...h, group: g.key })))
    : [];

  const go = (hit: SearchHit | undefined) => {
    if (!hit) return;
    close();
    router.push(hit.href);
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (flat.length ? (a + 1) % flat.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (flat.length ? (a - 1 + flat.length) % flat.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(flat[active]);
    }
  };

  useEffect(() => {
    if (!open) return;
    const el = document.getElementById(`${listId}-${active}`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open, listId]);

  return (
    <>
      <button
        type="button"
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted md:min-w-0 md:shrink",
          "md:h-9 md:w-full md:max-w-xs md:justify-start md:gap-2 md:border md:border-input md:bg-background md:px-3 md:text-muted-foreground md:hover:bg-surface md:hover:text-foreground lg:max-w-sm",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        )}
        aria-label="Rechercher (raccourci ⌘K ou /)"
        aria-keyshortcuts="Meta+K Control+K /"
        onClick={() => setOpen(true)}
      >
        <Search aria-hidden className="size-5 md:size-4" />
        <span className="hidden flex-1 text-left text-body md:inline">Rechercher</span>
        <kbd className="hidden rounded border border-border bg-surface px-1.5 font-sans text-note text-muted-foreground md:inline">
          ⌘K
        </kbd>
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-night/40 p-3 pt-[10vh] sm:p-6 sm:pt-[12vh]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-surface text-foreground shadow-lg"
          >
            <h2 id={titleId} className="sr-only">
              Recherche globale
            </h2>
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input
                ref={inputRef}
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onInputKey}
                placeholder="Membre, @pseudo, identifiant, message, canal, pub, règle…"
                aria-label="Rechercher dans LinkAffi Pro"
                aria-controls={listId}
                aria-activedescendant={flat.length ? `${listId}-${active}` : undefined}
                aria-autocomplete="list"
                role="combobox"
                aria-expanded={flat.length > 0}
                autoComplete="off"
                className="h-12 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-body [&::-webkit-search-cancel-button]:appearance-none"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Fermer la recherche"
                onClick={close}
              >
                <X className="size-4" />
              </Button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {error ? (
                <p role="alert" className="px-4 py-3 text-body text-danger">
                  {error}
                </p>
              ) : null}
              {!error && shortQuery ? (
                <p className="px-4 py-3 text-body text-muted-foreground">
                  Tapez au moins deux caractères. Flèches pour choisir, Entrée pour ouvrir, Échap
                  pour fermer.
                </p>
              ) : null}
              {!error && !shortQuery && !loading && results && results.groups.length === 0 ? (
                <p className="px-4 py-3 text-body text-muted-foreground">
                  Aucun résultat pour « {results.q} ».
                </p>
              ) : null}
              {!shortQuery && loading && !results ? (
                <p className="px-4 py-3 text-body text-muted-foreground">Recherche…</p>
              ) : null}
              {results && results.groups.length > 0 ? (
                <ul id={listId} role="listbox" aria-label="Résultats de recherche" className="py-1">
                  {results.groups.map((g) => {
                    const offset = flat.findIndex((h) => h.group === g.key);
                    return (
                      <li key={g.key} role="presentation">
                        <div className="px-4 pt-3 pb-1 text-note font-semibold text-muted-foreground">
                          {g.label}
                        </div>
                        <ul role="group" aria-label={g.label}>
                          {g.hits.map((h, i) => {
                            const idx = offset + i;
                            const selected = idx === active;
                            return (
                              <li
                                key={h.id}
                                id={`${listId}-${idx}`}
                                role="option"
                                aria-selected={selected}
                                className={cn(
                                  "flex min-h-10 cursor-pointer flex-col justify-center px-4 py-2 text-body",
                                  selected ? "bg-brand-soft text-foreground" : "hover:bg-muted",
                                )}
                                onMouseEnter={() => setActive(idx)}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => go(h)}
                              >
                                <span className="truncate font-medium">{h.title}</span>
                                {h.subtitle ? (
                                  <span className="truncate text-note text-muted-foreground">
                                    {h.subtitle}
                                  </span>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

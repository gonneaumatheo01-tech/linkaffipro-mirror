"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SEARCH_OPEN_EVENT } from "./global-search";

const SHORTCUTS: Array<[string, string]> = [
  ["⌘K ou Ctrl+K", "Ouvrir la recherche"],
  ["/", "Ouvrir la recherche (hors d'un champ de saisie)"],
  ["n", "Nouveau message (depuis la page Messages)"],
  ["?", "Afficher cette liste"],
  ["Échap", "Fermer la fenêtre ouverte"],
];

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/**
 * Raccourcis clavier de l'interface : `?` liste les raccourcis, `n` crée un message depuis /messages,
 * `/` et ⌘K ouvrent la recherche (événement `lap:search`).
 */
export function Shortcuts() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape" && open) {
        setOpen(false);
        return;
      }
      if (isEditable(e.target)) return;
      if (e.key === "?") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "n" && (pathname === "/messages" || pathname.startsWith("/messages?"))) {
        e.preventDefault();
        router.push("/messages/new");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pathname, router]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lap-shortcuts-title"
        className="w-full max-w-md rounded-xl border bg-background p-5 shadow-lg"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="lap-shortcuts-title" className="text-base font-semibold">
            Raccourcis clavier
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Fermer la liste des raccourcis"
            onClick={() => setOpen(false)}
          >
            Fermer
          </Button>
        </div>
        <dl className="space-y-2 text-sm">
          {SHORTCUTS.map(([keys, label]) => (
            <div key={keys} className="flex items-center justify-between gap-3">
              <dt>
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {keys}
                </kbd>
              </dt>
              <dd className="text-right text-muted-foreground">{label}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 text-right">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setOpen(false);
              window.dispatchEvent(new Event(SEARCH_OPEN_EVENT));
            }}
          >
            Ouvrir la recherche
          </Button>
        </div>
      </div>
    </div>
  );
}

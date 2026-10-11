"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useIsMac } from "@/components/editor/use-is-mac";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SEARCH_OPEN_EVENT } from "./global-search";
import { shortcutSections } from "./shortcuts-logic";

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/**
 * Raccourcis clavier de l'interface : `?` affiche la liste (boîte de dialogue : focus gardé dedans, Échap, retour
 * du focus), `n` crée un message depuis /messages, `/` et ⌘K ouvrent la recherche (événement `lap:search`). La
 * liste rappelle aussi la mise en forme d'un texte de message (⌘B, ⌘I, ⌘U, ⌘K, ⌘⇧X : `shortcuts-logic.ts`).
 */
export function Shortcuts() {
  const [open, setOpen] = useState(false);
  const openSearchAfterClose = useRef(false);
  const pathname = usePathname();
  const router = useRouter();
  const isMac = useIsMac();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditable(e.target)) return;
      if (e.key === "?") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "n" && !open && pathname === "/messages") {
        e.preventDefault();
        router.push("/messages/new");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pathname, router]);

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => {
        // La recherche s'ouvre une fois cette fenêtre fermée (sinon le focus rendu ici lui serait repris).
        if (isOpen || !openSearchAfterClose.current) return;
        openSearchAfterClose.current = false;
        window.dispatchEvent(new Event(SEARCH_OPEN_EVENT));
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Raccourcis clavier</DialogTitle>
          <DialogDescription>Pour aller plus vite au clavier.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {shortcutSections(isMac).map((section) => (
            <section key={section.key} aria-labelledby={`lap-shortcuts-${section.key}`}>
              <h3
                id={`lap-shortcuts-${section.key}`}
                className="mb-1.5 text-note font-semibold text-muted-foreground"
              >
                {section.title}
              </h3>
              <dl className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 text-body">
                {section.rows.map((row) => (
                  <div key={row.keys} className="contents">
                    <dt>
                      <kbd className="inline-flex min-w-7 justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-note text-foreground">
                        {row.keys}
                      </kbd>
                    </dt>
                    <dd>{row.label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <DialogFooter showCloseButton>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              openSearchAfterClose.current = true;
              setOpen(false);
            }}
          >
            Ouvrir la recherche
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

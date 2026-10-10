"use client";

import { useId, useState } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";

/**
 * Zone de filtres : toujours visible sur ordinateur ; repliée sur téléphone derrière « Filtres (n) » pour que le
 * calendrier (ou la liste) reste lisible d'abord. Le contenu (un formulaire GET) est rendu une seule fois.
 */
export function CollapsibleFilters({
  activeCount,
  children,
  className,
}: {
  /** Nombre de filtres posés (affiché sur le bouton du téléphone). */
  activeCount: number;
  children: React.ReactNode;
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      <Button
        type="button"
        variant="outline"
        className="w-full justify-between md:hidden"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="inline-flex items-center gap-2">
          <SlidersHorizontal aria-hidden />
          Filtres{activeCount > 0 ? ` (${activeCount})` : ""}
        </span>
        <ChevronDown aria-hidden className={cn("transition-transform", open && "rotate-180")} />
      </Button>
      <div id={id} className={cn(open ? "mt-3 block" : "hidden", "md:mt-0 md:block")}>
        {children}
      </div>
    </div>
  );
}

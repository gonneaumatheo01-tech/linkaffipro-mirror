"use client";

import { ListTree } from "lucide-react";

/**
 * Bouton « Sommaire » du guide sur téléphone et tablette : il reste visible en bas à droite (au-dessus de la barre du
 * bas) et ramène au sommaire, qu'il ouvre. Sans JavaScript, c'est un simple lien vers le sommaire. Sur grand écran,
 * le sommaire est déjà une colonne fixe : le bouton est masqué.
 */
export function TocJumpButton({ targetId }: { targetId: string }) {
  return (
    <a
      href={`#${targetId}`}
      onClick={() => {
        const details = document.getElementById(targetId)?.querySelector("details");
        if (details) details.open = true;
      }}
      className="fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[calc(3.5rem+env(safe-area-inset-bottom)+1rem)] z-30 inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card px-4 text-body font-medium text-foreground shadow-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:bottom-6 lg:hidden"
    >
      <ListTree aria-hidden className="size-4" />
      Sommaire
    </a>
  );
}

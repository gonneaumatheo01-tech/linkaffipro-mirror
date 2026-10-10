"use client";

import { GripVertical } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { PALETTE, paletteNodeType, type PaletteKey } from "@/lib/automations/flow";
import { NODE_TONES, nodeIcon } from "./nodes";

/** Type de données glissées de la bibliothèque vers le canevas. */
export const PALETTE_DRAG_TYPE = "application/x-linkaffi-block";

/**
 * Bibliothèque de blocs : chaque bloc se glisse sur le canevas (posé là où on le lâche, à relier ensuite), ou se pose
 * d'un clic (ou Entrée) après le bloc choisi. `targetLabel` dit où ira le bloc ajouté au clic.
 */
export function BlockPalette({
  onAdd,
  targetLabel,
}: {
  onAdd: (key: PaletteKey) => void;
  targetLabel: string;
}) {
  return (
    <section aria-labelledby="bibliotheque-titre" className="space-y-2">
      <div>
        <h2 id="bibliotheque-titre" className="text-body font-semibold text-foreground">
          Bibliothèque
        </h2>
        <p className="text-note text-muted-foreground">
          Glissez un bloc sur le canevas, ou cliquez pour l&apos;ajouter {targetLabel}.
        </p>
      </div>
      <ul className="grid gap-1.5 md:grid-cols-4 xl:grid-cols-1">
        {PALETTE.map((p) => {
          const type = paletteNodeType(p.key);
          return (
            <li key={p.key}>
              <button
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(PALETTE_DRAG_TYPE, p.key);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => onAdd(p.key)}
                title={p.help}
                aria-describedby={`bloc-${p.key}-aide`}
                className={cn(
                  "group flex w-full cursor-grab items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-2 text-left text-body transition-colors",
                  "hover:border-brand/60 hover:bg-brand-soft/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:cursor-grabbing",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-md [&>svg]:size-3.5",
                    NODE_TONES[type],
                  )}
                >
                  {nodeIcon(type, { action: { type: p.key } })}
                </span>
                <span className="min-w-0 flex-1 font-medium text-foreground">{p.label}</span>
                <GripVertical aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </button>
              <span id={`bloc-${p.key}-aide`} className="sr-only">
                {p.help}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

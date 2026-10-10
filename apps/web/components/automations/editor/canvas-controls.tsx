"use client";

import { LayoutGrid, Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { useReactFlow, type FitViewOptions } from "@xyflow/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";

/**
 * Commandes du canevas (zoom, ajuster à l'écran, ranger les blocs), en français. Barre posée AU-DESSUS du canevas (et
 * non flottante dedans) : elle ne recouvre jamais un bloc. À placer dans un `ReactFlowProvider`.
 */
export function CanvasControls({
  onLayout,
  fitViewOptions,
  className,
  children,
}: {
  /** « Ranger les blocs » (éditeur seulement). */
  onLayout?: () => void;
  fitViewOptions: FitViewOptions;
  className?: string;
  /** Texte d'aide à droite de la barre. */
  children?: React.ReactNode;
}) {
  const rf = useReactFlow();
  return (
    <div
      className={cn(
        "flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface px-2 py-1",
        className,
      )}
    >
      <div role="toolbar" aria-label="Commandes du canevas" className="flex items-center gap-0.5">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Zoom avant"
          title="Zoom avant"
          onClick={() => void rf.zoomIn({ duration: 200 })}
        >
          <ZoomIn aria-hidden />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Zoom arrière"
          title="Zoom arrière"
          onClick={() => void rf.zoomOut({ duration: 200 })}
        >
          <ZoomOut aria-hidden />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Ajuster à l'écran"
          title="Ajuster à l'écran"
          onClick={() => void rf.fitView({ duration: 300, ...fitViewOptions })}
        >
          <Maximize aria-hidden />
        </Button>
        {onLayout ? (
          <>
            <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
            <Button type="button" size="sm" variant="ghost" onClick={onLayout}>
              <LayoutGrid aria-hidden />
              Ranger les blocs
            </Button>
          </>
        ) : null}
      </div>
      {children ? <p className="text-note text-muted-foreground">{children}</p> : null}
    </div>
  );
}

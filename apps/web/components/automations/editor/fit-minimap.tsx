"use client";

import { MiniMap, useStore, type MiniMapProps, type Node } from "@xyflow/react";
import {
  MINIMAP_NODE_RADIUS,
  minimapBox,
  minimapNeeded,
  type Box,
  type Rect,
} from "@/lib/automations/flow-view";

/**
 * Mini-carte du parcours, montrée seulement quand le parcours ne tient pas à l'écran (`minimapNeeded` : blocs
 * mesurés par le canevas comparés à sa taille) ; cadre à la forme du parcours dans `maxSize` (`minimapBox` : en
 * hauteur pour un parcours vertical) ; blocs aux couleurs franches de leur type, bordure fixe à l'écran (classes
 * `is-<type>` de `flow.css`). À placer dans `<ReactFlow>`.
 */
export function FitMiniMap<N extends Node>({
  maxSize,
  style,
  ...props
}: MiniMapProps<N> & { maxSize: Box }) {
  // Chaîne « largeur×hauteur » (valeur simple : pas de nouveau rendu tant que la taille ne change pas).
  const box = useStore((s) => {
    const rects: Rect[] = [];
    for (const n of s.nodeLookup.values()) {
      const width = n.measured?.width ?? 0;
      const height = n.measured?.height ?? 0;
      if (!width || !height) return "";
      const { x, y } = n.internals.positionAbsolute;
      rects.push({ x, y, width, height });
    }
    if (!minimapNeeded(rects, { width: s.width, height: s.height })) return "";
    const b = minimapBox(rects, maxSize);
    return b ? `${b.width}x${b.height}` : "";
  });
  if (!box) return null;
  const [width, height] = box.split("x").map(Number);
  return (
    <MiniMap<N>
      nodeBorderRadius={MINIMAP_NODE_RADIUS}
      {...props}
      style={{ ...style, width, height }}
    />
  );
}

"use client";

import "@xyflow/react/dist/base.css";
import "./editor/flow.css";

import { useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type FitViewOptions,
} from "@xyflow/react";
import type { AutomationGraph, GraphNames, NodeRunStats } from "@linkaffipro/core";
import { graphToDraft } from "@/lib/automations/flow";
import {
  MINIMAP_LARGE,
  miniMapClass,
  readOnlyCanvasHeight,
  syncViewNodes,
  usedExits,
  viewEdges,
} from "@/lib/automations/flow-view";
import { CanvasControls } from "./editor/canvas-controls";
import { FitMiniMap } from "./editor/fit-minimap";
import { FlowContext, type FlowContextValue } from "./editor/editor-context";
import { NODE_TYPES, type FlowNode } from "./editor/nodes";
import { FLOW_ARIA_FR } from "./editor/aria";
import { useIsDesktop } from "./editor/use-desktop";

/**
 * Ajustement de la vue : jamais en dessous de 0,85 (texte des blocs et passages lisibles) ; un parcours plus grand
 * que le canevas se déplace à la souris.
 */
const FIT_VIEW: FitViewOptions = { padding: "32px", minZoom: 0.85, maxZoom: 1 };

/**
 * Parcours d'une relance en lecture seule, avec les passages de chaque bloc (fiche d'une relance) : zoom et
 * déplacement de la vue seulement. La hauteur suit la profondeur du parcours (`readOnlyCanvasHeight`) pour garder les
 * blocs à une échelle lisible ; la molette fait défiler la page, pas le zoom. Monté sur ordinateur uniquement (le
 * tableau « par bloc » sert d'alternative accessible et d'affichage sur téléphone).
 */
export function RuleFlowView({
  graph,
  names,
  triggerText,
  filtersText,
  stats,
}: {
  graph: AutomationGraph;
  names: GraphNames;
  triggerText: string;
  filtersText: string;
  stats: Record<string, NodeRunStats>;
}) {
  const desktop = useIsDesktop();
  const draft = useMemo(() => graphToDraft(graph), [graph]);
  const height = readOnlyCanvasHeight(draft);
  const nodes = useMemo(
    () =>
      syncViewNodes<FlowNode>([], draft, names, triggerText).map((n) => ({
        ...n,
        draggable: false,
        selectable: false,
        connectable: false,
      })),
    [draft, names, triggerText],
  );
  const edges = useMemo(() => viewEdges<Edge>([], draft, new Set(), names), [draft, names]);
  const ctx: FlowContextValue = {
    readOnly: true,
    issues: {},
    names,
    triggerText,
    filtersText,
    usedExits: usedExits(draft),
    stats,
  };
  if (!desktop)
    return (
      <div
        aria-hidden
        style={{ height: height + 44 }}
        className="rounded-xl border border-border bg-muted/40"
      />
    );
  return (
    <FlowContext.Provider value={ctx}>
      <ReactFlowProvider>
        <div className="lap-flow is-readonly overflow-hidden rounded-xl border border-border">
          <CanvasControls fitViewOptions={FIT_VIEW}>
            Faites glisser le parcours pour le déplacer.
          </CanvasControls>
          {/* Parcours figé : le canevas gère seul ses blocs (tailles mesurées, mini-carte). */}
          <div style={{ height }}>
            <ReactFlow<FlowNode, Edge>
              defaultNodes={nodes}
              defaultEdges={edges}
              nodeTypes={NODE_TYPES}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              edgesFocusable={false}
              nodesFocusable={false}
              deleteKeyCode={null}
              fitView
              fitViewOptions={FIT_VIEW}
              minZoom={0.3}
              maxZoom={1.5}
              zoomOnScroll={false}
              panOnScroll={false}
              preventScrolling={false}
              ariaLabelConfig={FLOW_ARIA_FR}
              aria-label="Parcours de la relance (lecture seule)"
            >
              <Background variant={BackgroundVariant.Dots} gap={16} size={1.25} />
              <FitMiniMap<FlowNode>
                position="top-right"
                pannable
                zoomable
                ariaLabel="Mini-carte du parcours"
                maxSize={MINIMAP_LARGE}
                nodeClassName={(n) => miniMapClass(n.type, false)}
              />
            </ReactFlow>
          </div>
        </div>
      </ReactFlowProvider>
    </FlowContext.Provider>
  );
}

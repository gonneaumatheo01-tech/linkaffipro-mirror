"use client";

import { createContext, useContext } from "react";
import type { GraphHandle, GraphIssue, GraphNames, NodeRunStats } from "@linkaffipro/core";
import type { PaletteKey } from "@/lib/automations/flow";

/** Ce que les blocs du canevas lisent (problèmes, noms, déclencheur, passages) sans le recopier dans chaque bloc. */
export type FlowContextValue = {
  readOnly: boolean;
  issues: Record<string, GraphIssue[]>;
  names: GraphNames;
  /** Libellé du déclencheur et des filtres, affichés dans le bloc de départ. */
  triggerText: string;
  filtersText: string;
  /** Sorties occupées par un lien (« id:handle »). */
  usedExits: Set<string>;
  /** Fiche d'une relance : passages par bloc. */
  stats?: Record<string, NodeRunStats>;
  /** Pose un bloc après une sortie libre (bouton « + » sous le bloc). */
  onAddAfter?: (nodeId: string, handle: GraphHandle, key: PaletteKey) => void;
};

export const FlowContext = createContext<FlowContextValue>({
  readOnly: true,
  issues: {},
  names: {},
  triggerText: "",
  filtersText: "",
  usedExits: new Set(),
});

export function useFlowContext(): FlowContextValue {
  return useContext(FlowContext);
}

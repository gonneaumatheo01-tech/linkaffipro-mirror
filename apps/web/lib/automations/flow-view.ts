/**
 * Passage entre le brouillon de l'éditeur (`flow.ts`) et les blocs / liens affichés par le canevas @xyflow/react.
 * Types structurels (sans importer @xyflow) : fonctions pures, testées dans flow-view.test.ts.
 */
import {
  GRAPH_HANDLE_LABELS,
  GRAPH_NODE_LABELS,
  GRAPH_HANDLES,
  type GraphHandle,
  type GraphNames,
  type GraphNodeType,
} from "@linkaffipro/core";
import {
  draftNodeLabel,
  draftNodePhrase,
  type Draft,
  type DraftNode,
  type DraftNodeData,
  type NodeSizes,
} from "./flow";
import { fromPhrase } from "./labels";

export type ViewNode = {
  id: string;
  type: GraphNodeType;
  position: { x: number; y: number };
  data: { payload: DraftNodeData };
  selected?: boolean;
  deletable?: boolean;
  ariaLabel?: string;
  measured?: { width?: number; height?: number };
};

export type ViewEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  /** Texte du lien (« Oui » / « Non ») ; type large pour accepter celui du canevas (nœud React). */
  label?: unknown;
  className?: string;
  ariaLabel?: string;
  type?: string;
  selected?: boolean;
};

/** Nom d'un bloc pour les lecteurs d'écran (« Condition : A déjà déposé ? »). */
export function nodeAriaLabel(node: DraftNode, names: GraphNames = {}, triggerText = ""): string {
  if (node.type === "stop") return "Arrêter : fin de la relance";
  if (node.type === "wait") return draftNodeLabel(node, names);
  const what = node.type === "trigger" ? triggerText || "à régler" : draftNodeLabel(node, names);
  return `${GRAPH_NODE_LABELS[node.type]} : ${what}`;
}

/**
 * Blocs du canevas à partir du brouillon, en gardant ce que le canevas sait déjà de chaque bloc (taille mesurée,
 * sélection) : un bloc existant est mis à jour, un bloc nouveau est créé, un bloc disparu est retiré.
 */
export function syncViewNodes<T extends ViewNode>(
  prev: readonly T[],
  d: Draft,
  names: GraphNames = {},
  triggerText = "",
): T[] {
  const byId = new Map(prev.map((n) => [n.id, n]));
  return d.nodes.map((n) => {
    const old = byId.get(n.id);
    return {
      ...(old ?? {}),
      id: n.id,
      type: n.type,
      position: { ...n.position },
      data: { payload: n.data },
      deletable: n.type !== "trigger",
      ariaLabel: nodeAriaLabel(n, names, triggerText),
    } as T;
  });
}

const isHandle = (h: unknown): h is GraphHandle =>
  (GRAPH_HANDLES as readonly unknown[]).includes(h);

/** Brouillon à partir des blocs et liens du canevas (positions déplacées à la souris comprises). */
export function draftFromView(nodes: readonly ViewNode[], edges: readonly ViewEdge[]): Draft {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: { x: n.position.x, y: n.position.y },
      data: n.data.payload,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      sourceHandle: isHandle(e.sourceHandle) ? e.sourceHandle : "next",
      target: e.target,
    })),
  };
}

/**
 * Liens du canevas : libellé « Oui » / « Non » sur les sorties d'une condition, classe de couleur, lien en erreur
 * surligné, nom pour les lecteurs d'écran (« Lien du départ vers l'attente de 1 jour »). La sélection est gardée.
 */
export function viewEdges<T extends ViewEdge>(
  prev: readonly T[],
  d: Draft,
  invalid: ReadonlySet<string>,
  names: GraphNames = {},
): T[] {
  const selected = new Set(prev.filter((e) => e.selected).map((e) => e.id));
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const name = (id: string) => {
    const n = byId.get(id);
    return n ? draftNodePhrase(n, names) : "un bloc supprimé";
  };
  return d.edges.map(
    (e) =>
      ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: "in",
        type: "smoothstep",
        label: e.sourceHandle === "next" ? undefined : GRAPH_HANDLE_LABELS[e.sourceHandle],
        className: [`is-${e.sourceHandle}`, invalid.has(e.id) ? "is-invalid" : ""]
          .filter(Boolean)
          .join(" "),
        ariaLabel: `Lien${e.sourceHandle === "next" ? "" : ` « ${GRAPH_HANDLE_LABELS[e.sourceHandle]} »`} ${fromPhrase(name(e.source))} vers ${name(e.target)}`,
        selected: selected.has(e.id),
      }) as T,
  );
}

/** Sorties occupées (« id:handle »), pour n'afficher le « + » que sous une sortie libre. */
export function usedExits(d: Draft): Set<string> {
  return new Set(d.edges.map((e) => `${e.source}:${e.sourceHandle}`));
}

/** Classe d'un bloc dans la mini-carte (couleur du type, rouge s'il est à corriger). */
export function miniMapClass(type: GraphNodeType, invalid: boolean): string {
  return invalid ? "is-invalid" : `is-${type}`;
}

/** Tailles mesurées par le canevas, pour poser un bloc neuf sans recouvrir les autres. */
export function measuredSizes(nodes: readonly ViewNode[]): NodeSizes {
  return Object.fromEntries(nodes.map((n) => [n.id, n.measured]));
}

/** Hauteur d'un bloc affiché avec ses passages (fiche d'une relance), en pixels à l'échelle 1. */
const VIEW_NODE_HEIGHT = 170;

/**
 * Hauteur du parcours en lecture seule (fiche d'une relance) : de quoi montrer tous les blocs à l'échelle 1 (texte et
 * passages lisibles), entre `min` et `max` ; au-delà, le canevas garde une échelle lisible et se déplace à la souris.
 */
export function readOnlyCanvasHeight(
  d: Draft,
  { min = 280, max = 820, padding = 32 }: { min?: number; max?: number; padding?: number } = {},
): number {
  if (d.nodes.length === 0) return min;
  const ys = d.nodes.map((n) => n.position.y);
  const span = Math.max(...ys) - Math.min(...ys) + VIEW_NODE_HEIGHT + 2 * padding;
  return Math.round(Math.min(max, Math.max(min, span)));
}

/**
 * Hauteur du canevas de l'éditeur : il remplit l'écran depuis son haut (`top`, en pixels depuis le haut de la page)
 * jusqu'à `bottom` px du bas de la fenêtre, entre `min` et `max` : la mini-carte et le bas du canevas restent visibles
 * sans faire défiler la page.
 */
export function fillHeight(
  viewportHeight: number,
  top: number,
  { min = 480, max = 960, bottom = 24 }: { min?: number; max?: number; bottom?: number } = {},
): number {
  return Math.round(Math.min(max, Math.max(min, viewportHeight - top - bottom)));
}

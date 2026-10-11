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

/**
 * Classe d'un bloc dans la mini-carte : couleurs du thème de son type (fond pâle et bordure de la pastille du bloc,
 * `flow.css`), rouge seulement s'il est à corriger.
 */
export function miniMapClass(type: GraphNodeType, invalid: boolean): string {
  return invalid ? "is-invalid" : `is-${type}`;
}

/**
 * Arrondi des blocs de la mini-carte (12 px du canevas, comme les blocs). La bordure, elle, est dans `flow.css` :
 * 1,5 px à l'écran quelle que soit la réduction (`vector-effect: non-scaling-stroke`).
 */
export const MINIMAP_NODE_RADIUS = 12;

export type Rect = { x: number; y: number; width: number; height: number };

export type Box = { width: number; height: number };

/** Cadres maximaux de la mini-carte : grand canevas (dès 720 px) et canevas moyen (dès 480 px). */
export const MINIMAP_LARGE: Box = { width: 140, height: 168 };
export const MINIMAP_SMALL: Box = { width: 120, height: 144 };
/** Cadre minimal : assez large pour une colonne de blocs lisible, assez haut pour un parcours tout en largeur. */
const MINIMAP_MIN: Box = { width: 96, height: 72 };

/**
 * Taille de la mini-carte à la forme du parcours (blocs mesurés), dans le cadre `max` : en hauteur pour un parcours
 * vertical (le cas courant), en largeur pour des branches côte à côte. Un cadre fixe en paysage réduisait une longue
 * colonne de blocs à des traits de 10 × 3 px. La taille ne dépend que des blocs (pas de la vue) : elle ne bouge pas
 * quand on fait défiler le canevas. null tant que rien n'est mesuré.
 */
export function minimapBox(rects: readonly Rect[], max: Box): Box | null {
  if (rects.length === 0) return null;
  const width = Math.max(...rects.map((r) => r.x + r.width)) - Math.min(...rects.map((r) => r.x));
  const height = Math.max(...rects.map((r) => r.y + r.height)) - Math.min(...rects.map((r) => r.y));
  if (width <= 0 || height <= 0) return null;
  const ratio = width / height;
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));
  if (ratio >= max.width / max.height)
    return { width: max.width, height: clamp(max.width / ratio, MINIMAP_MIN.height, max.height) };
  return { width: clamp(max.height * ratio, MINIMAP_MIN.width, max.width), height: max.height };
}

/**
 * La mini-carte n'aide que si le parcours ne tient pas à l'écran : vrai si ses blocs (marges de `padding` comprises)
 * dépassent le canevas à l'échelle 1 (l'échelle maximale de « Tout voir »). Faux tant que rien n'est mesuré.
 */
export function minimapNeeded(
  rects: readonly Rect[],
  canvas: { width: number; height: number },
  padding = 40,
): boolean {
  if (rects.length === 0 || canvas.width <= 0 || canvas.height <= 0) return false;
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  return maxX - minX + 2 * padding > canvas.width || maxY - minY + 2 * padding > canvas.height;
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

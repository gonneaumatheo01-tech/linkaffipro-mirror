/**
 * Modèle de l'éditeur visuel à branches (Membres → Relances automatiques → sur mesure) : brouillon de parcours tolérant
 * les blocs incomplets, opérations de l'éditeur (ajouter, insérer après, relier, supprimer, ranger), liste accessible
 * des blocs et validation en direct. Fonctions pures, sans React ni @xyflow (testées dans flow.test.ts).
 *
 * Le brouillon a la forme du graphe du core (`AutomationGraph`) mais accepte des données de bloc incomplètes :
 * `draftToRaw` le transforme en JSON validé ensuite par `validateGraph` / `parseGraph` du core.
 */
import {
  AUTOMATION_GRAPH_VERSION,
  GRAPH_ACTION_HELP,
  GRAPH_ACTION_LABELS,
  GRAPH_HANDLE_LABELS,
  GRAPH_NODE_SPACING_Y,
  GRAPH_TRIGGER_NODE_ID,
  describeCondition,
  formatWaitHours,
  graphForRule,
  graphHandlesFor,
  graphToLinear,
  issuesByNode,
  parseConditions,
  parseGraphAction,
  parseGraphCondition,
  validateGraph,
  validateTelegramHtml,
  type AutomationGraph,
  type GraphActionType,
  type GraphHandle,
  type GraphIssue,
  type GraphNames,
  type GraphNodeType,
  type GraphPosition,
} from "@linkaffipro/core";
import { actionLabel, nodePhrase } from "./labels";
import { entriesToButtons, toButtonEntry } from "./node-form";

// ---------- Types ----------

export type DraftNodeData = {
  /** Bloc « condition » : { kind, n?, levels?, languages?, tag?, channelId?, campaignIds? } (peut être incomplet). */
  condition?: Record<string, unknown>;
  /** Bloc « action » : mêmes champs qu'une action de relance (peut être incomplet). */
  action?: Record<string, unknown>;
  /** Bloc « attendre » : durée en heures (null : à choisir). */
  hours?: number | null;
};
export type DraftNode = {
  id: string;
  type: GraphNodeType;
  position: GraphPosition;
  data: DraftNodeData;
};
export type DraftEdge = { id: string; source: string; sourceHandle: GraphHandle; target: string };
export type Draft = { nodes: DraftNode[]; edges: DraftEdge[] };

/** Largeur d'une colonne quand l'éditeur range les blocs (un bloc fait environ 240 px). */
export const LAYOUT_COLUMN_X = 280;

/** Largeur d'un bloc du canevas (classe `w-60`). */
export const NODE_WIDTH = 240;

/**
 * Hauteur retenue pour repérer deux blocs qui se recouvrent : un bloc fait 90 à 150 px et deux étapes sont espacées de
 * 160 px ; au-delà, un bloc très haut (message d'erreur) ne pousse pas de côté le bloc de l'étape suivante.
 */
const NODE_BOX_HEIGHT = GRAPH_NODE_SPACING_Y - 24;

/** Espace laissé entre deux blocs voisins. */
const NODE_GAP = 24;

/** Tailles mesurées par le canevas (facultatives : largeur d'un bloc et hauteur bornée sinon). */
export type NodeSizes = Record<string, { width?: number; height?: number } | undefined>;

// ---------- Conversions ----------

/** Parcours enregistré (validé) → brouillon de l'éditeur. */
export function graphToDraft(graph: AutomationGraph): Draft {
  return {
    nodes: graph.nodes.map((n): DraftNode => {
      const base = { id: n.id, type: n.type, position: { ...n.position } };
      switch (n.type) {
        case "condition":
          return { ...base, data: { condition: { ...n.condition } } };
        case "action":
          return { ...base, data: { action: { ...n.action } } };
        case "wait":
          return { ...base, data: { hours: n.hours } };
        default:
          return { ...base, data: {} };
      }
    }),
    edges: graph.edges.map((e) => ({ ...e })),
  };
}

/** Brouillon → JSON du parcours (données à la racine des blocs), à valider par le core. */
export function draftToRaw(d: Draft): {
  version: typeof AUTOMATION_GRAPH_VERSION;
  nodes: Array<Record<string, unknown>>;
  edges: DraftEdge[];
} {
  return {
    version: AUTOMATION_GRAPH_VERSION,
    nodes: d.nodes.map((n) => {
      const out: Record<string, unknown> = {
        id: n.id,
        type: n.type,
        position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      };
      if (n.type === "condition") out.condition = n.data.condition ?? {};
      if (n.type === "action") out.action = n.data.action ?? {};
      if (n.type === "wait") out.hours = n.data.hours ?? null;
      return out;
    }),
    edges: d.edges.map((e) => ({ ...e })),
  };
}

const NODE_TYPE_SET = new Set<string>(["trigger", "condition", "action", "wait", "stop"]);

/**
 * Lecture tolérante d'un parcours enregistré illisible pour le core (ancien format, données abîmées) : tout ce qui a un
 * identifiant et un type connu est repris tel quel, pour que l'éditeur montre le problème au lieu de tout perdre.
 */
export function rawToDraft(raw: unknown): Draft {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const nodes: DraftNode[] = [];
  for (const rn of Array.isArray(o.nodes) ? o.nodes : []) {
    if (!rn || typeof rn !== "object") continue;
    const r = rn as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : "";
    const type =
      typeof r.type === "string" && NODE_TYPE_SET.has(r.type) ? (r.type as GraphNodeType) : null;
    if (!id || !type || nodes.some((n) => n.id === id)) continue;
    const p = (r.position ?? {}) as Record<string, unknown>;
    const field = (k: string) =>
      r[k] ??
      (r.data && typeof r.data === "object" ? (r.data as Record<string, unknown>)[k] : undefined);
    const obj = (v: unknown) =>
      v && typeof v === "object" ? { ...(v as Record<string, unknown>) } : {};
    const hours = Number(field("hours"));
    nodes.push({
      id,
      type,
      position: { x: Number(p.x) || 0, y: Number(p.y) || 0 },
      data:
        type === "condition"
          ? { condition: obj(field("condition")) }
          : type === "action"
            ? { action: obj(field("action")) }
            : type === "wait"
              ? { hours: Number.isFinite(hours) && hours > 0 ? hours : null }
              : {},
    });
  }
  if (!nodes.some((n) => n.type === "trigger"))
    nodes.unshift({
      id: GRAPH_TRIGGER_NODE_ID,
      type: "trigger",
      position: { x: 0, y: -GRAPH_NODE_SPACING_Y },
      data: {},
    });
  const ids = new Set(nodes.map((n) => n.id));
  const edges: DraftEdge[] = [];
  for (const re of Array.isArray(o.edges) ? o.edges : []) {
    if (!re || typeof re !== "object") continue;
    const r = re as Record<string, unknown>;
    const handle = r.sourceHandle === "yes" || r.sourceHandle === "no" ? r.sourceHandle : "next";
    if (typeof r.id !== "string" || !ids.has(String(r.source)) || !ids.has(String(r.target)))
      continue;
    edges.push({
      id: r.id,
      source: String(r.source),
      sourceHandle: handle,
      target: String(r.target),
    });
  }
  return { nodes, edges };
}

/** Liste d'actions illisible pour le core : une branche unique avec ce qui peut être repris (même tolérance). */
export function rawActionsToDraft(raw: unknown): Draft {
  const list = Array.isArray(raw) ? raw : [];
  const nodes: Array<Record<string, unknown>> = [
    { id: GRAPH_TRIGGER_NODE_ID, type: "trigger", position: { x: 0, y: 0 } },
  ];
  const edges: Array<Record<string, unknown>> = [];
  list.forEach((a, i) => {
    const o = a && typeof a === "object" ? (a as Record<string, unknown>) : {};
    const id = `n${i + 1}`;
    const position = { x: 0, y: (i + 1) * GRAPH_NODE_SPACING_Y };
    nodes.push(
      o.type === "wait"
        ? { id, type: "wait", position, hours: o.hours }
        : { id, type: "action", position, action: o },
    );
    edges.push({
      id: `e${i + 1}`,
      source: i === 0 ? GRAPH_TRIGGER_NODE_ID : `n${i}`,
      sourceHandle: "next",
      target: id,
    });
  });
  return rawToDraft({ nodes, edges });
}

/**
 * Brouillon d'une relance enregistrée pour l'éditeur : son parcours (ou sa liste d'actions en branche unique) ; si
 * les données sont illisibles, lecture tolérante et `readError` pour prévenir l'équipe.
 */
export function ruleToDraft(rule: { graph?: unknown; actions: unknown }): {
  draft: Draft;
  readError: string | null;
} {
  try {
    return { draft: graphToDraft(graphForRule(rule)), readError: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Parcours illisible.";
    const draft =
      rule.graph !== null && rule.graph !== undefined
        ? rawToDraft(rule.graph)
        : rawActionsToDraft(rule.actions);
    return { draft, readError: message };
  }
}

// ---------- Bibliothèque de blocs ----------

export type PaletteKey =
  | "condition"
  | "send_message"
  | "wait"
  | "tag"
  | "suggest_channel"
  | "notify_team"
  | "send_sequence"
  | "stop";

export type PaletteItem = { key: PaletteKey; label: string; help: string };

/** Blocs proposés par la bibliothèque, dans l'ordre d'affichage. */
export const PALETTE: readonly PaletteItem[] = [
  {
    key: "condition",
    label: "Condition (oui / non)",
    help: "Vérifie quelque chose sur le membre, puis continue par « oui » ou « non ».",
  },
  { key: "send_message", label: "Envoyer un message", help: GRAPH_ACTION_HELP.send_message },
  {
    key: "wait",
    label: "Attendre",
    help: "Fait une pause (de 1 heure à 90 jours) avant la suite.",
  },
  { key: "tag", label: "Étiqueter", help: GRAPH_ACTION_HELP.tag },
  { key: "suggest_channel", label: "Proposer un canal", help: GRAPH_ACTION_HELP.suggest_channel },
  { key: "notify_team", label: "Prévenir l'équipe", help: GRAPH_ACTION_HELP.notify_team },
  { key: "send_sequence", label: "Message du bot", help: GRAPH_ACTION_HELP.send_sequence },
  { key: "stop", label: "Arrêter", help: "Termine la relance pour ce membre." },
];

export function isPaletteKey(v: unknown): v is PaletteKey {
  return PALETTE.some((p) => p.key === v);
}

export function paletteItem(key: PaletteKey): PaletteItem {
  return PALETTE.find((p) => p.key === key)!;
}

/** Type de bloc créé par un élément de la bibliothèque. */
export function paletteNodeType(key: PaletteKey): GraphNodeType {
  return key === "condition" || key === "wait" || key === "stop" ? key : "action";
}

/** Données d'un bloc neuf (incomplet : surligné jusqu'à ce qu'il soit réglé ; l'attente vaut 1 jour). */
export function newNodeData(key: PaletteKey): DraftNodeData {
  switch (key) {
    case "condition":
      return { condition: { kind: "" } };
    case "wait":
      return { hours: 24 };
    case "stop":
      return {};
    case "send_message":
      return { action: { type: "send_message", text: "" } };
    case "notify_team":
      return { action: { type: "notify_team", text: "" } };
    case "tag":
      return { action: { type: "tag", tag: "" } };
    case "suggest_channel":
      return { action: { type: "suggest_channel", channelId: "", text: "" } };
    case "send_sequence":
      return { action: { type: "send_sequence", trigger: "" } };
  }
}

// ---------- Lecture ----------

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** 8 caractères au hasard (minuscules et chiffres). */
function randomToken(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
}

/**
 * Identifiant neuf d'un bloc (`n-…`) ou d'un lien (`e-…`), tiré au hasard : jamais celui d'un bloc supprimé. Un membre
 * en attente sur un bloc supprimé s'arrête donc (« Bloc introuvable ») au lieu de reprendre sur un autre bloc qui
 * aurait reçu le même identifiant.
 */
function freeId(d: Draft, prefix: "n" | "e"): string {
  const used = new Set([...d.nodes.map((n) => n.id), ...d.edges.map((e) => e.id)]);
  for (;;) {
    const id = `${prefix}-${randomToken()}`;
    if (!used.has(id)) return id;
  }
}

export function findNode(d: Draft, id: string | null | undefined): DraftNode | null {
  return (id && d.nodes.find((n) => n.id === id)) || null;
}

/** Sorties d'un bloc et leur suite (null : pas de lien = fin de la relance de ce côté). */
export function exitsOf(
  d: Draft,
  id: string,
): Array<{ handle: GraphHandle; target: string | null }> {
  const node = findNode(d, id);
  if (!node) return [];
  return graphHandlesFor(node.type).map((handle) => ({
    handle,
    target: d.edges.find((e) => e.source === id && e.sourceHandle === handle)?.target ?? null,
  }));
}

/** Blocs atteignables depuis `from` (lui compris). */
function reachable(d: Draft, from: string): Set<string> {
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of d.edges)
      if (e.source === cur && !seen.has(e.target)) {
        seen.add(e.target);
        queue.push(e.target);
      }
  }
  return seen;
}

/** Libellé d'un bloc du brouillon (« A déjà déposé ? », « Attendre 1 jour ») ; « … à compléter » si incomplet. */
export function draftNodeLabel(node: DraftNode, names: GraphNames = {}): string {
  switch (node.type) {
    case "trigger":
      return "Départ";
    case "stop":
      return "Arrêter";
    case "wait":
      return typeof node.data.hours === "number" && node.data.hours > 0
        ? `Attendre ${formatWaitHours(node.data.hours)}`
        : "Attendre (durée à choisir)";
    case "condition":
      try {
        return describeCondition(parseGraphCondition(node.data.condition), names);
      } catch {
        return "Condition à compléter";
      }
    case "action":
      try {
        return actionLabel(parseGraphAction(node.data.action), names);
      } catch {
        const t = node.data.action?.type as GraphActionType | undefined;
        return `${(t && GRAPH_ACTION_LABELS[t]) || "Action"} (à compléter)`;
      }
  }
}

/**
 * Le bloc du brouillon dans une phrase (« après le message « Bonjour Léa… » », « vers l'attente de 1 jour ») ; un bloc
 * incomplet est nommé par son libellé (« le bloc « Condition à compléter » »).
 */
export function draftNodePhrase(node: DraftNode, names: GraphNames = {}): string {
  switch (node.type) {
    case "trigger":
      return "le départ";
    case "stop":
      return "l'arrêt";
    case "wait":
      return typeof node.data.hours === "number" && node.data.hours > 0
        ? nodePhrase({ id: node.id, type: "wait", position: node.position, hours: node.data.hours })
        : "l'attente (durée à choisir)";
    case "condition":
      try {
        const condition = parseGraphCondition(node.data.condition);
        return nodePhrase(
          { id: node.id, type: "condition", position: node.position, condition },
          names,
        );
      } catch {
        return "le bloc « Condition à compléter »";
      }
    case "action":
      try {
        const action = parseGraphAction(node.data.action);
        return nodePhrase({ id: node.id, type: "action", position: node.position, action }, names);
      } catch {
        return `le bloc « ${draftNodeLabel(node, names)} »`;
      }
  }
}

// ---------- Place libre ----------

type Box = { x: number; y: number; w: number; h: number };

function boxOf(n: DraftNode, sizes?: NodeSizes): Box {
  const s = sizes?.[n.id];
  return {
    x: n.position.x,
    y: n.position.y,
    w: s?.width && s.width > 0 ? s.width : NODE_WIDTH,
    h: Math.min(s?.height && s.height > 0 ? s.height : NODE_BOX_HEIGHT, NODE_BOX_HEIGHT),
  };
}

/** Deux blocs se recouvrent-ils (ou se touchent-ils, à moins de `NODE_GAP` à l'horizontale) ? */
function boxesOverlap(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.w + NODE_GAP && b.x < a.x + a.w + NODE_GAP && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

/** Paires de blocs qui se recouvrent (contrôle des tests et de l'éditeur). */
export function overlappingNodes(d: Draft, sizes?: NodeSizes): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 0; i < d.nodes.length; i++)
    for (let j = i + 1; j < d.nodes.length; j++)
      if (boxesOverlap(boxOf(d.nodes[i]!, sizes), boxOf(d.nodes[j]!, sizes)))
        out.push([d.nodes[i]!.id, d.nodes[j]!.id]);
  return out;
}

/**
 * Pousse le bloc `id` à l'horizontale, du côté `side` (-1 : à gauche, 1 : à droite), jusqu'à une place où il ne
 * recouvre aucun autre bloc. La ligne (hauteur) ne change pas.
 */
export function placeClear(d: Draft, id: string, side: -1 | 1, sizes?: NodeSizes): Draft {
  const node = findNode(d, id);
  if (!node) return d;
  const me = boxOf(node, sizes);
  const others = d.nodes.filter((n) => n.id !== id).map((n) => boxOf(n, sizes));
  let x = me.x;
  for (let i = 0; i <= others.length; i++) {
    const hit = others.find((o) => boxesOverlap({ ...me, x }, o));
    if (!hit) break;
    x = side < 0 ? hit.x - me.w - NODE_GAP : hit.x + hit.w + NODE_GAP;
  }
  return x === me.x ? d : moveNodes(d, { [id]: { x, y: node.position.y } });
}

// ---------- Opérations ----------

/** Pose un bloc neuf (non relié) à une position du canevas, poussé à droite s'il recouvrait un bloc. */
export function addNode(
  d: Draft,
  key: PaletteKey,
  position: GraphPosition,
  sizes?: NodeSizes,
): { draft: Draft; id: string } {
  const id = freeId(d, "n");
  const node: DraftNode = { id, type: paletteNodeType(key), position, data: newNodeData(key) };
  return { draft: placeClear({ nodes: [...d.nodes, node], edges: d.edges }, id, 1, sizes), id };
}

/** Peut-on insérer ce bloc après cette sortie ? (« Arrêter » seulement sur une sortie libre : rien ne le suit.) */
export function canInsertAfter(
  d: Draft,
  sourceId: string,
  handle: GraphHandle,
  key: PaletteKey,
): boolean {
  const exit = exitsOf(d, sourceId).find((x) => x.handle === handle);
  if (!exit) return false;
  return !(key === "stop" && exit.target !== null);
}

/**
 * Insère un bloc neuf après la sortie `handle` de `sourceId`. Si la sortie menait déjà à un bloc, le nouveau bloc
 * s'intercale : il reprend la suite (par « ensuite », ou par « oui » pour une condition) et tout ce qui suivait descend
 * d'un cran. Le bloc neuf est posé sous sa sortie (« oui » à gauche, « non » à droite), puis poussé de ce côté s'il
 * recouvrait un bloc (par exemple celui de l'autre sortie). Renvoie null si l'insertion est impossible.
 */
export function insertAfter(
  d: Draft,
  sourceId: string,
  handle: GraphHandle,
  key: PaletteKey,
  sizes?: NodeSizes,
): { draft: Draft; id: string } | null {
  const source = findNode(d, sourceId);
  if (!source || !canInsertAfter(d, sourceId, handle, key)) return null;
  const old = d.edges.find((e) => e.source === sourceId && e.sourceHandle === handle) ?? null;
  const dx = handle === "yes" ? -LAYOUT_COLUMN_X / 2 : handle === "no" ? LAYOUT_COLUMN_X / 2 : 0;
  const id = freeId(d, "n");
  const node: DraftNode = {
    id,
    type: paletteNodeType(key),
    position: { x: source.position.x + dx, y: source.position.y + GRAPH_NODE_SPACING_Y },
    data: newNodeData(key),
  };
  const below = old ? reachable(d, old.target) : new Set<string>();
  const nodes = [
    ...d.nodes.map((n) =>
      below.has(n.id)
        ? { ...n, position: { x: n.position.x, y: n.position.y + GRAPH_NODE_SPACING_Y } }
        : n,
    ),
    node,
  ];
  let edges = d.edges.filter((e) => e !== old);
  const withNodes: Draft = { nodes, edges };
  edges = [
    ...edges,
    { id: freeId(withNodes, "e"), source: sourceId, sourceHandle: handle, target: id },
  ];
  if (old && node.type !== "stop") {
    const next: GraphHandle = node.type === "condition" ? "yes" : "next";
    edges = [
      ...edges,
      { id: freeId({ nodes, edges }, "e"), source: id, sourceHandle: next, target: old.target },
    ];
  }
  return { draft: placeClear({ nodes, edges }, id, handle === "yes" ? -1 : 1, sizes), id };
}

/**
 * Sortie où « Ajouter » (bibliothèque, au clic ou au clavier) pose le bloc après le bloc choisi : la première sortie
 * libre (« oui » puis « non » pour une condition), sinon « ensuite » / « oui » (le bloc s'intercale) ; null pour
 * « Arrêter » ou un bloc inconnu (le bloc est alors posé à part).
 */
export function defaultInsertExit(d: Draft, selectedId: string | null): GraphHandle | null {
  const node = findNode(d, selectedId);
  if (!node || node.type === "stop") return null;
  const exits = exitsOf(d, node.id);
  return exits.find((x) => x.target === null)?.handle ?? exits[0]?.handle ?? null;
}

/**
 * Peut-on relier la sortie `handle` de `source` au bloc `target` ? Non : bloc inconnu, lui-même, vers le départ,
 * sortie que ce bloc n'a pas, ou boucle (le bloc visé mène déjà à la source).
 */
export function canConnect(d: Draft, source: string, handle: GraphHandle, target: string): boolean {
  const s = findNode(d, source);
  const t = findNode(d, target);
  if (!s || !t || source === target || t.type === "trigger") return false;
  if (!graphHandlesFor(s.type).includes(handle)) return false;
  return !reachable(d, target).has(source);
}

/** Relie une sortie à un bloc (remplace le lien existant de cette sortie : une seule suite par sortie). */
export function connectExit(d: Draft, source: string, handle: GraphHandle, target: string): Draft {
  if (!canConnect(d, source, handle, target)) return d;
  const edges = d.edges.filter((e) => !(e.source === source && e.sourceHandle === handle));
  return {
    nodes: d.nodes,
    edges: [
      ...edges,
      { id: freeId({ nodes: d.nodes, edges }, "e"), source, sourceHandle: handle, target },
    ],
  };
}

/** Retire le lien d'une sortie (la relance s'arrête alors de ce côté). */
export function disconnectExit(d: Draft, source: string, handle: GraphHandle): Draft {
  return {
    nodes: d.nodes,
    edges: d.edges.filter((e) => !(e.source === source && e.sourceHandle === handle)),
  };
}

export function removeEdge(d: Draft, edgeId: string): Draft {
  return { nodes: d.nodes, edges: d.edges.filter((e) => e.id !== edgeId) };
}

/**
 * Supprime un bloc (jamais le départ). Une action ou une attente est « recousue » : ce qui menait à elle mène à sa
 * suite. Une condition emporte ses deux liens de sortie (les blocs qui suivaient restent, à relier ou supprimer).
 */
export function removeNode(d: Draft, id: string): Draft {
  const node = findNode(d, id);
  if (!node || node.type === "trigger") return d;
  const next =
    node.type === "action" || node.type === "wait"
      ? (d.edges.find((e) => e.source === id && e.sourceHandle === "next")?.target ?? null)
      : null;
  const edges = d.edges
    .filter((e) => e.source !== id)
    .flatMap((e) => (e.target !== id ? [e] : next ? [{ ...e, target: next }] : []));
  return { nodes: d.nodes.filter((n) => n.id !== id), edges };
}

export function updateNodeData(d: Draft, id: string, data: DraftNodeData): Draft {
  return { nodes: d.nodes.map((n) => (n.id === id ? { ...n, data } : n)), edges: d.edges };
}

export function moveNodes(d: Draft, positions: Record<string, GraphPosition>): Draft {
  return {
    nodes: d.nodes.map((n) => (positions[n.id] ? { ...n, position: { ...positions[n.id]! } } : n)),
    edges: d.edges,
  };
}

/** Ordre des sorties pour le rangement et la liste : « ensuite », puis « oui », puis « non ». */
const HANDLE_ORDER: Record<GraphHandle, number> = { next: 0, yes: 1, no: 2 };

function childrenOf(d: Draft, id: string): string[] {
  return d.edges
    .filter((e) => e.source === id)
    .sort((a, b) => HANDLE_ORDER[a.sourceHandle] - HANDLE_ORDER[b.sourceHandle])
    .map((e) => e.target);
}

/**
 * Range les blocs en arbre de haut en bas depuis le départ : une ligne par étape (la plus longue suite l'emporte quand
 * deux branches se rejoignent), les branches « oui » à gauche et « non » à droite. Les blocs non reliés vont en bas.
 */
export function layoutDraft(d: Draft): Draft {
  const start = d.nodes.find((n) => n.type === "trigger");
  if (!start) return d;
  // Profondeur = plus longue suite depuis le départ (graphe sans boucle ; garde-fou sinon).
  const depth = new Map<string, number>([[start.id, 0]]);
  for (let pass = 0; pass < d.nodes.length; pass++) {
    let changed = false;
    for (const e of d.edges) {
      const ds = depth.get(e.source);
      if (ds === undefined) continue;
      if ((depth.get(e.target) ?? -1) < ds + 1) {
        depth.set(e.target, ds + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  // Arbre couvrant : chaque bloc sous son premier parent rencontré.
  const parent = new Map<string, string>();
  const order: string[] = [];
  const visit = (id: string) => {
    order.push(id);
    for (const c of childrenOf(d, id))
      if (c !== start.id && !parent.has(c) && !order.includes(c)) {
        parent.set(c, id);
        visit(c);
      }
  };
  visit(start.id);
  const kids = (id: string) => order.filter((o) => parent.get(o) === id);
  const width = new Map<string, number>();
  const measure = (id: string): number => {
    const ks = kids(id);
    const w = ks.length ? ks.reduce((s, k) => s + measure(k), 0) : 1;
    width.set(id, w);
    return w;
  };
  measure(start.id);
  const x = new Map<string, number>();
  const place = (id: string, left: number) => {
    const w = width.get(id) ?? 1;
    x.set(id, (left + w / 2) * LAYOUT_COLUMN_X);
    let cur = left;
    for (const k of kids(id)) {
      place(k, cur);
      cur += width.get(k) ?? 1;
    }
  };
  place(start.id, 0);
  const center = x.get(start.id) ?? 0;
  const maxDepth = Math.max(0, ...[...depth.values()]);
  let loose = 0;
  return {
    nodes: d.nodes.map((n) => {
      if (x.has(n.id))
        return {
          ...n,
          position: { x: x.get(n.id)! - center, y: (depth.get(n.id) ?? 0) * GRAPH_NODE_SPACING_Y },
        };
      const pos = { x: loose++ * LAYOUT_COLUMN_X, y: (maxDepth + 1.5) * GRAPH_NODE_SPACING_Y };
      return { ...n, position: pos };
    }),
    edges: d.edges,
  };
}

// ---------- Liste accessible des blocs ----------

export type OutlineItem = {
  id: string;
  /** Niveau d'indentation (0 = départ). */
  depth: number;
  /** Sortie par laquelle on arrive ici (« Oui », « Non ») ; null pour une suite simple ou le départ. */
  via: GraphHandle | null;
  label: string;
  /** Le bloc dans une phrase (« le message « Bonjour Léa… » »), pour le renvoi d'un bloc déjà listé. */
  phrase: string;
  type: GraphNodeType;
  /** Bloc déjà listé plus haut (deux branches qui se rejoignent) : simple renvoi. */
  repeat: boolean;
  /** Bloc relié à rien. */
  detached: boolean;
};

/**
 * Le parcours en liste, de haut en bas (alternative au canevas pour le clavier et les lecteurs d'écran, et aperçu en
 * lecture seule sur téléphone) : chaque branche d'une condition est indentée sous elle ; un bloc rejoint par deux
 * branches n'est détaillé qu'une fois ; les blocs non reliés sont listés à la fin.
 */
export function outlineDraft(d: Draft, names: GraphNames = {}): OutlineItem[] {
  const out: OutlineItem[] = [];
  const listed = new Set<string>();
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const walk = (id: string | null, depth: number, via: GraphHandle | null) => {
    let cur = id;
    let v = via;
    while (cur) {
      const node = byId.get(cur);
      if (!node) return;
      const label = draftNodeLabel(node, names);
      const phrase = draftNodePhrase(node, names);
      const base = { id: cur, depth, via: v, label, phrase, type: node.type, detached: false };
      if (listed.has(cur)) {
        out.push({ ...base, repeat: true });
        return;
      }
      listed.add(cur);
      out.push({ ...base, repeat: false });
      if (node.type === "condition") {
        const exits = exitsOf(d, cur);
        for (const x of exits) {
          if (x.target) walk(x.target, depth + 1, x.handle);
        }
        return;
      }
      const next = exitsOf(d, cur).find((x) => x.handle === "next")?.target ?? null;
      cur = next;
      v = null;
    }
  };
  const start = d.nodes.find((n) => n.type === "trigger");
  if (start) walk(start.id, 0, null);
  for (const n of d.nodes)
    if (!listed.has(n.id))
      out.push({
        id: n.id,
        depth: 0,
        via: null,
        label: draftNodeLabel(n, names),
        phrase: draftNodePhrase(n, names),
        type: n.type,
        repeat: false,
        detached: true,
      });
  return out;
}

/** « Oui : … », « Non : … » devant un bloc de la liste. */
export function viaLabel(via: GraphHandle | null): string {
  return via && via !== "next" ? GRAPH_HANDLE_LABELS[via] : "";
}

// ---------- Validation en direct ----------

export type RuleFields = {
  name: string;
  trigger: string;
  conditions: Record<string, unknown>;
};

export type EditorValidation = {
  ok: boolean;
  /** Parcours normalisé (si `ok`). */
  graph: AutomationGraph | null;
  /** Problèmes par bloc (surlignage) ; ceux de toute la relance sous « * ». */
  byNode: Record<string, GraphIssue[]>;
  /** Liens en erreur (surlignés en rouge). */
  edgeIds: Set<string>;
  errors: GraphIssue[];
  warnings: GraphIssue[];
};

const TEXT_ACTIONS = new Set(["send_message", "notify_team", "suggest_channel"]);

/**
 * Validation en direct : règles du core (`validateGraph`), mise en forme Telegram des textes, nom de la relance, et
 * filtres du départ (le déclencheur « Inactif depuis N jours » exige un nombre de jours).
 */
export function validateEditor(d: Draft, rule: RuleFields): EditorValidation {
  const v = validateGraph(draftToRaw(d));
  let issues: GraphIssue[] = [...v.issues];
  for (const n of d.nodes) {
    const a = n.type === "action" ? n.data.action : undefined;
    // Boutons saisis champ par champ : la ligne fautive est nommée (« Bouton « Voir » : … ») à la place du message
    // général du core ; un libellé vide est aussi refusé.
    if (a?.type === "send_message" && Array.isArray(a.buttons)) {
      // Liens et boutons « Offre (campagne) » (campagne et offre exigées).
      const entries = (a.buttons as unknown[])
        .flatMap((row) => (Array.isArray(row) ? row : []))
        .map(toButtonEntry);
      const check = entriesToButtons(entries);
      if (!check.ok) {
        issues = issues.filter((i) => !(i.nodeId === n.id && /bouton/i.test(i.message)));
        issues.push({
          code: "invalid_action",
          severity: "error",
          message: check.error,
          nodeId: n.id,
        });
      }
    }
    const text = typeof a?.text === "string" ? a.text.trim() : "";
    if (a && TEXT_ACTIONS.has(String(a.type)) && text) {
      const html = validateTelegramHtml(text);
      if (!html.ok)
        issues.push({
          code: "invalid_action",
          severity: "error",
          message: `Mise en forme du texte à corriger : ${html.error}`,
          nodeId: n.id,
        });
    }
  }
  const startId = d.nodes.find((n) => n.type === "trigger")?.id ?? GRAPH_TRIGGER_NODE_ID;
  if (rule.name.trim().length < 2)
    issues.push({
      code: "incomplete",
      severity: "error",
      message: "Donnez un nom à la relance (2 caractères au moins).",
    });
  try {
    const c = parseConditions(rule.conditions);
    if (rule.trigger === "INACTIVE" && !c.inactiveDays)
      issues.push({
        code: "incomplete",
        severity: "error",
        message: "Indiquez après combien de jours sans activité la relance part.",
        nodeId: startId,
      });
  } catch (err) {
    issues.push({
      code: "incomplete",
      severity: "error",
      message: err instanceof Error ? err.message : "Filtres du départ invalides.",
      nodeId: startId,
    });
  }
  const errors = issues.filter((i) => i.severity === "error");
  const ok = errors.length === 0 && v.ok;
  return {
    ok,
    graph: ok ? v.graph : null,
    byNode: issuesByNode(issues),
    edgeIds: new Set(issues.flatMap((i) => (i.edgeId ? [i.edgeId] : []))),
    errors,
    warnings: issues.filter((i) => i.severity === "warning"),
  };
}

/** Vrai si le brouillon est une simple chaîne (enregistrable aussi comme liste d'actions). */
export function isSimpleChain(graph: AutomationGraph | null): boolean {
  return !!graph && graphToLinear(graph) !== null;
}

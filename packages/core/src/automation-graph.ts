/**
 * Relances automatiques à branches (graphe) : types, validation, conversion depuis et vers les règles linéaires,
 * libellés, évaluation des conditions et lecture du journal (fonctions pures, sans base ni Telegram).
 *
 * Une règle (`AutomationRule`) garde son déclencheur et ses filtres (`trigger`, `conditions`) ; son parcours est :
 * - soit une liste d'actions (`actions`, `graph` vide) : règle linéaire, exécutée comme avant ;
 * - soit un graphe (`graph`) : un bloc de départ, des conditions à deux sorties « oui » / « non », des actions,
 *   des attentes et des arrêts, reliés par des liens. Le graphe prime sur `actions` quand il est présent.
 */
import {
  AUTOMATION_SEQUENCE_LABELS,
  parseActions,
  type AutomationAction,
  type AutomationConditions,
  type AutomationTriggerKey,
} from "./automation";
import {
  aggregatePlayers,
  computeSpendLevel,
  SPEND_LEVEL_LABELS,
  SPEND_LEVELS,
  type SpendLevel,
  type SpendThresholds,
} from "./spend-level";

// ---------- Constantes ----------

export const AUTOMATION_GRAPH_VERSION = 1 as const;
/** Nombre maximum de blocs (départ compris) dans une relance. */
export const MAX_GRAPH_NODES = 40;
/** Attente : de 1 heure à 90 jours. */
export const GRAPH_WAIT_MIN_HOURS = 1;
export const GRAPH_WAIT_MAX_HOURS = 24 * 90;
/** Écart vertical entre deux blocs posés automatiquement (conversion d'une règle linéaire, modèles). */
export const GRAPH_NODE_SPACING_Y = 160;
/** Écart horizontal entre les deux branches d'une condition posée automatiquement. */
export const GRAPH_BRANCH_SPACING_X = 220;
/** Identifiant du bloc de départ créé par les convertisseurs. */
export const GRAPH_TRIGGER_NODE_ID = "trigger";

export const GRAPH_NODE_TYPES = ["trigger", "condition", "action", "wait", "stop"] as const;
export type GraphNodeType = (typeof GRAPH_NODE_TYPES)[number];

export const GRAPH_HANDLES = ["next", "yes", "no"] as const;
export type GraphHandle = (typeof GRAPH_HANDLES)[number];

export const GRAPH_CONDITION_KINDS = [
  "registered",
  "deposited",
  "deposit_count_gte",
  "spend_level_in",
  "language_in",
  "has_tag",
  "in_channel",
  "clicked_offer_since_start",
  "inactive_days_gte",
  "campaign_in",
] as const;
export type GraphConditionKind = (typeof GRAPH_CONDITION_KINDS)[number];

export const GRAPH_ACTION_TYPES = [
  "send_message",
  "send_sequence",
  "tag",
  "suggest_channel",
  "notify_team",
] as const;
export type GraphActionType = (typeof GRAPH_ACTION_TYPES)[number];

// ---------- Types ----------

export type GraphPosition = { x: number; y: number };

/** Conditions évaluées au moment où l'exécution atteint le bloc, sur l'état du membre à cet instant. */
export type GraphCondition =
  | { kind: "registered" }
  | { kind: "deposited" }
  | { kind: "deposit_count_gte"; n: number }
  | { kind: "spend_level_in"; levels: SpendLevel[] }
  | { kind: "language_in"; languages: string[] }
  | { kind: "has_tag"; tag: string }
  | { kind: "in_channel"; channelId: string }
  | { kind: "clicked_offer_since_start" }
  | { kind: "inactive_days_gte"; n: number }
  | { kind: "campaign_in"; campaignIds: string[] };

/** Action d'un bloc « action » : mêmes formes que `AutomationAction`, sauf l'attente (bloc à part). */
export type GraphAction = Exclude<AutomationAction, { type: "wait" }>;

export type GraphTriggerNode = { id: string; type: "trigger"; position: GraphPosition };
export type GraphConditionNode = {
  id: string;
  type: "condition";
  position: GraphPosition;
  condition: GraphCondition;
};
export type GraphActionNode = {
  id: string;
  type: "action";
  position: GraphPosition;
  action: GraphAction;
};
export type GraphWaitNode = { id: string; type: "wait"; position: GraphPosition; hours: number };
export type GraphStopNode = { id: string; type: "stop"; position: GraphPosition };
export type GraphNode =
  GraphTriggerNode | GraphConditionNode | GraphActionNode | GraphWaitNode | GraphStopNode;

/** Lien : part de la sortie `sourceHandle` du bloc `source` (« next » pour départ, action, attente ; « yes » / « no » pour une condition). */
export type GraphEdge = { id: string; source: string; sourceHandle: GraphHandle; target: string };

export type AutomationGraph = {
  version: typeof AUTOMATION_GRAPH_VERSION;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

/** Noms affichés (canaux, campagnes) pour les libellés ; un identifiant inconnu est affiché tel quel. */
export type GraphNames = {
  channels?: Record<string, string>;
  campaigns?: Record<string, string>;
};

// ---------- Libellés (éditeur, journal) ----------

export const GRAPH_NODE_LABELS: Record<GraphNodeType, string> = {
  trigger: "Départ",
  condition: "Condition",
  action: "Action",
  wait: "Attendre",
  stop: "Arrêter",
};

export const GRAPH_HANDLE_LABELS: Record<GraphHandle, string> = {
  next: "Ensuite",
  yes: "Oui",
  no: "Non",
};

export const GRAPH_ACTION_LABELS: Record<GraphActionType, string> = {
  send_message: "Envoyer un message",
  send_sequence: "Envoyer un message du bot",
  tag: "Étiqueter le membre",
  suggest_channel: "Proposer un canal",
  notify_team: "Prévenir l'équipe",
};

export const GRAPH_ACTION_HELP: Record<GraphActionType, string> = {
  send_message: "Le bot écrit au membre en privé. {prenom} et {canal} sont remplacés.",
  send_sequence: "Le bot envoie un de ses messages habituels (accueil, accepté…) du canal.",
  tag: "Ajoute une étiquette sur la fiche du membre.",
  suggest_channel: "Le bot propose au membre de rejoindre un autre canal.",
  notify_team: "L'équipe reçoit une notification Telegram.",
};

/** Messages du bot qu'une action « Envoyer un message du bot » peut envoyer (clés des séquences). */
export const GRAPH_SEQUENCE_LABELS = AUTOMATION_SEQUENCE_LABELS;

export const GRAPH_CONDITION_LABELS: Record<GraphConditionKind, string> = {
  registered: "Inscrit chez un programme",
  deposited: "A déjà déposé",
  deposit_count_gte: "Nombre de dépôts",
  spend_level_in: "Niveau de dépense",
  language_in: "Langue",
  has_tag: "A une étiquette",
  in_channel: "Est dans un canal",
  clicked_offer_since_start: "A cliqué une offre",
  inactive_days_gte: "Rien fait depuis…",
  campaign_in: "Venu d'une campagne",
};

export const GRAPH_CONDITION_HELP: Record<GraphConditionKind, string> = {
  registered: "Oui si le membre a ouvert un compte chez un de nos programmes.",
  deposited: "Oui si le membre a fait au moins un dépôt.",
  deposit_count_gte: "Oui si le membre a fait au moins ce nombre de dépôts.",
  spend_level_in: "Oui si le niveau de dépense du membre est l'un de ceux choisis.",
  language_in: "Oui si la langue Telegram du membre est l'une de celles choisies.",
  has_tag: "Oui si le membre porte cette étiquette.",
  in_channel: "Oui si le membre est accepté ou entré dans ce canal, et ne l'a pas quitté.",
  clicked_offer_since_start:
    "Oui si le membre a cliqué sur une offre depuis le début de cette relance.",
  inactive_days_gte:
    "Oui si le membre n'a rien fait (ni message au bot, ni demande, ni clic) depuis ce nombre de jours.",
  campaign_in: "Oui si le membre est arrivé par un lien d'une de ces campagnes.",
};

// ---------- Petits utilitaires ----------

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function plural(n: number, one: string, many: string): string {
  return `${String(n).replace(".", ",")} ${n >= 2 ? many : one}`;
}

/** Durée lisible : « 2 h », « 1 jour », « 3 jours », « 1 j 6 h ». */
export function formatWaitHours(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "0 h";
  if (hours < 24) return `${String(Math.round(hours * 100) / 100).replace(".", ",")} h`;
  const days = Math.floor(hours / 24);
  const rest = Math.round((hours - days * 24) * 100) / 100;
  if (rest === 0) return plural(days, "jour", "jours");
  return `${days} j ${String(rest).replace(".", ",")} h`;
}

/** Texte brut court (aperçu) d'un message HTML Telegram. */
function excerpt(text: string, max = 40): string {
  const plain = text
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

function nameOf(map: Record<string, string> | undefined, id: string): string {
  return map?.[id] ?? id;
}

/** Sorties possibles d'un type de bloc. */
export function graphHandlesFor(type: GraphNodeType): GraphHandle[] {
  switch (type) {
    case "condition":
      return ["yes", "no"];
    case "stop":
      return [];
    default:
      return ["next"];
  }
}

/** Bloc suivant par une sortie donnée (null : pas de lien = fin du parcours). */
export function graphNextNodeId(
  graph: Pick<AutomationGraph, "edges">,
  nodeId: string,
  handle: GraphHandle,
): string | null {
  return graph.edges.find((e) => e.source === nodeId && e.sourceHandle === handle)?.target ?? null;
}

/** Bloc de départ du graphe (null si absent). */
export function graphTriggerNode(graph: Pick<AutomationGraph, "nodes">): GraphTriggerNode | null {
  return (graph.nodes.find((n) => n.type === "trigger") as GraphTriggerNode | undefined) ?? null;
}

/** Identifiant libre pour un nouveau bloc ou lien (`n1`, `n2`… ou `e1`…), pour l'éditeur. */
export function uniqueGraphId(
  graph: Pick<AutomationGraph, "nodes" | "edges">,
  prefix = "n",
): string {
  // Toujours après le plus grand numéro déjà pris : un identifiant supprimé n'est jamais réattribué (des membres en
  // attente peuvent encore pointer vers lui ; ils ne doivent pas reprendre sur un autre bloc).
  const used = [...graph.nodes.map((n) => n.id), ...graph.edges.map((e) => e.id)];
  let max = 0;
  for (const id of used) {
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${prefix}${max + 1}`;
}

// ---------- Validation d'un bloc (condition, action, attente) ----------

export type GraphIssueCode =
  | "invalid_graph"
  | "too_many_nodes"
  | "invalid_node"
  | "duplicate_id"
  | "no_trigger"
  | "multiple_triggers"
  | "incomplete"
  | "empty_text"
  | "invalid_condition"
  | "invalid_action"
  | "invalid_wait"
  | "invalid_edge"
  | "edge_unknown_node"
  | "invalid_handle"
  | "duplicate_exit"
  | "unreachable"
  | "cycle"
  | "condition_without_exit"
  | "trigger_without_exit"
  | "no_action"
  | "wait_without_exit";

/** Erreur sur le contenu d'un bloc (code pour la validation en direct, message en français). */
export class GraphDataError extends Error {
  constructor(
    readonly code: GraphIssueCode,
    message: string,
  ) {
    super(message);
    this.name = "GraphDataError";
  }
}

function intIn(v: unknown, min: number, max: number): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = str(x);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Valide une condition brute ; lève `GraphDataError` (message en français) si elle est incomplète ou invalide. */
export function parseGraphCondition(raw: unknown): GraphCondition {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new GraphDataError("incomplete", "Choisissez la condition à vérifier.");
  const o = raw as Record<string, unknown>;
  if (o.kind === undefined || o.kind === null || o.kind === "")
    throw new GraphDataError("incomplete", "Choisissez la condition à vérifier.");
  const kind = o.kind as GraphConditionKind;
  switch (kind) {
    case "registered":
    case "deposited":
    case "clicked_offer_since_start":
      return { kind };
    case "deposit_count_gte": {
      const n = intIn(o.n, 1, 10_000);
      if (n === null)
        throw new GraphDataError(
          "incomplete",
          "Indiquez un nombre de dépôts entier, de 1 à 10 000.",
        );
      return { kind: "deposit_count_gte", n };
    }
    case "inactive_days_gte": {
      const n = intIn(o.n, 1, 3650);
      if (n === null)
        throw new GraphDataError("incomplete", "Indiquez un nombre de jours entier, de 1 à 3 650.");
      return { kind: "inactive_days_gte", n };
    }
    case "spend_level_in": {
      const levels = strList(o.levels);
      if (levels.length === 0)
        throw new GraphDataError("incomplete", "Choisissez au moins un niveau de dépense.");
      for (const l of levels)
        if (!(SPEND_LEVELS as readonly string[]).includes(l))
          throw new GraphDataError("invalid_condition", `Niveau de dépense inconnu : ${l}.`);
      return { kind: "spend_level_in", levels: levels as SpendLevel[] };
    }
    case "language_in": {
      const languages = strList(o.languages).map((l) => l.toLowerCase());
      if (languages.length === 0)
        throw new GraphDataError("incomplete", "Choisissez au moins une langue.");
      for (const l of languages)
        if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(l))
          throw new GraphDataError("invalid_condition", `Langue inconnue : ${l}.`);
      return { kind: "language_in", languages: [...new Set(languages)] };
    }
    case "has_tag": {
      const tag = str(o.tag).slice(0, 40);
      if (!tag) throw new GraphDataError("incomplete", "Indiquez l'étiquette à vérifier.");
      return { kind: "has_tag", tag };
    }
    case "in_channel": {
      const channelId = str(o.channelId);
      if (!channelId) throw new GraphDataError("incomplete", "Choisissez le canal.");
      return { kind: "in_channel", channelId };
    }
    case "campaign_in": {
      const campaignIds = strList(o.campaignIds);
      if (campaignIds.length === 0)
        throw new GraphDataError("incomplete", "Choisissez au moins une campagne.");
      return { kind: "campaign_in", campaignIds };
    }
    default:
      throw new GraphDataError("invalid_condition", "Condition inconnue.");
  }
}

/** Valide l'action d'un bloc « action » (mêmes règles que `parseActions`) ; lève `GraphDataError` sinon. */
export function parseGraphAction(raw: unknown): GraphAction {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new GraphDataError("incomplete", "Choisissez l'action à faire.");
  const o = raw as Record<string, unknown>;
  if (o.type === undefined || o.type === null || o.type === "")
    throw new GraphDataError("incomplete", "Choisissez l'action à faire.");
  if (o.type === "wait")
    throw new GraphDataError(
      "invalid_action",
      "Utilisez le bloc « Attendre » pour faire une pause.",
    );
  if (!(GRAPH_ACTION_TYPES as readonly unknown[]).includes(o.type))
    throw new GraphDataError("invalid_action", "Action inconnue.");
  const text = str(o.text);
  if (o.type === "send_message" && !text)
    throw new GraphDataError("empty_text", "Écrivez le texte du message.");
  if (o.type === "notify_team" && !text)
    throw new GraphDataError("empty_text", "Écrivez le texte de la notification à l'équipe.");
  if (o.type === "tag" && !str(o.tag))
    throw new GraphDataError("incomplete", "Indiquez l'étiquette à poser.");
  if (o.type === "suggest_channel" && !str(o.channelId))
    throw new GraphDataError("incomplete", "Choisissez le canal à proposer.");
  if (o.type === "send_sequence" && !(str(o.trigger) in GRAPH_SEQUENCE_LABELS))
    throw new GraphDataError("incomplete", "Choisissez le message du bot à envoyer.");
  try {
    return parseActions([raw])[0] as GraphAction;
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err))
      .replace(/^Action 1 invalide\.?/, "Action invalide.")
      .replace(/^Action 1\s*:\s*/, "");
    throw new GraphDataError("invalid_action", capitalize(message));
  }
}

/** Valide la durée d'un bloc « attendre » (heures, de 1 h à 90 jours) ; lève `GraphDataError` sinon. */
export function parseGraphWaitHours(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "")
    throw new GraphDataError("incomplete", "Indiquez la durée de l'attente.");
  const h = Number(raw);
  if (!Number.isFinite(h))
    throw new GraphDataError("incomplete", "Indiquez la durée de l'attente.");
  if (h < GRAPH_WAIT_MIN_HOURS || h > GRAPH_WAIT_MAX_HOURS)
    throw new GraphDataError("invalid_wait", "L'attente doit durer entre 1 heure et 90 jours.");
  return h;
}

// ---------- Validation du graphe ----------

export type GraphIssue = {
  code: GraphIssueCode;
  /** « error » empêche l'enregistrement et l'exécution ; « warning » est seulement signalé. */
  severity: "error" | "warning";
  message: string;
  /** Bloc concerné (à surligner dans l'éditeur). */
  nodeId?: string;
  /** Lien concerné. */
  edgeId?: string;
};

export type GraphValidation = {
  /** Vrai s'il n'y a aucune erreur (les avertissements sont permis). */
  ok: boolean;
  /** Graphe normalisé (textes nettoyés, positions par défaut) quand `ok`, sinon null. */
  graph: AutomationGraph | null;
  issues: GraphIssue[];
};

function parsePosition(v: unknown): GraphPosition {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const x = Number(o.x);
  const y = Number(o.y);
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
}

/** Données d'un bloc : à la racine (`condition`, `action`, `hours`) ou dans `data` (format de l'éditeur). */
function nodeField(r: Record<string, unknown>, key: string): unknown {
  if (r[key] !== undefined) return r[key];
  const d = r.data;
  return d && typeof d === "object" ? (d as Record<string, unknown>)[key] : undefined;
}

/**
 * Valide un graphe brut (JSON de la base ou de l'éditeur) sans jamais lever : liste des problèmes par bloc et par
 * lien pour la validation en direct. Les données d'un bloc peuvent être à la racine ou dans `data`.
 */
export function validateGraph(raw: unknown): GraphValidation {
  const issues: GraphIssue[] = [];
  const add = (
    code: GraphIssueCode,
    message: string,
    ref: { nodeId?: string; edgeId?: string } = {},
    severity: GraphIssue["severity"] = "error",
  ) => {
    issues.push({ code, severity, message, ...ref });
  };
  const fail = (): GraphValidation => ({ ok: false, graph: null, issues });

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    add("invalid_graph", "Relance invalide : parcours attendu.");
    return fail();
  }
  const o = raw as Record<string, unknown>;
  if (o.version !== undefined && o.version !== AUTOMATION_GRAPH_VERSION)
    add("invalid_graph", "Version de parcours inconnue.");
  if (!Array.isArray(o.nodes)) {
    add("invalid_graph", "Relance invalide : liste de blocs attendue.");
    return fail();
  }
  const rawEdges = o.edges === undefined || o.edges === null ? [] : o.edges;
  if (!Array.isArray(rawEdges)) {
    add("invalid_graph", "Relance invalide : liste de liens attendue.");
    return fail();
  }
  if (o.nodes.length > MAX_GRAPH_NODES)
    add(
      "too_many_nodes",
      `${MAX_GRAPH_NODES} blocs au maximum par relance (${o.nodes.length} actuellement).`,
    );

  // 1. Blocs : identifiant, type, contenu.
  const nodes: GraphNode[] = [];
  const types = new Map<string, GraphNodeType>();
  o.nodes.forEach((rn: unknown, i: number) => {
    if (!rn || typeof rn !== "object" || Array.isArray(rn)) {
      add("invalid_node", `Bloc ${i + 1} invalide.`);
      return;
    }
    const r = rn as Record<string, unknown>;
    const id = str(r.id);
    if (!id || id.length > 64) {
      add("invalid_node", `Bloc ${i + 1} : identifiant manquant.`);
      return;
    }
    if (types.has(id)) {
      add("duplicate_id", `Deux blocs portent le même identifiant (${id}).`, { nodeId: id });
      return;
    }
    if (!(GRAPH_NODE_TYPES as readonly unknown[]).includes(r.type)) {
      add("invalid_node", "Type de bloc inconnu.", { nodeId: id });
      return;
    }
    const type = r.type as GraphNodeType;
    types.set(id, type);
    const position = parsePosition(r.position);
    try {
      switch (type) {
        case "trigger":
        case "stop":
          nodes.push({ id, type, position });
          break;
        case "condition":
          nodes.push({
            id,
            type,
            position,
            condition: parseGraphCondition(nodeField(r, "condition")),
          });
          break;
        case "action":
          nodes.push({ id, type, position, action: parseGraphAction(nodeField(r, "action")) });
          break;
        case "wait":
          nodes.push({ id, type, position, hours: parseGraphWaitHours(nodeField(r, "hours")) });
          break;
      }
    } catch (err) {
      if (err instanceof GraphDataError) add(err.code, err.message, { nodeId: id });
      else add("invalid_node", "Bloc invalide.", { nodeId: id });
    }
  });

  // 2. Liens : blocs existants, sortie permise, une seule suite par sortie.
  const edges: GraphEdge[] = [];
  const edgeIds = new Set<string>();
  const exits = new Set<string>();
  rawEdges.forEach((re: unknown, i: number) => {
    if (!re || typeof re !== "object" || Array.isArray(re)) {
      add("invalid_edge", `Lien ${i + 1} invalide.`);
      return;
    }
    const r = re as Record<string, unknown>;
    const id = str(r.id);
    if (!id) {
      add("invalid_edge", `Lien ${i + 1} : identifiant manquant.`);
      return;
    }
    if (edgeIds.has(id)) {
      add("duplicate_id", `Deux liens portent le même identifiant (${id}).`, { edgeId: id });
      return;
    }
    edgeIds.add(id);
    const source = str(r.source);
    const target = str(r.target);
    const st = types.get(source);
    const tt = types.get(target);
    if (!st || !tt) {
      add("edge_unknown_node", "Ce lien relie un bloc qui n'existe plus : supprimez-le.", {
        edgeId: id,
        ...(st ? { nodeId: source } : {}),
      });
      return;
    }
    const rawHandle =
      r.sourceHandle === undefined || r.sourceHandle === null || r.sourceHandle === ""
        ? null
        : r.sourceHandle;
    const handle = (rawHandle ?? (st === "condition" ? null : "next")) as GraphHandle | null;
    if (!handle || !graphHandlesFor(st).includes(handle)) {
      add(
        "invalid_handle",
        st === "stop"
          ? "« Arrêter » termine la relance : rien ne peut le suivre."
          : st === "condition"
            ? "Partez de la sortie « oui » ou « non » de la condition."
            : "Ce lien part d'une sortie inconnue.",
        { edgeId: id, nodeId: source },
      );
      return;
    }
    if (tt === "trigger") {
      add("invalid_edge", "Le départ ne peut pas être la suite d'un autre bloc.", {
        edgeId: id,
        nodeId: target,
      });
      return;
    }
    if (source === target) {
      add("cycle", "Un bloc ne peut pas être relié à lui-même.", { edgeId: id, nodeId: source });
      return;
    }
    const key = `${source}:${handle}`;
    if (exits.has(key)) {
      add(
        "duplicate_exit",
        handle === "next"
          ? "Une seule suite par bloc : retirez un des liens."
          : `Une seule suite pour la sortie « ${GRAPH_HANDLE_LABELS[handle].toLowerCase()} » : retirez un des liens.`,
        { edgeId: id, nodeId: source },
      );
      return;
    }
    exits.add(key);
    edges.push({ id, source, sourceHandle: handle, target });
  });

  // 3. Structure : un départ, tout relié au départ, pas de boucle, conditions et départ avec une suite.
  const triggers = [...types].filter(([, t]) => t === "trigger").map(([id]) => id);
  if (triggers.length === 0) add("no_trigger", "Il manque le bloc de départ.");
  for (const id of triggers.slice(1))
    add("multiple_triggers", "Un seul départ par relance : supprimez ce bloc.", { nodeId: id });
  const out = new Map<string, GraphEdge[]>();
  for (const e of edges) out.set(e.source, [...(out.get(e.source) ?? []), e]);

  const start = triggers[0];
  if (start) {
    const reached = new Set<string>([start]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const e of out.get(cur) ?? [])
        if (!reached.has(e.target)) {
          reached.add(e.target);
          queue.push(e.target);
        }
    }
    for (const [id, t] of types)
      if (!reached.has(id) && t !== "trigger")
        add("unreachable", "Ce bloc n'est relié à rien : reliez-le au parcours ou supprimez-le.", {
          nodeId: id,
        });
    if (!exits.has(`${start}:next`))
      add("trigger_without_exit", "Reliez le départ à une première étape.", { nodeId: start });
    else if (![...reached].some((id) => types.get(id) === "action"))
      add(
        "no_action",
        "La relance ne fait rien : ajoutez au moins une action (message, étiquette…).",
      );
  }

  // Boucles : parcours en profondeur (blanc / gris / noir), chaque lien arrière est signalé.
  const color = new Map<string, 1 | 2>();
  const visit = (id: string) => {
    color.set(id, 1);
    for (const e of out.get(id) ?? []) {
      const c = color.get(e.target);
      if (c === 1)
        add(
          "cycle",
          "Ce lien crée une boucle : une relance avance toujours, elle ne revient pas en arrière.",
          { edgeId: e.id, nodeId: e.source },
        );
      else if (c === undefined) visit(e.target);
    }
    color.set(id, 2);
  };
  for (const id of types.keys()) if (!color.has(id)) visit(id);

  for (const [id, t] of types) {
    if (t === "condition" && !exits.has(`${id}:yes`) && !exits.has(`${id}:no`))
      add(
        "condition_without_exit",
        "Reliez au moins une sortie (« oui » ou « non ») de cette condition.",
        { nodeId: id },
      );
    if (t === "wait" && !exits.has(`${id}:next`))
      add(
        "wait_without_exit",
        "Rien ne suit cette attente : ajoutez une étape après, ou supprimez-la.",
        { nodeId: id },
        "warning",
      );
  }

  const ok = !issues.some((i) => i.severity === "error");
  return { ok, graph: ok ? { version: AUTOMATION_GRAPH_VERSION, nodes, edges } : null, issues };
}

/** Problèmes regroupés par bloc (surlignage dans l'éditeur) ; ceux du graphe entier sont sous la clé « * ». */
export function issuesByNode(issues: GraphIssue[]): Record<string, GraphIssue[]> {
  const out: Record<string, GraphIssue[]> = {};
  for (const i of issues) (out[i.nodeId ?? "*"] ??= []).push(i);
  return out;
}

/** Valide et normalise un graphe ; lève une erreur en français listant les problèmes (3 au plus) sinon. */
export function parseGraph(raw: unknown): AutomationGraph {
  const v = validateGraph(raw);
  if (v.ok && v.graph) return v.graph;
  const errors = v.issues.filter((i) => i.severity === "error");
  const shown = errors.slice(0, 3).map((i) => i.message.replace(/\.$/, ""));
  const more =
    errors.length > 3 ? ` (et ${errors.length - 3} autre${errors.length > 4 ? "s" : ""})` : "";
  throw new Error(`Relance à corriger : ${shown.join(" ; ")}${more}.`);
}

// ---------- Convertisseurs ----------

/**
 * Une règle linéaire s'ouvre comme une branche unique : départ → action 1 → … → action N, blocs posés en colonne.
 * Les attentes deviennent des blocs « attendre » (durée conservée telle quelle, même hors bornes).
 */
export function linearToGraph(actions: readonly AutomationAction[]): AutomationGraph {
  const nodes: GraphNode[] = [
    { id: GRAPH_TRIGGER_NODE_ID, type: "trigger", position: { x: 0, y: 0 } },
  ];
  const edges: GraphEdge[] = [];
  actions.forEach((a, i) => {
    const id = `n${i + 1}`;
    const position = { x: 0, y: (i + 1) * GRAPH_NODE_SPACING_Y };
    nodes.push(
      a.type === "wait"
        ? { id, type: "wait", position, hours: a.hours }
        : { id, type: "action", position, action: a },
    );
    edges.push({
      id: `e${i + 1}`,
      source: i === 0 ? GRAPH_TRIGGER_NODE_ID : `n${i}`,
      sourceHandle: "next",
      target: id,
    });
  });
  return { version: AUTOMATION_GRAPH_VERSION, nodes, edges };
}

/**
 * Si le graphe est une simple chaîne sans condition (départ → actions et attentes → éventuel « arrêter » final,
 * chaque bloc relié une seule fois, rien d'isolé, 8 étapes au plus), renvoie la liste d'actions équivalente ;
 * sinon null.
 */
export function graphToLinear(graph: AutomationGraph): AutomationAction[] | null {
  const start = graphTriggerNode(graph);
  if (!start) return null;
  if (graph.nodes.filter((n) => n.type === "trigger").length !== 1) return null;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const outCount = new Map<string, number>();
  const inCount = new Map<string, number>();
  for (const e of graph.edges) {
    outCount.set(e.source, (outCount.get(e.source) ?? 0) + 1);
    inCount.set(e.target, (inCount.get(e.target) ?? 0) + 1);
  }
  const actions: AutomationAction[] = [];
  const seen = new Set<string>([start.id]);
  let cur: string | null = graphNextNodeId(graph, start.id, "next");
  if ((outCount.get(start.id) ?? 0) > 1) return null;
  while (cur) {
    if (seen.has(cur)) return null;
    seen.add(cur);
    const node = byId.get(cur);
    if (!node || (inCount.get(cur) ?? 0) !== 1 || (outCount.get(cur) ?? 0) > 1) return null;
    if (node.type === "condition" || node.type === "trigger") return null;
    if (node.type === "stop") break;
    actions.push(node.type === "wait" ? { type: "wait", hours: node.hours } : node.action);
    cur = graphNextNodeId(graph, cur, "next");
  }
  if (seen.size !== graph.nodes.length) return null;
  if (actions.length > 8) return null;
  return actions;
}

/**
 * Parcours d'une règle pour l'éditeur : son graphe s'il existe (validé, lève une erreur en français s'il est
 * invalide), sinon sa liste d'actions convertie en branche unique.
 */
export function graphForRule(rule: { graph?: unknown; actions: unknown }): AutomationGraph {
  if (rule.graph !== undefined && rule.graph !== null) return parseGraph(rule.graph);
  return linearToGraph(parseActions(rule.actions));
}

// ---------- Libellés lisibles ----------

function conditionPhrase(c: GraphCondition, names: GraphNames): string {
  switch (c.kind) {
    case "registered":
      return "inscrit chez un programme";
    case "deposited":
      return "a déjà déposé";
    case "deposit_count_gte":
      return `au moins ${plural(c.n, "dépôt", "dépôts")}`;
    case "spend_level_in":
      return `niveau de dépense ${c.levels.map((l) => SPEND_LEVEL_LABELS[l]).join(" ou ")}`;
    case "language_in":
      return `langue ${c.languages.map((l) => l.toUpperCase()).join(", ")}`;
    case "has_tag":
      return `étiquette « ${c.tag} »`;
    case "in_channel":
      return `dans le canal « ${nameOf(names.channels, c.channelId)} »`;
    case "clicked_offer_since_start":
      return "a cliqué une offre depuis le début";
    case "inactive_days_gte":
      return `rien fait depuis ${plural(c.n, "jour", "jours")}`;
    case "campaign_in":
      return c.campaignIds.length === 1
        ? `venu de la campagne « ${nameOf(names.campaigns, c.campaignIds[0]!)} »`
        : `venu des campagnes ${c.campaignIds.map((id) => `« ${nameOf(names.campaigns, id)} »`).join(", ")}`;
  }
}

/** Question posée par une condition (« A déjà déposé ? »). */
export function describeCondition(c: GraphCondition, names: GraphNames = {}): string {
  return `${capitalize(conditionPhrase(c, names))} ?`;
}

function actionPhrase(a: GraphAction, names: GraphNames): string {
  switch (a.type) {
    case "send_message":
      return "message";
    case "send_sequence":
      return `message du bot « ${GRAPH_SEQUENCE_LABELS[a.trigger]} »`;
    case "tag":
      return `étiquette « ${a.tag} »`;
    case "suggest_channel":
      return `proposer « ${nameOf(names.channels, a.channelId)} »`;
    case "notify_team":
      return "prévenir l'équipe";
  }
}

/** Ce que fait une action, en une ligne (« Envoyer un message « Salut {prenom}… » »). */
export function describeAction(a: GraphAction, names: GraphNames = {}): string {
  switch (a.type) {
    case "send_message":
      return `Envoyer le message « ${excerpt(a.text)} »`;
    case "send_sequence":
      return `Envoyer le message du bot « ${GRAPH_SEQUENCE_LABELS[a.trigger]} »`;
    case "tag":
      return `Étiqueter « ${a.tag} »`;
    case "suggest_channel":
      return `Proposer le canal « ${nameOf(names.channels, a.channelId)} »`;
    case "notify_team":
      return `Prévenir l'équipe : « ${excerpt(a.text)} »`;
  }
}

/** Libellé d'un bloc pour l'éditeur et le journal. */
export function describeNode(node: GraphNode, names: GraphNames = {}): string {
  switch (node.type) {
    case "trigger":
      return GRAPH_NODE_LABELS.trigger;
    case "condition":
      return describeCondition(node.condition, names);
    case "action":
      return describeAction(node.action, names);
    case "wait":
      return `Attendre ${formatWaitHours(node.hours)}`;
    case "stop":
      return GRAPH_NODE_LABELS.stop;
  }
}

/** Phrase courte qui résume le parcours (liste des relances, journal), 200 caractères au plus. */
export function summarizeGraph(graph: AutomationGraph, names: GraphNames = {}): string {
  const start = graphTriggerNode(graph);
  if (!start) return "Parcours vide";
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const walk = (from: string | null, depth: number, seen: Set<string>): string[] => {
    const parts: string[] = [];
    let cur = from;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const node = byId.get(cur);
      if (!node) break;
      if (node.type === "trigger") {
        cur = graphNextNodeId(graph, cur, "next");
      } else if (node.type === "action") {
        parts.push(actionPhrase(node.action, names));
        cur = graphNextNodeId(graph, cur, "next");
      } else if (node.type === "wait") {
        parts.push(`attendre ${formatWaitHours(node.hours)}`);
        cur = graphNextNodeId(graph, cur, "next");
      } else if (node.type === "stop") {
        parts.push("arrêt");
        cur = null;
      } else {
        const q = conditionPhrase(node.condition, names);
        if (depth >= 2) {
          parts.push(`si ${q} : …`);
        } else {
          const yes = walk(graphNextNodeId(graph, cur, "yes"), depth + 1, new Set(seen));
          const no = walk(graphNextNodeId(graph, cur, "no"), depth + 1, new Set(seen));
          parts.push(`si ${q} : ${yes.join(" → ") || "fin"} ; sinon : ${no.join(" → ") || "fin"}`);
        }
        cur = null;
      }
    }
    return parts;
  };
  const text = capitalize(walk(start.id, 0, new Set()).join(" → ")) || "Ne fait rien";
  return text.length > 200 ? `${text.slice(0, 199).trimEnd()}…` : text;
}

// ---------- Évaluation des conditions ----------

/** État du membre au moment où l'exécution atteint une condition. */
export type GraphMemberContext = {
  /** Inscrit chez un programme (joueur avec date d'inscription, ou qui a déjà déposé). */
  registered: boolean;
  /** Au moins un dépôt. */
  deposited: boolean;
  /** Nombre total de dépôts (premier dépôt compris). */
  depositCount: number;
  spendLevel: SpendLevel | null;
  languageCode: string | null;
  tags: string[];
  /** Canaux où le membre est accepté ou entré (adhésion acceptée, pas quittée). */
  channelIds: string[];
  /** Nos campagnes dont le membre a emprunté un lien d'entrée. */
  campaignIds: string[];
  /** Jours depuis la dernière action du membre lui-même (null si inconnue). */
  inactiveDays: number | null;
  /** Clics d'offre du membre depuis le début de l'exécution. */
  offerClicksSinceStart: number;
};

/** Vrai si le membre remplit la condition (sortie « oui »), faux sinon (sortie « non »). */
export function evaluateCondition(c: GraphCondition, ctx: GraphMemberContext): boolean {
  switch (c.kind) {
    case "registered":
      return ctx.registered;
    case "deposited":
      return ctx.deposited;
    case "deposit_count_gte":
      return ctx.depositCount >= c.n;
    case "spend_level_in":
      return ctx.spendLevel !== null && c.levels.includes(ctx.spendLevel);
    case "language_in": {
      const full = (ctx.languageCode ?? "").toLowerCase();
      const base = full.split("-")[0] ?? "";
      return c.languages.some((l) => l === base || l === full);
    }
    case "has_tag":
      return ctx.tags.includes(c.tag);
    case "in_channel":
      return ctx.channelIds.includes(c.channelId);
    case "clicked_offer_since_start":
      return ctx.offerClicksSinceStart > 0;
    case "inactive_days_gte":
      return ctx.inactiveDays !== null && ctx.inactiveDays >= c.n;
    case "campaign_in":
      return c.campaignIds.some((id) => ctx.campaignIds.includes(id));
  }
}

/**
 * Construit le contexte d'évaluation à partir des données lues en base (joueurs du membre, adhésions, étiquettes…).
 * Mêmes règles que le niveau de dépense (`aggregatePlayers` + `computeSpendLevel`). Les adhésions sont fournies de la
 * plus récente à la plus ancienne : seule la plus récente de chaque canal compte (acceptée = dans le canal).
 */
export function graphContextFromData(d: {
  players: Array<{
    registeredAt: Date | null;
    ftdAt?: Date | null;
    depositCount: number;
    depositTotal: number;
  }>;
  thresholds?: SpendThresholds;
  languageCode: string | null;
  tags: unknown;
  memberships: Array<{ channelId: string; status: string }>;
  campaignIds: string[];
  inactiveDays: number | null;
  offerClicksSinceStart: number;
}): GraphMemberContext {
  const agg = aggregatePlayers(d.players);
  const ftdPlayers = d.players.filter((p) => p.ftdAt).length;
  // Même règle que `computeSpendLevel` et le filtre « Ont déposé » (compteur > 0 ou montant > 0),
  // plus la date de premier dépôt : un montant connu sans compteur vaut au moins un dépôt.
  const deposited = agg.depositCount > 0 || agg.depositTotal > 0 || ftdPlayers > 0;
  const depositCount = Math.max(agg.depositCount, ftdPlayers, deposited ? 1 : 0);
  const channelIds: string[] = [];
  const seen = new Set<string>();
  for (const m of d.memberships) {
    if (seen.has(m.channelId)) continue;
    seen.add(m.channelId);
    if (m.status === "APPROVED") channelIds.push(m.channelId);
  }
  return {
    registered: agg.registered || deposited,
    deposited,
    depositCount,
    spendLevel: computeSpendLevel(agg, d.thresholds),
    languageCode: d.languageCode,
    tags: Array.isArray(d.tags) ? d.tags.filter((t): t is string => typeof t === "string") : [],
    channelIds,
    campaignIds: [...new Set(d.campaignIds)],
    inactiveDays: d.inactiveDays,
    offerClicksSinceStart: d.offerClicksSinceStart,
  };
}

// ---------- Journal d'exécution ----------

/**
 * Entrée du journal `AutomationRun.log`. Règle linéaire : `step` = index de l'action. Graphe : `step` = rang du
 * passage dans l'exécution (0, 1, 2…), `nodeId` = bloc exécuté, `branch` = sortie prise par une condition.
 * `type` : type d'action (`send_message`…), ou `condition`, `wait`, `stop` pour un graphe.
 */
export type AutomationLogEntry = {
  step: number;
  type: string;
  at: string;
  ok: boolean;
  detail?: string;
  nodeId?: string;
  branch?: "yes" | "no";
};

/** Lit un journal brut (JSON) en ignorant les entrées mal formées. */
export function parseRunLog(raw: unknown): AutomationLogEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is AutomationLogEntry =>
      !!e &&
      typeof e === "object" &&
      typeof (e as AutomationLogEntry).type === "string" &&
      typeof (e as AutomationLogEntry).ok === "boolean",
  );
}

export type NodeRunStats = {
  /** Passages par ce bloc (réussis ou non). */
  reached: number;
  failed: number;
  /** Condition : sorties « oui » et « non » prises. */
  yes: number;
  no: number;
  /** Exécutions en attente qui reprendront à ce bloc. */
  waiting: number;
  /** Dernière erreur rencontrée (exécutions fournies de la plus récente à la plus ancienne). */
  lastError: string | null;
};

/** Journal par bloc : agrège les exécutions d'une relance à graphe (statut, bloc courant, journal). */
export function nodeRunStats(
  runs: ReadonlyArray<{ status: string; nodeId?: string | null; log: unknown }>,
): Record<string, NodeRunStats> {
  const out: Record<string, NodeRunStats> = {};
  const get = (id: string) =>
    (out[id] ??= { reached: 0, failed: 0, yes: 0, no: 0, waiting: 0, lastError: null });
  for (const run of runs) {
    if (run.status === "PENDING" && run.nodeId) get(run.nodeId).waiting++;
    for (const e of parseRunLog(run.log)) {
      if (!e.nodeId) continue;
      const s = get(e.nodeId);
      s.reached++;
      if (!e.ok) {
        s.failed++;
        s.lastError ??= e.detail ?? null;
      }
      if (e.branch === "yes") s.yes++;
      if (e.branch === "no") s.no++;
    }
  }
  return out;
}

// ---------- Relances prêtes à l'emploi ----------

/** Cartes « prêtes à l'emploi » (Membres → Relances automatiques), repérées par `AutomationRule.templateKey`. */
export const AUTOMATION_TEMPLATE_KEYS = [
  "welcome",
  "offer_no_signup",
  "signup_no_deposit",
  "inactive_7d",
  "first_deposit_thanks",
  "vip",
] as const;
export type AutomationTemplateKey = (typeof AUTOMATION_TEMPLATE_KEYS)[number];

export function isAutomationTemplateKey(v: unknown): v is AutomationTemplateKey {
  return (AUTOMATION_TEMPLATE_KEYS as readonly unknown[]).includes(v);
}

/** Déclencheur, filtres et délai par défaut (heures, null = sans attente) de chaque carte. */
export const AUTOMATION_TEMPLATE_DEFS: Record<
  AutomationTemplateKey,
  { trigger: AutomationTriggerKey; conditions: AutomationConditions; defaultHours: number | null }
> = {
  welcome: { trigger: "JOINED", conditions: {}, defaultHours: null },
  offer_no_signup: { trigger: "OFFER_CLICKED", conditions: {}, defaultHours: 24 },
  signup_no_deposit: { trigger: "REGISTERED", conditions: {}, defaultHours: 48 },
  inactive_7d: { trigger: "INACTIVE", conditions: { inactiveDays: 7 }, defaultHours: null },
  first_deposit_thanks: { trigger: "DEPOSITED", conditions: {}, defaultHours: null },
  vip: { trigger: "SPEND_LEVEL_REACHED", conditions: { spendLevels: ["VIP"] }, defaultHours: null },
};

/**
 * Parcours d'une carte prête à l'emploi (`hours` remplace le délai par défaut ; null ou absent = défaut) :
 * - welcome, inactive_7d, vip : départ → message (attente avant le message si `hours` est donné) ;
 * - offer_no_signup : départ → attendre (24 h) → « inscrit ? » oui → arrêt, non → message ;
 * - signup_no_deposit : départ → attendre (48 h) → « a déjà déposé ? » oui → arrêt, non → message ;
 * - first_deposit_thanks : départ → « au moins 2 dépôts ? » oui → arrêt, non → message (seulement au premier dépôt).
 * Le message reprend les champs de `send_message` (texte, boutons, média, bot).
 */
export function templateGraph(
  key: AutomationTemplateKey,
  opts: {
    message: Omit<Extract<AutomationAction, { type: "send_message" }>, "type">;
    hours?: number | null;
  },
): AutomationGraph {
  const message: GraphAction = { type: "send_message", ...opts.message };
  const hours = opts.hours ?? AUTOMATION_TEMPLATE_DEFS[key].defaultHours;
  const y = (i: number) => i * GRAPH_NODE_SPACING_Y;
  const nodes: GraphNode[] = [
    { id: GRAPH_TRIGGER_NODE_ID, type: "trigger", position: { x: 0, y: 0 } },
  ];
  const edges: GraphEdge[] = [];
  let prev = GRAPH_TRIGGER_NODE_ID;
  let row = 1;
  if (hours !== null) {
    nodes.push({ id: "wait", type: "wait", position: { x: 0, y: y(row++) }, hours });
    edges.push({ id: "e-wait", source: prev, sourceHandle: "next", target: "wait" });
    prev = "wait";
  }
  const condition: GraphCondition | null =
    key === "offer_no_signup"
      ? { kind: "registered" }
      : key === "signup_no_deposit"
        ? { kind: "deposited" }
        : key === "first_deposit_thanks"
          ? { kind: "deposit_count_gte", n: 2 }
          : null;
  if (!condition) {
    nodes.push({ id: "message", type: "action", position: { x: 0, y: y(row) }, action: message });
    edges.push({ id: "e-message", source: prev, sourceHandle: "next", target: "message" });
    return { version: AUTOMATION_GRAPH_VERSION, nodes, edges };
  }
  nodes.push({ id: "check", type: "condition", position: { x: 0, y: y(row++) }, condition });
  edges.push({ id: "e-check", source: prev, sourceHandle: "next", target: "check" });
  nodes.push({ id: "stop", type: "stop", position: { x: -GRAPH_BRANCH_SPACING_X, y: y(row) } });
  nodes.push({
    id: "message",
    type: "action",
    position: { x: GRAPH_BRANCH_SPACING_X, y: y(row) },
    action: message,
  });
  edges.push({ id: "e-yes", source: "check", sourceHandle: "yes", target: "stop" });
  edges.push({ id: "e-no", source: "check", sourceHandle: "no", target: "message" });
  return { version: AUTOMATION_GRAPH_VERSION, nodes, edges };
}

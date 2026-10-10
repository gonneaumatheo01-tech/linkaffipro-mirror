/**
 * Journal d'une relance pour la fiche (Membres → Relances automatiques → une relance) : passages et erreurs par bloc,
 * position d'une exécution, lignes du journal en français. Fonctions pures (testées dans journal.test.ts).
 *
 * Une relance à liste d'actions s'affiche comme sa branche unique (`linearToGraph` du core : blocs `n1`…`nN`) ; ses
 * entrées de journal (rang de l'action dans `step`, sans `nodeId`) sont rattachées à ces blocs.
 */
import {
  GRAPH_ACTION_LABELS,
  GRAPH_HANDLE_LABELS,
  nodeRunStats,
  parseRunLog,
  type AutomationGraph,
  type AutomationLogEntry,
  type GraphActionType,
  type GraphNames,
  type NodeRunStats,
} from "@linkaffipro/core";
import { nodePhrase, nodeTitle } from "./labels";

export type JournalRun = {
  status: string;
  step: number;
  nodeId?: string | null;
  log: unknown;
};

/** Bloc de la branche unique d'une relance à liste pour l'action de rang `step` (0 = première action). */
export function linearNodeId(step: number): string {
  return `n${step + 1}`;
}

/**
 * Entrées du journal rattachées aux blocs : celles d'un parcours à branches ont déjà `nodeId` ; celles d'une liste
 * d'actions reçoivent le bloc de leur rang.
 */
export function runLogWithNodes(run: JournalRun, linear: boolean): AutomationLogEntry[] {
  const log = parseRunLog(run.log);
  if (!linear) return log;
  return log.map((e) => (e.nodeId ? e : { ...e, nodeId: linearNodeId(Number(e.step) || 0) }));
}

/** Bloc où se trouve l'exécution : prochain bloc pour une attente, bloc en erreur, dernier bloc sinon. */
export function runNodeId(run: JournalRun, linear: boolean): string | null {
  if (!linear) return run.nodeId ?? null;
  if (run.status === "PENDING") return linearNodeId(run.step);
  const log = parseRunLog(run.log);
  const last = log[log.length - 1];
  return last ? linearNodeId(Number(last.step) || 0) : null;
}

/**
 * Passages par bloc (exécutions fournies de la plus récente à la plus ancienne) : `nodeRunStats` du core, avec les
 * relances à liste rattachées à leur branche unique. Les essais « Tester sur moi » comptent (ils sont dans le journal).
 */
export function ruleNodeStats(
  runs: readonly JournalRun[],
  linear: boolean,
): Record<string, NodeRunStats> {
  return nodeRunStats(
    runs.map((r) => ({
      status: r.status,
      nodeId: runNodeId(r, linear),
      log: runLogWithNodes(r, linear),
    })),
  );
}

/** Ce que fait une entrée du journal, en français (« Envoyer un message », « Condition : non »). */
export function logEntryLabel(entry: AutomationLogEntry): string {
  if (entry.type === "condition")
    return `Condition${entry.branch ? ` : ${GRAPH_HANDLE_LABELS[entry.branch].toLowerCase()}` : ""}`;
  if (entry.type === "wait") return "Attendre";
  if (entry.type === "stop") return "Arrêter";
  return GRAPH_ACTION_LABELS[entry.type as GraphActionType] ?? "Étape";
}

/** Libellé du bloc où se trouve une exécution (« Attendre 1 jour », « Message : Bonjour Léa… »), ou null. */
export function nodeLabel(
  graph: AutomationGraph,
  nodeId: string | null | undefined,
  names: GraphNames = {},
): string | null {
  const node = nodeId ? graph.nodes.find((n) => n.id === nodeId) : undefined;
  return node ? nodeTitle(node, names) : null;
}

/**
 * Où en est une exécution, en une phrase (« En attente avant le message « Bonjour Léa… » », « Terminée après
 * l'arrêt ») : un seul niveau de guillemets.
 */
export function runWhereText(
  run: JournalRun,
  graph: AutomationGraph,
  linear: boolean,
  names: GraphNames = {},
): string {
  const id = runNodeId(run, linear);
  const node = id ? graph.nodes.find((n) => n.id === id) : undefined;
  const where = node ? nodePhrase(node, names) : null;
  switch (run.status) {
    case "PENDING":
      return where ? `En attente avant ${where}` : "En attente";
    case "FAILED":
      return where ? `Arrêtée sur ${where}` : "Arrêtée sur une erreur";
    case "DONE":
      return where ? `Terminée après ${where}` : "Terminée";
    case "RUNNING":
      return "En cours";
    case "CANCELLED":
      return "Annulée";
    default:
      return "Ignorée";
  }
}

/** Ligne de tableau « par bloc » : seulement les blocs du parcours (départ exclu), dans l'ordre du parcours. */
export function nodeStatsRows(
  graph: AutomationGraph,
  stats: Record<string, NodeRunStats>,
  order: readonly string[],
  names: GraphNames = {},
): Array<{ id: string; label: string; type: string } & NodeRunStats> {
  const empty: NodeRunStats = { reached: 0, failed: 0, yes: 0, no: 0, waiting: 0, lastError: null };
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return order
    .map((id) => byId.get(id))
    .filter((n): n is NonNullable<typeof n> => !!n && n.type !== "trigger")
    .map((n) => ({
      id: n.id,
      label: nodeTitle(n, names),
      type: n.type,
      ...(stats[n.id] ?? empty),
    }));
}

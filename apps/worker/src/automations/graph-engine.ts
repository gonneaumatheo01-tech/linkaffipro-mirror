/**
 * Exécuteur pur des relances à branches : parcourt le graphe depuis un bloc avec un exécuteur d'actions et un
 * évaluateur de conditions injectés (testable sans base ni Telegram). Les règles linéaires restent sur `executePlan`.
 */
import {
  describeCondition,
  formatWaitHours,
  graphNextNodeId,
  graphTriggerNode,
  parseGraph,
  type AutomationGraph,
  type GraphAction,
  type GraphCondition,
  type GraphNode,
} from "@linkaffipro/core";
import type { ActionExecutor, LogEntry } from "./engine";

/** Évalue une condition sur l'état du membre au moment où l'exécution atteint le bloc (vrai = sortie « oui »). */
export type ConditionEvaluator = (condition: GraphCondition) => boolean | Promise<boolean>;

export type GraphRunOptions = {
  /** Mode test : les étiquettes ne sont pas posées. */
  skipTags?: boolean;
  /** Mode test : les attentes sont passées tout de suite (le parcours complet s'exécute en une fois). */
  skipWaits?: boolean;
  /** Nombre de blocs déjà parcourus (numérotation `step` du journal). */
  stepOffset?: number;
};

export type GraphRunResult = {
  /**
   * Bloc courant : prochain bloc à exécuter après une attente (`resumeAt` renseigné), bloc en erreur (`error`),
   * ou dernier bloc parcouru quand l'exécution est terminée (`done`).
   */
  nodeId: string | null;
  /** Date de reprise après un bloc « attendre ». */
  resumeAt: Date | null;
  done: boolean;
  /** Entrées de ce passage (chacune porte `nodeId`). */
  log: LogEntry[];
  error: string | null;
};

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function runAction(
  a: GraphAction,
  exec: ActionExecutor,
  opts: GraphRunOptions,
): Promise<string> {
  switch (a.type) {
    case "send_message":
      return exec.sendMessage(a);
    case "send_sequence":
      return exec.sendSequence(a);
    case "tag":
      return opts.skipTags ? "ignoré (test)" : exec.tag(a);
    case "suggest_channel":
      return exec.suggestChannel(a);
    case "notify_team":
      return exec.notifyTeam(a);
  }
}

/**
 * Exécute le graphe à partir de `nodeId` (null = depuis le départ) :
 * - action : exécutée, puis suite par « next » ;
 * - condition : évaluée, puis suite par « yes » ou « no » (pas de lien = fin) ;
 * - attendre : s'arrête avec `resumeAt` et le bloc suivant (fin directe s'il n'y a rien après) ;
 * - arrêter : fin ;
 * - erreur (action, condition, graphe invalide, bloc disparu) : arrêt avec `error` et le bloc concerné.
 */
export async function executeGraph(
  rawGraph: unknown,
  nodeId: string | null,
  exec: ActionExecutor,
  evaluate: ConditionEvaluator,
  now: Date,
  opts: GraphRunOptions = {},
): Promise<GraphRunResult> {
  const log: LogEntry[] = [];
  const at = now.toISOString();
  const offset = opts.stepOffset ?? 0;
  const fail = (id: string | null, error: string): GraphRunResult => ({
    nodeId: id,
    resumeAt: null,
    done: false,
    log,
    error,
  });
  const entry = (
    node: GraphNode,
    type: string,
    ok: boolean,
    detail: string,
    branch?: "yes" | "no",
  ) => {
    log.push({
      step: offset + log.length,
      nodeId: node.id,
      type,
      at,
      ok,
      detail,
      ...(branch ? { branch } : {}),
    });
  };

  let graph: AutomationGraph;
  try {
    graph = parseGraph(rawGraph);
  } catch (err) {
    return fail(nodeId, message(err));
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  let cur: string | null;
  if (nodeId === null) {
    cur = graphTriggerNode(graph)?.id ?? null;
  } else {
    if (!byId.has(nodeId))
      return fail(
        nodeId,
        "Bloc introuvable : la relance a été modifiée depuis le début de cette exécution.",
      );
    cur = nodeId;
  }

  let last: string | null = null;
  for (let guard = 0; cur; guard++) {
    // Le graphe validé n'a pas de boucle : garde-fou seulement.
    if (guard > graph.nodes.length) return fail(cur, "Boucle détectée dans la relance.");
    const node = byId.get(cur);
    if (!node) return fail(cur, "Bloc introuvable dans la relance.");
    last = node.id;
    switch (node.type) {
      case "trigger":
        cur = graphNextNodeId(graph, node.id, "next");
        break;
      case "stop":
        entry(node, "stop", true, "arrêt de la relance");
        return { nodeId: node.id, resumeAt: null, done: true, log, error: null };
      case "wait": {
        const next = graphNextNodeId(graph, node.id, "next");
        const duration = formatWaitHours(node.hours);
        if (opts.skipWaits) {
          entry(node, "wait", true, `${duration} (passée : test)`);
          cur = next;
          break;
        }
        if (!next) {
          entry(node, "wait", true, `${duration} (rien ensuite : terminé)`);
          return { nodeId: node.id, resumeAt: null, done: true, log, error: null };
        }
        entry(node, "wait", true, duration);
        return {
          nodeId: next,
          resumeAt: new Date(now.getTime() + node.hours * 3_600_000),
          done: false,
          log,
          error: null,
        };
      }
      case "condition": {
        let yes: boolean;
        try {
          yes = await evaluate(node.condition);
        } catch (err) {
          entry(node, "condition", false, message(err));
          return fail(node.id, message(err));
        }
        const branch = yes ? "yes" : "no";
        entry(
          node,
          "condition",
          true,
          `${yes ? "oui" : "non"} : ${describeCondition(node.condition)}`,
          branch,
        );
        cur = graphNextNodeId(graph, node.id, branch);
        break;
      }
      case "action": {
        try {
          entry(node, node.action.type, true, await runAction(node.action, exec, opts));
        } catch (err) {
          entry(node, node.action.type, false, message(err));
          return fail(node.id, message(err));
        }
        cur = graphNextNodeId(graph, node.id, "next");
        break;
      }
    }
  }
  return { nodeId: last, resumeAt: null, done: true, log, error: null };
}

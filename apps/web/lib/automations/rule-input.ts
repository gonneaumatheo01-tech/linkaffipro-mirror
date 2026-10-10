/**
 * Lecture et contrôle serveur d'une relance envoyée par l'éditeur à branches, puis choix de la forme enregistrée
 * (liste d'actions ou parcours à branches). Fonctions pures (testées dans rule-input.test.ts) ; l'écriture en base
 * reste dans l'action serveur (`app/(admin)/members/automations/actions.ts`).
 */
import {
  AUTOMATION_TRIGGERS,
  graphToLinear,
  isAutomationTemplateKey,
  parseActions,
  parseConditions,
  parseGraph,
  validateTelegramHtml,
  type AutomationAction,
  type AutomationConditions,
  type AutomationGraph,
  type AutomationTriggerKey,
} from "@linkaffipro/core";
import { readCardSettings, type CardKey } from "./cards";

export type EditorRuleInput = {
  name: string;
  trigger: AutomationTriggerKey;
  conditions: AutomationConditions;
  oncePerMember: boolean;
  graph: AutomationGraph;
  /** Carte d'origine demandée par l'éditeur (`?template=…`), si la relance en a toujours la forme. */
  templateKey: CardKey | null;
};

function json(raw: FormDataEntryValue | null, what: string): unknown {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${what} illisible : rechargez la page et recommencez.`);
  }
}

/**
 * Champs du formulaire de l'éditeur : `name`, `trigger`, `oncePerMember` (« on »), `conditions` (JSON des filtres du
 * départ), `graph` (JSON du parcours), `templateKey` (facultatif). Lève une erreur en français si quelque chose ne va
 * pas : nom, déclencheur, filtres, parcours (`parseGraph` du core), mise en forme des textes.
 */
export function readEditorRule(fd: FormData): EditorRuleInput {
  const name = String(fd.get("name") ?? "").trim();
  if (name.length < 2) throw new Error("Donnez un nom à la relance (2 caractères au moins).");
  if (name.length > 80) throw new Error("Nom trop long (80 caractères au plus).");
  const trigger = String(fd.get("trigger") ?? "");
  if (!(AUTOMATION_TRIGGERS as readonly string[]).includes(trigger))
    throw new Error("Choisissez dans le départ ce qui lance la relance.");
  const conditions = parseConditions(json(fd.get("conditions"), "Filtres du départ") ?? {});
  if (trigger === "INACTIVE" && !conditions.inactiveDays)
    throw new Error("Indiquez après combien de jours sans activité la relance part.");
  const rawGraph = json(fd.get("graph"), "Parcours");
  if (rawGraph === undefined) throw new Error("Le parcours de la relance est vide.");
  const graph = parseGraph(rawGraph);
  for (const n of graph.nodes) {
    if (n.type !== "action") continue;
    const text = "text" in n.action ? n.action.text : undefined;
    if (!text) continue;
    const v = validateTelegramHtml(text);
    if (!v.ok) throw new Error(`Texte à corriger : ${v.error}`);
  }
  const key = String(fd.get("templateKey") ?? "");
  return {
    name,
    trigger: trigger as AutomationTriggerKey,
    conditions,
    oncePerMember: fd.get("oncePerMember") === "on",
    graph,
    templateKey: isAutomationTemplateKey(key) ? key : null,
  };
}

/**
 * Forme enregistrée d'un parcours validé :
 * - relance existante à liste d'actions (`graph` vide) dont le parcours est resté une simple chaîne : elle reste une
 *   liste (les membres en attente reprennent comme avant) ;
 * - sinon : le parcours est enregistré (`graph`), et `actions` reçoit la liste équivalente si c'est une simple chaîne
 *   (compatibilité), une liste vide sinon.
 */
export function storageFor(
  graph: AutomationGraph,
  previous: { graph: unknown } | null,
): { graph: AutomationGraph | null; actions: AutomationAction[] } {
  const chain = graphToLinear(graph);
  const wasLinear = previous !== null && (previous.graph === null || previous.graph === undefined);
  if (wasLinear && chain) return { graph: null, actions: chain };
  return { graph, actions: chain ?? [] };
}

/**
 * Carte d'une relance après un enregistrement depuis l'éditeur : la carte précédente (ou celle demandée à la
 * création) si la relance en a encore exactement la forme, sinon aucune (elle passe en « sur mesure »).
 */
export function templateKeyAfterEdit(
  wanted: string | null | undefined,
  saved: { trigger: string; conditions: unknown; actions: unknown; graph: unknown },
): CardKey | null {
  if (!isAutomationTemplateKey(wanted)) return null;
  return readCardSettings(wanted, { ...saved, templateKey: wanted }) ? wanted : null;
}

/**
 * Relance à liste d'actions qui perd sa seule attente (carte « Bienvenue » passée de « 1 jour » à « tout de suite ») :
 * les membres en attente sont à l'étape qui suit l'attente (`from`) ; sans décalage, la nouvelle liste n'aurait plus
 * rien à cette étape et ils ne recevraient jamais le message. Renvoie l'étape où les reprendre (`to`) pour qu'ils
 * reçoivent la même suite à l'heure prévue, ou null si rien n'est à décaler (liste illisible, attente gardée ou
 * suite différente).
 */
export function pendingStepRemap(
  previousActions: unknown,
  next: readonly AutomationAction[],
): { from: number; to: number } | null {
  let prev: AutomationAction[];
  try {
    prev = parseActions(previousActions);
  } catch {
    return null;
  }
  const waits = prev.flatMap((a, i) => (a.type === "wait" ? [i] : []));
  if (waits.length !== 1 || next.some((a) => a.type === "wait")) return null;
  const w = waits[0]!;
  const rest = prev.filter((_, i) => i !== w).map((a) => a.type);
  if (rest.length !== next.length || rest.some((t, i) => t !== next[i]!.type)) return null;
  // Attente en dernier : personne n'attend une étape suivante (l'exécution se termine à la reprise).
  if (w + 1 >= prev.length) return null;
  return { from: w + 1, to: w };
}

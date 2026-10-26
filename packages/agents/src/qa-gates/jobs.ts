/**
 * Phase 30, chantier B — tâches répétées du QA Global (file `agents-orchestrator`, toutes les 5 minutes) :
 * - `qa-sweep` : recommandations PROPOSED sans approbation vérifiées, alertes des Analystes retenues faute de QA ;
 * - `qa-alerts` : alertes internes du QA (`checkQaAlerts` du moteur : taux de refus, modèle indisponible…) envoyées
 *   par Kevin (textes déjà rendus par le moteur, jamais de contenu vérifié).
 */
import { agentEvent } from "../admin/journal";
import { retryAnalystsAlert } from "../analysts/kevin-jobs";
import type { AnalystsKevinDeps } from "../analysts/kevin-port";
import type { QaDeps } from "../qa/contract";
import { checkQaAlerts, type QaAlert } from "../qa/index";
import type { AgentsDeps } from "../types";
import { qaSweep } from "./recommendations";

export async function runQaSweep(deps: QaDeps & AgentsDeps): Promise<Record<string, unknown>> {
  return qaSweep(deps, { retryAlert: (a) => retryAnalystsAlert(deps as AnalystsKevinDeps, a) });
}

export async function runQaAlerts(deps: QaDeps & AgentsDeps): Promise<Record<string, unknown>> {
  let alerts: QaAlert[] = [];
  try {
    alerts = await checkQaAlerts(deps);
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[qa] alertes internes illisibles");
    return { ok: false };
  }
  let sent = 0;
  for (const a of alerts) {
    // `log` (latence) : avertissement dans le journal du worker seulement ; `client` : Kevin prévient.
    if (a.audience !== "client") {
      deps.logger?.warn({ key: a.key, ...a.data }, `[qa] ${a.text}`);
      continue;
    }
    try {
      if (await deps.admin?.send(a.text)) sent++;
    } catch (err) {
      deps.logger?.warn({ err: (err as Error).message, key: a.key }, "[qa] alerte interne non envoyée");
    }
  }
  if (alerts.length) await agentEvent(deps, "qa.alerts.sent", { keys: alerts.map((a) => a.key), sent });
  return { ok: true, alerts: alerts.length, sent };
}

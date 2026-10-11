/**
 * Moteur pur des automatisations : sélection des règles et exécution d'un plan d'actions
 * avec un exécuteur injecté (testable sans base ni Telegram).
 */
import { matchesConditions, parseActions, parseConditions, type AutomationAction, type AutomationContext, type AutomationLogEntry } from "@linkaffipro/core";

export type RuleRow = { id: string; name: string; trigger: string; conditions: unknown; actions: unknown; isActive: boolean; oncePerMember: boolean };

/** Entrée du journal `AutomationRun.log` (graphe : avec `nodeId` et `branch`, voir `AutomationLogEntry`). */
export type LogEntry = AutomationLogEntry;

/**
 * Règles actives du déclencheur dont les conditions correspondent au contexte.
 * `fromRuleId` : relance dont le bouton Offre a été cliqué (événement « A cliqué sur une offre » venu d'un lien de
 * relance). Pas d'envoi en boucle : cette relance n'est jamais relancée par son propre bouton, et les autres ne le
 * sont que si elles partent « une fois par membre » (sinon deux relances se relanceraient l'une l'autre à chaque clic).
 */
export function selectRules(rules: RuleRow[], trigger: string, ctx: AutomationContext, opts: { fromRuleId?: string | null } = {}): RuleRow[] {
  return rules.filter((r) => {
    if (!r.isActive || r.trigger !== trigger) return false;
    if (opts.fromRuleId && (r.id === opts.fromRuleId || !r.oncePerMember)) return false;
    try {
      return matchesConditions(ctx, parseConditions(r.conditions));
    } catch {
      return false;
    }
  });
}

/** Exécuteur des actions : chaque méthode renvoie un détail lisible (journal) ou lève une erreur. */
export interface ActionExecutor {
  sendMessage(a: Extract<AutomationAction, { type: "send_message" }>): Promise<string>;
  sendSequence(a: Extract<AutomationAction, { type: "send_sequence" }>): Promise<string>;
  tag(a: Extract<AutomationAction, { type: "tag" }>): Promise<string>;
  suggestChannel(a: Extract<AutomationAction, { type: "suggest_channel" }>): Promise<string>;
  notifyTeam(a: Extract<AutomationAction, { type: "notify_team" }>): Promise<string>;
}

export type PlanResult = {
  /** Prochaine étape à exécuter (index dans la liste d'actions). */
  nextStep: number;
  /** Date de reprise si une action « attendre » a été rencontrée. */
  resumeAt: Date | null;
  done: boolean;
  log: LogEntry[];
  error: string | null;
};

/**
 * Exécute les actions à partir de `step`. S'arrête sur une action « attendre » (reprise plus tard)
 * ou à la fin ; une erreur arrête le plan avec `error`.
 */
export async function executePlan(rawActions: unknown, step: number, exec: ActionExecutor, now: Date, opts: { skipTags?: boolean } = {}): Promise<PlanResult> {
  const actions = parseActions(rawActions);
  const log: LogEntry[] = [];
  for (let i = step; i < actions.length; i++) {
    const a = actions[i]!;
    const at = now.toISOString();
    try {
      let detail = "";
      switch (a.type) {
        case "wait": {
          log.push({ step: i, type: a.type, at, ok: true, detail: `${a.hours} h` });
          return { nextStep: i + 1, resumeAt: new Date(now.getTime() + a.hours * 3_600_000), done: false, log, error: null };
        }
        case "send_message": detail = await exec.sendMessage(a); break;
        case "send_sequence": detail = await exec.sendSequence(a); break;
        case "tag": detail = opts.skipTags ? "ignoré (test)" : await exec.tag(a); break;
        case "suggest_channel": detail = await exec.suggestChannel(a); break;
        case "notify_team": detail = await exec.notifyTeam(a); break;
      }
      log.push({ step: i, type: a.type, at, ok: true, detail });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.push({ step: i, type: a.type, at, ok: false, detail: message });
      return { nextStep: i, resumeAt: null, done: false, log, error: message };
    }
  }
  return { nextStep: actions.length, resumeAt: null, done: true, log, error: null };
}

/** Jours entiers écoulés depuis une date (null si inconnue). */
export function daysSince(date: Date | null | undefined, now: Date): number | null {
  if (!date) return null;
  return Math.floor((now.getTime() - date.getTime()) / 86_400_000);
}

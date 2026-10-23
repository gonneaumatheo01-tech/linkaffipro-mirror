/**
 * Passage du Grand Chef (file `agents-orchestrator`, toutes les 30 minutes et à la demande) : question unique sur le
 * rapport du matin, plan du jour, reprise des missions, validations sans réponse (24 h : reportée + rappel ; 72 h :
 * annulée), demandes au client, rapport de 9 h. Logique programmée, aucun appel d'IA. Chaque partie est isolée :
 * une erreur n'empêche pas les autres.
 */
import { agentEvent, nowOf } from "../admin/journal";
import { ensureDailyReportQuestion, sweepHumanRequests } from "../human/site";
import { ensureTeamConfigs, isAgentsPausedAll } from "../missions/settings";
import type { AgentsDeps, TeamKey } from "../types";
import { sweepValidations } from "../validation/sweep";
import { planDay } from "./plan-day";
import { sendDailyReport } from "./reports";
import { resumeMissions } from "./resume";

export const DAILY_REPORT_ASKED_KEY = "agents.dailyReportAsked";

export type CycleResult = Record<string, unknown>;

async function step<T>(deps: AgentsDeps, name: string, out: CycleResult, fn: () => Promise<T>): Promise<void> {
  try {
    out[name] = await fn();
  } catch (err) {
    out[name] = { error: (err as Error).message };
    deps.logger?.error({ err: (err as Error).message, part: name }, "[agents] partie du cycle en erreur");
  }
}

/** Pose une seule fois la question du rapport du matin (`Setting` `agents.dailyReportAsked`). */
export async function askDailyReportOnce(deps: AgentsDeps): Promise<boolean> {
  const asked = await deps.prisma.setting.findUnique({ where: { key: DAILY_REPORT_ASKED_KEY } });
  if (asked) return false;
  await ensureDailyReportQuestion(deps);
  await deps.prisma.setting.upsert({
    where: { key: DAILY_REPORT_ASKED_KEY },
    create: { key: DAILY_REPORT_ASKED_KEY, value: nowOf(deps).toISOString() },
    update: {},
  });
  return true;
}

export async function runCycle(deps: AgentsDeps, opts: { teamKey?: TeamKey } = {}): Promise<CycleResult> {
  const out: CycleResult = {};
  await ensureTeamConfigs(deps.prisma);
  await step(deps, "dailyReportQuestion", out, () => askDailyReportOnce(deps));
  if (await isAgentsPausedAll(deps.prisma)) out.plan = { skipped: "pause générale" };
  else await step(deps, "plan", out, () => planDay(deps, opts));
  await step(deps, "resume", out, () => resumeMissions(deps));
  await step(deps, "validations", out, () => sweepValidations(deps));
  await step(deps, "humanRequests", out, () => sweepHumanRequests(deps));
  await step(deps, "report", out, () => sendDailyReport(deps));
  await agentEvent(deps, "agents.cycle", { teamKey: opts.teamKey ?? null, created: (out.plan as { created?: number } | undefined)?.created ?? 0 });
  return out;
}

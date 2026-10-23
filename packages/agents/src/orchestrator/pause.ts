/**
 * Pause : une équipe en pause (`AgentTeamConfig.paused`) ou la pause générale (`Setting` `agents.pausedAll`) arrête
 * toute création et toute étape ; les missions en cours attendent. Mise en pause automatique après 3 missions échouées
 * de suite (alerte `agents_team_paused` par le passage d'alertes du worker, et message immédiat à l'admin).
 */
import { escapeHtml } from "@linkaffipro/core";
import { agentEvent } from "../admin/journal";
import { isAgentsPausedAll } from "../missions/settings";
import { TEAM_LABELS, type AgentsDeps, type TeamKey } from "../types";

export const AUTO_PAUSE_AFTER_FAILURES = 3;
export const AUTO_PAUSE_REASON = "3 missions échouées de suite";

export async function isTeamHalted(deps: AgentsDeps, teamKey: TeamKey): Promise<{ halted: boolean; reason: string | null }> {
  if (await isAgentsPausedAll(deps.prisma)) return { halted: true, reason: "pause générale" };
  const row = await deps.prisma.agentTeamConfig.findUnique({ where: { teamKey }, select: { paused: true, enabled: true } });
  if (row?.paused) return { halted: true, reason: "équipe en pause" };
  if (row && row.enabled === false) return { halted: true, reason: "équipe désactivée" };
  return { halted: false, reason: null };
}

/** Une mission a échoué : compteur +1, pause automatique au 3e échec de suite. Renvoie vrai si l'équipe vient d'être mise en pause. */
export async function recordMissionFailure(deps: AgentsDeps, teamKey: TeamKey, lastError: string): Promise<boolean> {
  const row = await deps.prisma.agentTeamConfig.update({
    where: { teamKey },
    data: { consecutiveFailures: { increment: 1 } },
    select: { consecutiveFailures: true, paused: true },
  });
  if (row.paused || row.consecutiveFailures < AUTO_PAUSE_AFTER_FAILURES) return false;
  await deps.prisma.agentTeamConfig.update({ where: { teamKey }, data: { paused: true, pausedReason: AUTO_PAUSE_REASON } });
  await agentEvent(deps, "agents.team.auto_paused", { teamKey, failures: row.consecutiveFailures });
  try {
    await deps.admin?.send(
      `⏸ <b>Équipe ${escapeHtml(TEAM_LABELS[teamKey])} mise en pause</b>\n${AUTO_PAUSE_REASON} (dernière erreur : ${escapeHtml(lastError.slice(0, 200))}). Réponds « reprends ${teamKey} » quand c'est réglé.`,
    );
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[agents] message de pause non envoyé");
  }
  return true;
}

/** Une mission a réussi : le compteur d'échecs repart à zéro. */
export async function recordMissionSuccess(deps: AgentsDeps, teamKey: TeamKey): Promise<void> {
  await deps.prisma.agentTeamConfig.updateMany({ where: { teamKey, consecutiveFailures: { gt: 0 } }, data: { consecutiveFailures: 0 } });
}

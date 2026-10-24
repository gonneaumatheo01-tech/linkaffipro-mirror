/**
 * Filet des messages d'agents (relecture de la phase 25) : un `Post` programmé par une mission d'agent
 * (`agentMissionId`) est revérifié au moment où le scheduler le réclame, car la mission est souvent déjà terminée :
 * - équipe de la mission revenue en simulation alors que le message vise un vrai canal (pas le canal Test) →
 *   message CANCELLED + `Event` `agents.post.cancelled_simulation` (jamais publié sur un vrai canal) ;
 * - équipe en pause, désactivée, ou pause générale → message retenu : remis en SCHEDULED 30 min plus tard, sans
 *   compter d'échec (`attempts` inchangé), `Event` `agents.post.held` ; il repart tout seul à la reprise.
 * Un message humain (sans `agentMissionId`) n'est jamais touché.
 */
import { prisma, recordEvent, toJsonValue } from "@linkaffipro/db";

export const AGENT_POST_HOLD_MS = 30 * 60_000;
export const AGENT_POST_SIMULATION_MESSAGE = "Non publié : l'équipe d'agents est repassée en simulation, ce message visait un vrai canal.";
const PAUSED_ALL_KEY = "agents.pausedAll";

export type AgentPostDecision = "send" | "held" | "cancelled";

type PostRef = { id: string; agentMissionId?: string | null; channelId: string; botId?: string | null };

export async function agentPostDecision(post: PostRef, now: Date = new Date()): Promise<AgentPostDecision> {
  if (!post.agentMissionId) return "send";
  const mission = await prisma.agentMission.findUnique({ where: { id: post.agentMissionId }, select: { teamKey: true, isTest: true } });
  if (!mission) return "send";
  const [team, pausedAll, channel] = await Promise.all([
    prisma.agentTeamConfig.findUnique({ where: { teamKey: mission.teamKey }, select: { simulation: true, paused: true, enabled: true } }),
    prisma.setting.findUnique({ where: { key: PAUSED_ALL_KEY } }),
    prisma.channel.findUnique({ where: { id: post.channelId }, select: { isTest: true } }),
  ]);
  // Sans réglage d'équipe : simulation (valeur par défaut des agents).
  const simulation = mission.isTest || team?.simulation !== false;
  if (simulation && channel && !channel.isTest) {
    await prisma.post.update({ where: { id: post.id }, data: { status: "CANCELLED", lastError: AGENT_POST_SIMULATION_MESSAGE } });
    await recordEvent({
      type: "agents.post.cancelled_simulation",
      channelId: post.channelId,
      botId: post.botId ?? null,
      payload: toJsonValue({ postId: post.id, missionId: post.agentMissionId, teamKey: mission.teamKey }),
    });
    return "cancelled";
  }
  const all = pausedAll?.value === true || (pausedAll?.value as { paused?: unknown } | null)?.paused === true;
  if (all || team?.paused === true || team?.enabled === false) {
    const until = new Date(now.getTime() + AGENT_POST_HOLD_MS);
    await prisma.post.update({ where: { id: post.id }, data: { status: "SCHEDULED", scheduledAt: until } });
    await recordEvent({
      type: "agents.post.held",
      channelId: post.channelId,
      botId: post.botId ?? null,
      payload: toJsonValue({ postId: post.id, missionId: post.agentMissionId, teamKey: mission.teamKey, reason: all ? "pause générale" : team?.paused ? "équipe en pause" : "équipe désactivée", until: until.toISOString() }),
    });
    return "held";
  }
  return "send";
}

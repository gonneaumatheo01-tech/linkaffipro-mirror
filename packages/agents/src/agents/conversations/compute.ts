/**
 * Chiffres par profil sur une fenêtre glissante (30 jours par défaut, se terminant maintenant ou à `end`).
 */
import type { ConversationProfileStats } from "../../algo/contracts";
import type { AgentsDeps } from "../../types";
import { loadProfileInput } from "./load";
import { aggregateProfiles } from "./profiles";
import { loadConversationsSettings, PROFILE_DAYS } from "./settings";

const DAY_MS = 86_400_000;

export function profileWindow(end: Date, days = PROFILE_DAYS): { start: Date; end: Date } {
  return { start: new Date(end.getTime() - Math.max(1, days) * DAY_MS), end };
}

export async function computeProfiles(
  deps: AgentsDeps,
  opts: { days?: number; end?: Date } = {},
): Promise<{ profiles: ConversationProfileStats[]; minConversations: number; window: { start: Date; end: Date } }> {
  const end = opts.end ?? (deps.now ?? (() => new Date()))();
  const window = profileWindow(end, opts.days);
  const { minConversations } = await loadConversationsSettings(deps.prisma);
  const input = await loadProfileInput(deps.prisma, window, minConversations);
  return { profiles: aggregateProfiles(input, end), minConversations, window };
}

/**
 * Repli d'un post Dating (photo → texte) : journalisé (`Event` `agents.dating.fallback`), gardé dans
 * `payload.fallbacks` et compté dans le rapport du matin.
 */
import { agentEvent } from "../../admin/journal";
import { fallbackFormat, type DatingFallback } from "../../chiefs/dating-format";
import type { AgentContext, Mission, MissionPayload } from "../../types";
import type { MediaFormat } from "../mediatheque/pick";

export const FALLBACK_EVENT = "agents.dating.fallback";

export function fallbacksOf(payload: MissionPayload): DatingFallback[] {
  return Array.isArray(payload.fallbacks) ? (payload.fallbacks as DatingFallback[]) : [];
}

/** Passe au format de repli ; rend la nouvelle charge utile (ou null si le format n'a pas de repli). */
export async function applyFallback(
  ctx: AgentContext,
  mission: Pick<Mission, "id" | "channelId" | "payload">,
  from: MediaFormat,
  reason: string,
): Promise<{ format: MediaFormat; patch: Partial<MissionPayload> } | null> {
  const to = fallbackFormat(from);
  if (!to) return null;
  const entry: DatingFallback = { from, to, reason: reason.slice(0, 200), at: ctx.now().toISOString() };
  await agentEvent(ctx, FALLBACK_EVENT, { missionId: mission.id, from, to, reason: entry.reason }, { channelId: mission.channelId });
  return {
    format: to,
    patch: {
      format: to,
      fallbacks: [...fallbacksOf(mission.payload), entry],
      ...(to === "text" ? { mediaAssetId: null } : {}),
    },
  };
}

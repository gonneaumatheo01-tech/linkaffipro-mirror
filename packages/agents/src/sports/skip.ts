/**
 * Pari écarté (phase 23) : `BettingPick` SKIPPED avec son motif, `Event` `agents.sports.pick_skipped`, mission
 * annulée (jamais publiée avec une vieille cote). Le moteur, qui enfile ensuite l'étape suivante, l'ignore : une
 * mission annulée est terminale.
 */
import { agentEvent } from "../admin/journal";
import { cancelMission } from "../missions/lifecycle";
import type { AgentContext, AgentResult, Mission } from "../types";
import type { PickRow } from "./data";

export async function skipPick(ctx: AgentContext, mission: Mission, pick: PickRow, reason: string, extra: Record<string, unknown> = {}): Promise<AgentResult> {
  await ctx.prisma.bettingPick.update({ where: { id: pick.id }, data: { status: "SKIPPED", skipReason: reason.slice(0, 300), ...(typeof extra.oddsAtSend === "number" ? { oddsAtSend: extra.oddsAtSend } : {}) } });
  await agentEvent(ctx, "agents.sports.pick_skipped", { missionId: mission.id, pickId: pick.id, eventId: pick.eventId, marketId: pick.marketId, reason: reason.slice(0, 200), ...extra }, { channelId: mission.channelId });
  await cancelMission(ctx, mission.id, { reason: `pari écarté : ${reason}` });
  return { ok: true, output: { betSkipped: true, reasons: [reason] }, summary: `pari écarté : ${reason}` };
}

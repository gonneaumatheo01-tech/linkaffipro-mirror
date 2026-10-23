/**
 * Calcul du créneau d'une mission (lu en base, décidé par `rules/slots.ts`) ; partagé par Planification et par
 * Publication (créneau dépassé après une validation tardive).
 */
import { pickSlot, preferredFromBestHours, type SlotResult } from "../../rules/slots";
import type { AgentContext, Mission } from "../../types";
import { loadPlan } from "../data";

const DAY = 86_400_000;

export async function planSlot(mission: Mission, ctx: AgentContext): Promise<SlotResult> {
  const now = ctx.now();
  const plan = await loadPlan(ctx.prisma, mission);
  const notBefore = typeof mission.payload.notBefore === "string" ? new Date(mission.payload.notBefore) : null;
  if (plan.test) return pickSlot({ now, notBefore, plan, leadMinutes: 1, stepMinutes: 1 });
  const channelId = mission.channelId;
  if (!channelId) return { ok: false, reason: "Mission sans canal." };
  const from = new Date(now.getTime() - DAY);
  const to = new Date(now.getTime() + 9 * DAY);
  const [posts, missions, best] = await Promise.all([
    ctx.prisma.post.findMany({
      where: {
        channelId,
        isTemplate: false,
        status: { in: ["SCHEDULED", "SENDING", "SENT"] },
        OR: [{ scheduledAt: { gte: from, lte: to } }, { sentAt: { gte: from, lte: to } }],
      },
      select: { scheduledAt: true, sentAt: true, agentMissionId: true },
    }),
    ctx.prisma.agentMission.findMany({
      where: {
        channelId,
        id: { not: mission.id },
        status: { notIn: ["CANCELLED", "FAILED", "BLOCKED_BUDGET"] },
        scheduledFor: { gte: from, lte: to },
      },
      select: { scheduledFor: true },
    }),
    ctx.prisma.setting.findUnique({ where: { key: `besthours.${channelId}` } }),
  ]);
  const occupied = posts
    .filter((p) => !p.agentMissionId || p.agentMissionId !== mission.id)
    .map((p) => p.sentAt ?? p.scheduledAt)
    .filter((d): d is Date => d instanceof Date);
  const agentSlots = missions.map((m) => m.scheduledFor).filter((d): d is Date => d instanceof Date);
  return pickSlot({
    now,
    notBefore,
    plan,
    quietHours: ctx.settings.quietHours,
    occupied,
    agentSlots,
    preferred: preferredFromBestHours(best?.value),
  });
}

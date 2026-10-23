/**
 * Reprise des missions (balayage `resume`, toutes les 10 minutes) :
 * - missions PENDING ou RUNNING sans activité depuis 15 minutes → étape courante ré-enfilée (étape idempotente) ;
 * - missions en attente de validation dont la décision est prise (reprise interrompue) → reprises ;
 * - missions en attente de validation sans validation créée (aperçu non parti) → validation redemandée.
 * Équipe en pause : rien n'est relancé.
 */
import { nowOf } from "../admin/journal";
import { continueMission } from "../missions/lifecycle";
import { parsePayload, parseSteps } from "../missions/mission";
import { isTeamKey, type AgentsDeps, type TeamKey } from "../types";
import { requestValidation } from "../validation/requests";
import { isTeamHalted } from "./pause";

export const STALE_AFTER_MS = 15 * 60_000;

export async function resumeMissions(deps: AgentsDeps): Promise<{ requeued: number; continued: number; revalidated: number }> {
  const now = nowOf(deps);
  const stale = new Date(now.getTime() - STALE_AFTER_MS);
  const out = { requeued: 0, continued: 0, revalidated: 0 };
  const halted = new Map<TeamKey, boolean>();
  const isHalted = async (t: TeamKey) => {
    if (!halted.has(t)) halted.set(t, (await isTeamHalted(deps, t)).halted);
    return halted.get(t)!;
  };

  const running = await deps.prisma.agentMission.findMany({
    where: { status: { in: ["PENDING", "RUNNING"] }, lastActivityAt: { lt: stale } },
    orderBy: { lastActivityAt: "asc" },
    take: 200,
  });
  for (const m of running) {
    if (!isTeamKey(m.teamKey) || (await isHalted(m.teamKey))) continue;
    const step = parseSteps(m.steps)[m.currentStep];
    if (!step) continue;
    await deps.prisma.agentMission.update({ where: { id: m.id }, data: { lastActivityAt: now } });
    try {
      await deps.enqueue.step(m.teamKey, step.agent, { type: "step", missionId: m.id, index: m.currentStep });
      out.requeued++;
    } catch (err) {
      deps.logger?.warn({ err: (err as Error).message, missionId: m.id }, "[agents] reprise non enfilée");
    }
  }

  const waiting = await deps.prisma.agentMission.findMany({
    where: { status: "WAITING_VALIDATION", lastActivityAt: { lt: new Date(now.getTime() - 10 * 60_000) } },
    take: 200,
  });
  for (const m of waiting) {
    if (!isTeamKey(m.teamKey) || (await isHalted(m.teamKey))) continue;
    const v = m.validationId
      ? await deps.prisma.agentValidation.findUnique({ where: { id: m.validationId } })
      : await deps.prisma.agentValidation.findFirst({ where: { missionId: m.id }, orderBy: { createdAt: "desc" } });
    try {
      if (v && (v.status === "APPROVED" || v.status === "EDITED")) {
        await continueMission(deps, m.id, v.status === "EDITED" ? { fromAgent: "controle", reason: "reprise après correction" } : { reason: "reprise après validation" });
        out.continued++;
      } else if (!v) {
        const p = parsePayload(m.payload);
        const channel = m.channelId ? await deps.prisma.channel.findUnique({ where: { id: m.channelId }, select: { title: true } }) : null;
        await requestValidation(deps, {
          missionId: m.id,
          teamKey: m.teamKey,
          previewText: p.text ?? "",
          mediaAssetId: p.mediaAssetId ?? null,
          reason: (p.reasons ?? []).join(" ; ") || "validation demandée",
          channelTitle: channel?.title ?? null,
        });
        out.revalidated++;
      }
    } catch (err) {
      deps.logger?.warn({ err: (err as Error).message, missionId: m.id }, "[agents] reprise d'une mission en attente impossible");
    }
  }
  return out;
}

/**
 * Validations sans réponse (tâche `validations` de `agents-orchestrator`) : après 24 h, la mission est reportée au
 * lendemain et un rappel part (une seule fois) ; après 72 h, la validation expire et la mission est annulée.
 */
import * as lifecycle from "../missions/lifecycle";
import type { AgentsDeps } from "../types";
import { agentEvent, nowOf } from "../admin/journal";
import { groupForRequests } from "../boss/team/group";
import { findTeamMember, mentionHtml } from "../boss/team/members";

export const VALIDATION_REMIND_AFTER_MS = 24 * 3600_000;
export const VALIDATION_EXPIRE_AFTER_MS = 72 * 3600_000;

export async function sweepValidations(deps: AgentsDeps): Promise<{ reminded: number; expired: number }> {
  const now = nowOf(deps);
  let reminded = 0;
  let expired = 0;

  const old = await deps.prisma.agentValidation.findMany({
    where: { status: "PENDING", createdAt: { lt: new Date(now.getTime() - VALIDATION_EXPIRE_AFTER_MS) } },
  });
  for (const v of old) {
    const done = await deps.prisma.agentValidation.updateMany({
      where: { id: v.id, status: "PENDING" },
      data: { status: "EXPIRED", decidedAt: now, awaitingEditAt: null },
    });
    if (done.count === 0) continue;
    expired++;
    await agentEvent(deps, "agents.validation.expired", { validationId: v.id, number: v.number, missionId: v.missionId });
    try {
      await lifecycle.cancelMission(deps, v.missionId, { reason: "validation sans réponse depuis 72 h" });
    } catch (err) {
      deps.logger?.error({ err: (err as Error).message, missionId: v.missionId }, "[agents] annulation impossible");
    }
  }

  const late = await deps.prisma.agentValidation.findMany({
    where: {
      status: "PENDING",
      remindedAt: null,
      createdAt: { lt: new Date(now.getTime() - VALIDATION_REMIND_AFTER_MS) },
    },
  });
  for (const v of late) {
    await deps.prisma.agentValidation.update({ where: { id: v.id }, data: { remindedAt: now } });
    // Le créneau du jour est passé : la mission vise le même moment le lendemain (Planification revoit l'heure à la reprise).
    const mission = await deps.prisma.agentMission.findUnique({ where: { id: v.missionId } });
    if (mission?.scheduledFor && mission.scheduledFor.getTime() < now.getTime() + 3600_000) {
      await deps.prisma.agentMission.update({
        where: { id: v.missionId },
        data: { scheduledFor: new Date(mission.scheduledFor.getTime() + 24 * 3600_000) },
      });
    }
    if (deps.admin) {
      try {
        const text = `⏰ Rappel : le post n°${v.number} attend ta décision depuis 24 h. Il est reporté à demain ; sans réponse sous 48 h, il sera abandonné.`;
        // Phase 26 : validation adressée à un membre (dans le groupe) → rappel dans le groupe avec sa mention.
        const member = v.assigneeTelegramId ? await findTeamMember(deps, v.assigneeTelegramId) : null;
        const group = member ? await groupForRequests(deps).catch(() => null) : null;
        const inGroup = group && member && deps.admin.sendTo ? await deps.admin.sendTo(group, `${mentionHtml(member)} ${text}`, { replyToMessageId: v.telegramMessageId ?? undefined }).catch(() => null) : null;
        if (!inGroup) await deps.admin.send(text, { replyToMessageId: member ? undefined : (v.telegramMessageId ?? undefined) });
      } catch (err) {
        deps.logger?.warn({ err: (err as Error).message, validationId: v.id }, "[agents] rappel non envoyé");
      }
    }
    reminded++;
    await agentEvent(deps, "agents.validation.reminded", { validationId: v.id, number: v.number, missionId: v.missionId });
  }
  return { reminded, expired };
}

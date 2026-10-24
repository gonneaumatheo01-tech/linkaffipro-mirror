/**
 * Phase 26, section 4 — boutons des aperçus de validation (`agv:`) et des questions à bouton (`agh:`) appuyés dans le
 * groupe de l'équipe. L'admin : comme en privé. Le membre à qui la validation ou la question est adressée : sa
 * décision compte (journalisée avec son identifiant Telegram). Toute autre personne : rien (silence).
 */
import { adminTelegramId, agentAudit } from "../../admin/journal";
import { handleAgentsCallback, parseValidationCallback, type AgentsCallbackResult } from "../../admin/callbacks";
import { REQUEST_CALLBACK_PREFIX } from "../../human/requests";
import { respondToRequest, type HumanRequestRow } from "../../human/respond";
import { decideValidation } from "../../validation/requests";
import { teamAdminOnlyRequest } from "../../human/delivery";
import type { AgentsDeps } from "../../types";

const REQUEST_DATA = /^agh:([A-Za-z0-9_-]{1,40}):(oui|non)$/;

export async function bossTeamCallback(deps: AgentsDeps, input: { data: string; fromTelegramId: bigint }): Promise<AgentsCallbackResult> {
  const admin = await adminTelegramId(deps);
  if (admin && admin === input.fromTelegramId) return handleAgentsCallback(deps, input);
  const audit = (action: string, entityType: string, entityId: string, extra: Record<string, unknown>) =>
    agentAudit(deps, { userId: null, action, entityType, entityId, metadata: { via: "TELEGRAM", telegramActorId: input.fromTelegramId.toString(), inGroup: true, ...extra } });
  const v = parseValidationCallback(input.data);
  if (v) {
    const row = (await deps.prisma.agentValidation.findUnique({ where: { id: v.validationId } })) as { id: string; assigneeTelegramId?: bigint | null } | null;
    if (!row || row.assigneeTelegramId !== input.fromTelegramId) return { handled: true };
    const decision = v.action === "ok" ? "approve" : v.action === "edit" ? "edit" : "reject";
    const r = await decideValidation(deps, { validationId: row.id, decision, via: "TELEGRAM", byUserId: null });
    await audit(`boss.${decision === "approve" ? "valider_post" : decision === "reject" ? "refuser_post" : "corriger_post"}`, "AgentValidation", row.id, { ok: r.ok });
    if (!r.ok) return { handled: true, toast: r.message.slice(0, 190), removeButtons: true };
    return {
      handled: true,
      toast: decision === "approve" ? "Validé ✅" : decision === "reject" ? "Refusé ❌" : "Envoie le nouveau texte ✏️",
      reply: decision === "edit" ? `${r.message}\n↩️ Réponds à CE message avec le nouveau texte.` : r.message,
      removeButtons: decision !== "edit",
    };
  }
  if (input.data.startsWith(REQUEST_CALLBACK_PREFIX)) {
    const m = REQUEST_DATA.exec(input.data);
    if (!m) return { handled: true };
    const request = (await deps.prisma.humanRequest.findUnique({ where: { id: m[1]! } })) as (HumanRequestRow & { assigneeTelegramId?: bigint | null }) | null;
    if (!request || request.kind !== "CONFIRM" || request.assigneeTelegramId !== input.fromTelegramId || teamAdminOnlyRequest(request)) return { handled: true };
    const r = await respondToRequest(deps, request, m[2]!, { userId: null, via: "TELEGRAM" });
    await audit("boss.repondre_demande", "HumanRequest", request.id, { key: request.key, ok: r.ok });
    if (!r.ok) return { handled: true, toast: r.message.slice(0, 190), removeButtons: true };
    return { handled: true, toast: m[2] === "oui" ? "C'est fait ✅" : "D'accord", reply: r.message, removeButtons: true };
  }
  return { handled: false };
}

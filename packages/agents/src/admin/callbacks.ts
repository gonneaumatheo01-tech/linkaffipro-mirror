/**
 * Boutons des aperçus de validation (`agv:<id>:ok|edit|no`) et des questions CONFIRM à bouton (`agh:<id>:oui|non`,
 * phase 22 : « Créer le thème <x> »). Seul l'identifiant admin (`Setting`
 * `admin.telegramUserId`) est écouté : toute autre personne est ignorée en silence (règle de CLAUDE.md).
 */
import type { AgentsDeps } from "../types";
import { decideValidation } from "../validation/requests";
import { REQUEST_CALLBACK_PREFIX } from "../human/requests";
import { respondToRequest, type HumanRequestRow } from "../human/respond";
import { adminTelegramId, telegramActorUserId } from "./journal";

export type AgentsCallbackResult = {
  /** Le bouton est un bouton des agents (sinon : laisser aux autres handlers). */
  handled: boolean;
  /** Bulle courte affichée par Telegram (`answerCallbackQuery`). */
  toast?: string;
  /** Message envoyé dans la conversation. */
  reply?: string;
  /** Retirer les boutons de l'aperçu (décision prise). */
  removeButtons?: boolean;
  /**
   * « ✏️ Corriger » : identifiant de la validation dont `reply` est le message « envoie le nouveau texte ». Le bot
   * mémorise l'identifiant du message envoyé (`rememberEditPrompt`) : une réponse à ce message est la correction.
   */
  editPromptFor?: string;
};

const DATA = /^agv:([A-Za-z0-9_-]{1,40}):(ok|edit|no)$/;

export function parseValidationCallback(data: string): { validationId: string; action: "ok" | "edit" | "no" } | null {
  const m = DATA.exec(data);
  return m ? { validationId: m[1]!, action: m[2] as "ok" | "edit" | "no" } : null;
}

const REQUEST_DATA = /^agh:([A-Za-z0-9_-]{1,40}):(oui|non)$/;

/** Le bouton est-il un bouton des agents (aperçu de validation ou réponse à une demande) ? */
export function isAgentsCallbackData(data: string): boolean {
  return data.startsWith("agv:") || data.startsWith(REQUEST_CALLBACK_PREFIX);
}

/** « oui » / « non » en un clic sur une question CONFIRM : même effet que la réponse écrite. */
async function handleRequestCallback(deps: AgentsDeps, data: string): Promise<AgentsCallbackResult> {
  const m = REQUEST_DATA.exec(data);
  if (!m) return { handled: true, toast: "Bouton inconnu." };
  const request = (await deps.prisma.humanRequest.findUnique({ where: { id: m[1]! } })) as HumanRequestRow | null;
  if (!request || request.kind !== "CONFIRM")
    return { handled: true, toast: "Cette question n'existe plus.", removeButtons: true };
  const byUserId = await telegramActorUserId(deps);
  const r = await respondToRequest(deps, request, m[2]!, { userId: byUserId, via: "TELEGRAM" });
  if (!r.ok) return { handled: true, toast: r.message.slice(0, 190), removeButtons: true };
  return { handled: true, toast: m[2] === "oui" ? "C'est fait ✅" : "D'accord", reply: r.message, removeButtons: true };
}

export async function handleAgentsCallback(
  deps: AgentsDeps,
  input: { data: string; fromTelegramId: bigint | number },
): Promise<AgentsCallbackResult> {
  if (!isAgentsCallbackData(input.data)) return { handled: false };
  const parsed = parseValidationCallback(input.data);
  const admin = await adminTelegramId(deps);
  if (!admin || String(admin) !== String(input.fromTelegramId)) return { handled: true };
  if (input.data.startsWith(REQUEST_CALLBACK_PREFIX)) return handleRequestCallback(deps, input.data);
  if (!parsed) return { handled: true, toast: "Bouton inconnu." };
  const byUserId = await telegramActorUserId(deps);
  const decision = parsed.action === "ok" ? "approve" : parsed.action === "edit" ? "edit" : "reject";
  const r = await decideValidation(deps, { validationId: parsed.validationId, decision, via: "TELEGRAM", byUserId });
  if (!r.ok) return { handled: true, toast: r.message.slice(0, 190), removeButtons: true };
  return {
    handled: true,
    toast: decision === "approve" ? "Validé ✅" : decision === "reject" ? "Refusé ❌" : "Envoie le nouveau texte ✏️",
    reply: r.message,
    // « Corriger » garde les boutons : l'admin peut encore publier ou refuser sans corriger.
    removeButtons: decision !== "edit",
    ...(decision === "edit" ? { editPromptFor: parsed.validationId } : {}),
  };
}

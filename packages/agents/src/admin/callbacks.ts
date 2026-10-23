/**
 * Boutons des aperçus de validation (`agv:<id>:ok|edit|no`). Seul l'identifiant admin (`Setting`
 * `admin.telegramUserId`) est écouté : toute autre personne est ignorée en silence (règle de CLAUDE.md).
 */
import type { AgentsDeps } from "../types";
import { decideValidation } from "../validation/requests";
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
};

const DATA = /^agv:([A-Za-z0-9_-]{1,40}):(ok|edit|no)$/;

export function parseValidationCallback(data: string): { validationId: string; action: "ok" | "edit" | "no" } | null {
  const m = DATA.exec(data);
  return m ? { validationId: m[1]!, action: m[2] as "ok" | "edit" | "no" } : null;
}

export async function handleAgentsCallback(
  deps: AgentsDeps,
  input: { data: string; fromTelegramId: bigint | number },
): Promise<AgentsCallbackResult> {
  if (!input.data.startsWith("agv:")) return { handled: false };
  const parsed = parseValidationCallback(input.data);
  const admin = await adminTelegramId(deps);
  if (!admin || String(admin) !== String(input.fromTelegramId)) return { handled: true };
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
  };
}

/**
 * Masquage d'un secret dans une update AVANT sa journalisation (`Event`) : clé collée par l'admin (« clé fal … »,
 * « bookmaker … », « jeton boss … » et tout jeton de bot (phase 26), filet « voici la clé … <mot de 16 caractères ou plus> », réponse au message de N'IMPORTE QUELLE
 * demande SECRET, même close, ou texte qui ressemble à une clé pendant une demande SECRET en cours). Mêmes règles que
 * `handleAdminText` : les messages ordinaires de l'admin (« fait », « Parfait! ») restent journalisés tels quels,
 * `pnpm tg:inbox` les lit dans `Event`.
 */
import { isSecretAdminText, isSecretCommandText, looksLikeBotToken } from "@linkaffipro/agents";
import type { AgentsAdminState } from "../ports";
import type { Message, Update } from "grammy/types";
import type { TelegramDeps } from "../ports";

export const SECRET_REDACTED_TEXT = "[secret retiré]";

function privateText(update: Update): { key: "message" | "edited_message"; msg: Message } | null {
  for (const key of ["message", "edited_message"] as const) {
    const msg = update[key];
    if (msg && msg.chat.type === "private" && typeof msg.text === "string" && msg.from && !msg.from.is_bot)
      return { key, msg };
  }
  return null;
}

/** Contexte de `isSecretAdminText` tiré de l'état lu (ancienne forme : seulement `secretPending`). */
export function secretContextOf(state: AgentsAdminState, replyToMessageId?: number | null) {
  return {
    pending: state.pendingSecret ?? (state.secretPending ? { key: "", telegramMessageId: null } : null),
    replyToMessageId: replyToMessageId ?? null,
    secretMessageIds: state.secretMessageIds ?? [],
  };
}

/** Copie de l'update sans le texte secret (même update si rien n'est à masquer). Ne lève jamais. */
export async function redactAdminSecretUpdate(
  update: Update,
  deps: Pick<TelegramDeps, "agentsAdminState">,
): Promise<Update> {
  const found = privateText(update);
  if (!found) return update;
  const { key, msg } = found;
  // Phase 26 : « jeton boss <valeur> » et tout jeton de bot collé (même transféré) ne sont jamais journalisés.
  let secret = isSecretCommandText(msg.text!) || looksLikeBotToken(msg.text!);
  if (!secret && deps.agentsAdminState) {
    try {
      const state = await deps.agentsAdminState(BigInt(msg.from!.id));
      secret = state.isAdmin && isSecretAdminText(msg.text!, secretContextOf(state, msg.reply_to_message?.message_id));
    } catch (err) {
      console.warn("[telegram] état des demandes non lu", (err as Error).message);
    }
  }
  if (!secret) return update;
  const { entities: _entities, ...rest } = msg;
  return { ...update, [key]: { ...rest, text: SECRET_REDACTED_TEXT } } as Update;
}

/**
 * Masquage d'un secret dans une update AVANT sa journalisation (`Event`) : clé collée par l'admin (« clé fal … »,
 * « bookmaker … », ou réponse à une demande SECRET en cours). Les autres messages de l'admin restent journalisés tels
 * quels : `pnpm tg:inbox` les lit dans `Event`.
 */
import { isSecretAdminText, isSecretCommandText } from "@linkaffipro/agents";
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

/** Copie de l'update sans le texte secret (même update si rien n'est à masquer). Ne lève jamais. */
export async function redactAdminSecretUpdate(
  update: Update,
  deps: Pick<TelegramDeps, "agentsAdminState">,
): Promise<Update> {
  const found = privateText(update);
  if (!found) return update;
  const { key, msg } = found;
  let secret = isSecretCommandText(msg.text!);
  if (!secret && deps.agentsAdminState) {
    try {
      const state = await deps.agentsAdminState(BigInt(msg.from!.id));
      secret = state.isAdmin && isSecretAdminText(msg.text!, state.secretPending);
    } catch (err) {
      console.warn("[telegram] état des demandes non lu", (err as Error).message);
    }
  }
  if (!secret) return update;
  const { entities: _entities, ...rest } = msg;
  return { ...update, [key]: { ...rest, text: SECRET_REDACTED_TEXT } } as Update;
}

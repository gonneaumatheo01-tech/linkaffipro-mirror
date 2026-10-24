/**
 * Masquage d'un secret dans une update AVANT sa journalisation (`Event`), dans le texte OU la légende d'un média : clé collée par l'admin (« clé fal … »,
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

/** Message privé d'une personne (texte OU légende d'un média), nouveau ou modifié. */
function privateText(update: Update): { key: "message" | "edited_message"; msg: Message; content: string } | null {
  for (const key of ["message", "edited_message"] as const) {
    const msg = update[key];
    if (!msg || msg.chat.type !== "private" || !msg.from || msg.from.is_bot) continue;
    const content = typeof msg.text === "string" ? msg.text : typeof msg.caption === "string" ? msg.caption : null;
    if (content !== null) return { key, msg, content };
  }
  return null;
}

/** Copie du message sans son texte ni sa légende (ni leurs mises en forme). */
function redactedMessage(msg: Message): Message {
  const { entities: _e, caption_entities: _ce, text, caption, ...rest } = msg;
  return {
    ...rest,
    ...(typeof text === "string" ? { text: SECRET_REDACTED_TEXT } : {}),
    ...(typeof caption === "string" ? { caption: SECRET_REDACTED_TEXT } : {}),
  } as Message;
}

/** Contexte de `isSecretAdminText` tiré de l'état lu (ancienne forme : seulement `secretPending`). */
export function secretContextOf(
  state: AgentsAdminState,
  replyToMessageId?: number | null,
  opts: { withRetired?: boolean } = {},
) {
  return {
    pending: state.pendingSecret ?? (state.secretPending ? { key: "", telegramMessageId: null } : null),
    replyToMessageId: replyToMessageId ?? null,
    secretMessageIds: [...(state.secretMessageIds ?? []), ...(opts.withRetired ? (state.retiredSecretMessageIds ?? []) : [])],
  };
}

/**
 * Copie de l'update sans le texte (ou la légende) secret (même update si rien n'est à masquer). Ne lève jamais.
 * Détecteur partagé `isSecretAdminText` (`@linkaffipro/agents`, chemin rapide du Boss) pour l'admin : clés nues, mot de
 * passe même court pendant une demande SECRET, réponse à une question SECRET (y compris celles posées par ce bot avant
 * la bascule vers Kevin). Toute autre personne : commandes de clé et jetons de bot seulement.
 */
export async function redactAdminSecretUpdate(
  update: Update,
  deps: Pick<TelegramDeps, "agentsAdminState">,
): Promise<Update> {
  const found = privateText(update);
  if (!found) return update;
  const { key, msg, content } = found;
  // Phase 26 : « jeton boss <valeur> » et tout jeton de bot collé (même transféré) ne sont jamais journalisés.
  let secret = isSecretCommandText(content) || looksLikeBotToken(content);
  if (!secret && deps.agentsAdminState) {
    try {
      const state = await deps.agentsAdminState(BigInt(msg.from!.id));
      secret =
        state.isAdmin &&
        isSecretAdminText(content, secretContextOf(state, msg.reply_to_message?.message_id, { withRetired: true }));
    } catch (err) {
      console.warn("[telegram] état des demandes non lu", (err as Error).message);
      // Doute : le détecteur sans contexte (masquer de trop ne coûte rien).
      secret = isSecretAdminText(content, null);
    }
  }
  if (!secret) return update;
  return { ...update, [key]: redactedMessage(msg) } as Update;
}

export const GROUP_TEXT_REDACTED = (n: number) => `[message de groupe : ${n} caractères]`;

/**
 * Phase 26, section 4 — journal du Boss (`Event`) : un message du GROUPE n'y garde JAMAIS son texte (ni légende, ni
 * entités) : les conversations de l'équipe ne quittent pas la conversation (ce que Kevin en retient est dans
 * `BossTurn`, secrets en « [secret] »). En privé : les mêmes règles que le dialogue admin, appliquées à TOUTE personne
 * (un membre présenté qui envoie sa clé à Kevin est masqué comme l'admin). Ne lève jamais.
 */
export async function redactBossUpdate(update: Update, deps: Pick<TelegramDeps, "agentsAdminState">): Promise<Update> {
  for (const key of ["message", "edited_message"] as const) {
    const msg = update[key];
    if (!msg || (msg.chat.type !== "group" && msg.chat.type !== "supergroup")) continue;
    const { entities: _e, caption_entities: _ce, text, caption, ...rest } = msg;
    const kept: Record<string, unknown> = { ...rest };
    if (typeof text === "string") kept.text = GROUP_TEXT_REDACTED(text.length);
    if (typeof caption === "string") kept.caption = GROUP_TEXT_REDACTED(caption.length);
    // Message auquel il répond : texte retiré aussi.
    if (rest.reply_to_message) {
      const { text: rt, caption: rc, entities: _re, caption_entities: _rce, ...r } = rest.reply_to_message;
      kept.reply_to_message = { ...r, ...(typeof rt === "string" ? { text: GROUP_TEXT_REDACTED(rt.length) } : {}), ...(typeof rc === "string" ? { caption: GROUP_TEXT_REDACTED(rc.length) } : {}) };
    }
    return { ...update, [key]: kept } as Update;
  }
  const found = privateText(update);
  if (!found) return update;
  const { key, msg, content } = found;
  let secret = isSecretCommandText(content) || looksLikeBotToken(content) || isSecretAdminText(content, null);
  if (!secret && deps.agentsAdminState) {
    try {
      const state = await deps.agentsAdminState(BigInt(msg.from!.id));
      secret = isSecretAdminText(content, secretContextOf(state, msg.reply_to_message?.message_id));
    } catch (err) {
      console.warn("[telegram] état des demandes non lu", (err as Error).message);
    }
  }
  // Un long mot qui ressemble à une clé envoyé en privé au Boss (membre qui répond à sa demande) : masqué aussi.
  if (!secret) secret = content.split(/\s+/).some((w) => w.length >= 20 && /\p{L}/u.test(w) && /\d/.test(w) && !/^https?:\/\//i.test(w));
  if (!secret) return update;
  return { ...update, [key]: redactedMessage(msg) } as Update;
}

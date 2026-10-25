/**
 * Phase 26 : envoi d'une réponse du Boss dans la conversation où le message de l'admin est arrivé (webhook et tâche
 * `boss-text` du worker, même code). Ordre : suppression du message de l'admin s'il contenait un secret, réponse (HTML,
 * repli en texte brut, découpée au-delà de 4 000 caractères, boutons sur le dernier morceau, en réponse au message
 * d'origine), mémorisation du message de confirmation (`pendingId`), puis `followUp` (question suivante).
 * Textes fixes : aucune réponse ne reste vide (règle « toujours une réponse »).
 */
import { pick, type AdminButton, type BossDeps, type BossReply, type VoiceTable } from "@linkaffipro/agents";
import type { InlineKeyboardMarkup } from "grammy/types";
import { splitMessage } from "../admin-chat";
import type { BossEngine } from "./engine";

/**
 * Phase 33 : textes fixes de Kevin (charte `docs/KEVIN-VOIX.md`), 2 à 4 variantes chacun, choisies par `pick` (jamais
 * deux fois de suite la même dans une conversation). Les constantes exportées valent la première variante.
 */
export const BOSS_REPLY_VARIANTS = {
  /** Le worker n'a pas pu être joint : les commandes simples marchent quand même. */
  queueDown: [
    "Je n'arrive pas à réfléchir pour le moment, mon service d'arrière-plan est arrêté. Les commandes simples marchent quand même : écris aide.",
    "Ma partie réflexion est en panne pour l'instant. Les commandes simples marchent toujours, écris aide pour les voir.",
    "Je ne peux pas réfléchir là, le service d'arrière-plan est à l'arrêt. Écris aide : les commandes simples passent.",
  ],
  /** Erreur pendant le traitement : jamais de silence. */
  error: [
    "Oups, je n'ai pas pu traiter ce message. Réessaie dans un instant, ou écris aide.",
    "Ça a coincé de mon côté sur ce message. Tu réessaies dans un instant ? Sinon écris aide.",
    "Raté, ton message n'est pas passé chez moi. Renvoie-le dans un instant, ou écris aide.",
  ],
  /** Réponse vide du moteur (ne devrait pas arriver) : l'admin sait au moins que le message est arrivé. */
  empty: ["C'est noté.", "Noté.", "Bien noté."],
  /** Message autre qu'un texte ou un vocal (photo sans mot-clé, autocollant…). */
  otherMessage: [
    "Bien reçu. Pour ranger un média dans la médiathèque, renvoie-le avec des mots-clés en légende, par exemple #casino #roulette. Sinon écris-moi, envoie un vocal ou écris aide.",
    "Reçu. Si c'est pour la médiathèque, renvoie-le avec des mots-clés en légende (par exemple #casino #roulette). Pour le reste, écris-moi ou envoie un vocal, ou tape aide.",
    "Je ne sais pas quoi en faire tel quel. Pour la médiathèque, remets-le avec des mots-clés en légende, comme #casino #roulette. Sinon écris-moi, envoie un vocal ou tape aide.",
  ],
  /** Vocal trop long. */
  voiceTooLong: [
    "Vocal trop long pour moi : 2 minutes au plus. Tu m'en refais un plus court, ou tu me l'écris ?",
    "Ton vocal est trop long, je m'arrête à 2 minutes. Refais-le plus court ou écris-le-moi.",
    "Trop long, ce vocal : 2 minutes au plus. Un plus court, ou par écrit ?",
  ],
  /** Vocal impossible à mettre en file. */
  voiceQueueDown: [
    "Je n'arrive pas à écouter ce vocal pour le moment, mon service d'arrière-plan est arrêté. Écris-le-moi : les commandes simples marchent.",
    "Impossible d'écouter ton vocal là, ma partie réflexion est en panne. Tu me l'écris ? Les commandes simples passent.",
  ],
} as const satisfies VoiceTable;

/** Le worker n'a pas pu être joint : les commandes simples marchent quand même. */
export const BOSS_QUEUE_DOWN_REPLY = BOSS_REPLY_VARIANTS.queueDown[0];
/** Erreur pendant le traitement : jamais de silence. */
export const BOSS_ERROR_REPLY = BOSS_REPLY_VARIANTS.error[0];
/** Réponse vide du moteur (ne devrait pas arriver) : l'admin sait au moins que le message est arrivé. */
export const BOSS_EMPTY_REPLY = BOSS_REPLY_VARIANTS.empty[0];
/** Message autre qu'un texte ou un vocal (photo sans mot-clé, autocollant…). */
export const BOSS_OTHER_MESSAGE_REPLY = BOSS_REPLY_VARIANTS.otherMessage[0];
/** Vocal trop long. */
export const BOSS_VOICE_TOO_LONG_REPLY = BOSS_REPLY_VARIANTS.voiceTooLong[0];
/** Vocal impossible à mettre en file. */
export const BOSS_VOICE_QUEUE_DOWN_REPLY = BOSS_REPLY_VARIANTS.voiceQueueDown[0];

/** Une variante d'un texte de secours de Kevin pour cette conversation (rotation sans répétition). */
export function bossReplyText(key: keyof typeof BOSS_REPLY_VARIANTS, chatId: number | bigint | null): string {
  return pick(BOSS_REPLY_VARIANTS[key], `reply.${key}`, chatId);
}

type SendOther = {
  parse_mode?: "HTML";
  reply_markup?: InlineKeyboardMarkup;
  reply_parameters?: { message_id: number; allow_sending_without_reply: boolean };
  link_preview_options?: { is_disabled: boolean };
};

/** Sous-ensemble de l'API grammY utilisé (faux Telegram dans les tests). */
export type BossReplyApi = {
  sendMessage(chatId: number, text: string, other?: SendOther): Promise<{ message_id: number }>;
  deleteMessage(chatId: number, messageId: number): Promise<unknown>;
};

export function bossKeyboard(buttons?: AdminButton[][]): InlineKeyboardMarkup | undefined {
  if (!buttons?.length) return undefined;
  return { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.callbackData }))) };
}

/** Repli en texte brut quand Telegram refuse le HTML. */
function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

function isParseError(err: unknown): boolean {
  const text = String((err as { description?: string })?.description ?? (err as Error)?.message ?? "");
  return /parse entities|can't parse/i.test(text);
}

/** Envoie un texte HTML (repli brut), découpé ; boutons sur le dernier morceau ; rend l'identifiant du dernier message. */
export async function sendBossText(
  api: BossReplyApi,
  chatId: number,
  html: string,
  opts: { replyToMessageId?: number | null; buttons?: AdminButton[][] } = {},
): Promise<number | null> {
  const parts = splitMessage(html);
  if (parts.length === 0) parts.push(bossReplyText("empty", chatId));
  const reply_markup = bossKeyboard(opts.buttons);
  let last: number | null = null;
  for (let i = 0; i < parts.length; i++) {
    const isLast = i === parts.length - 1;
    const base: SendOther = {
      link_preview_options: { is_disabled: true },
      ...(isLast && reply_markup ? { reply_markup } : {}),
      ...(i === 0 && opts.replyToMessageId
        ? { reply_parameters: { message_id: opts.replyToMessageId, allow_sending_without_reply: true } }
        : {}),
    };
    let sent: { message_id: number };
    try {
      sent = await api.sendMessage(chatId, parts[i]!, { ...base, parse_mode: "HTML" });
    } catch (err) {
      if (!isParseError(err)) throw err;
      sent = await api.sendMessage(chatId, plain(parts[i]!), base);
    }
    last = sent?.message_id ?? null;
  }
  return last;
}

export type DeliverBossReplyInput = {
  api: BossReplyApi;
  chatId: number;
  /** Message de l'admin (réponse en « Répondre » à celui-ci, suppression s'il contenait un secret). */
  messageId: number;
  reply: BossReply;
  deps: BossDeps;
  engine: Pick<BossEngine, "rememberPendingMessage">;
  log?: (msg: string, err: unknown) => void;
};

/** Envoie la réponse du Boss (voir l'en-tête). Rend l'identifiant du message envoyé. */
export async function deliverBossReply(input: DeliverBossReplyInput): Promise<number | null> {
  const { api, chatId, messageId, reply, deps, engine } = input;
  const log = input.log ?? ((msg, err) => console.error(msg, (err as Error)?.message ?? err));
  if (reply.deleteMessage) await api.deleteMessage(chatId, messageId).catch(() => undefined);
  const text = reply.reply?.trim() ? reply.reply : bossReplyText("empty", chatId);
  // Un message supprimé (secret) ne peut plus servir de « Répondre ».
  const sentId = await sendBossText(api, chatId, text, {
    replyToMessageId: reply.deleteMessage ? null : messageId,
    buttons: reply.buttons,
  });
  if (reply.pendingId && sentId) {
    await engine
      .rememberPendingMessage(deps, reply.pendingId, sentId)
      .catch((err) => log("[boss] message de confirmation non mémorisé", err));
  }
  if (reply.followUp) await reply.followUp().catch((err) => log("[boss] suite non envoyée", err));
  return sentId;
}

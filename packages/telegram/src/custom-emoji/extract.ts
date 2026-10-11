/**
 * Emojis animés d'un message envoyé au bot (phase 12, ajout à la bibliothèque de l'équipe) : règles pures, testées
 * sans base ni Telegram.
 *
 * Telegram décrit chaque emoji animé d'un texte (ou d'une légende) par une entité `custom_emoji` : `offset` et `length`
 * en unités UTF-16 (exactement l'indexation des chaînes JavaScript) et `custom_emoji_id`. La portion de texte couverte
 * est l'emoji standard de remplacement (Telegram exige qu'elle soit exactement cet emoji).
 */
import { isValidCustomEmojiId } from "@linkaffipro/core";
import type { Message, MessageEntity } from "grammy/types";

/** Un emoji animé lu dans un message : identifiant Telegram et emoji de remplacement. */
export type ExtractedCustomEmoji = { customEmojiId: string; fallback: string };

/** Garde-fou : un message Telegram en porte au plus une centaine ; au-delà, on s'arrête. */
export const MAX_CUSTOM_EMOJIS_PER_MESSAGE = 200;

type MessageLike = Pick<Message, "text" | "caption" | "entities" | "caption_entities">;

/**
 * Emojis animés d'un message (texte et légende), sans doublon, dans l'ordre d'apparition. Un identifiant invalide est
 * ignoré ; un même emoji présent plusieurs fois n'est retenu qu'une fois (premier emoji de remplacement non vide).
 */
export function customEmojisOfMessage(msg: MessageLike): ExtractedCustomEmoji[] {
  const found = new Map<string, string>();
  const parts: Array<[string | undefined, MessageEntity[] | undefined]> = [
    [msg.text, msg.entities],
    [msg.caption, msg.caption_entities],
  ];
  for (const [text, entities] of parts) {
    if (!text || !entities) continue;
    for (const e of entities) {
      if (e.type !== "custom_emoji") continue;
      const id = String(e.custom_emoji_id ?? "");
      if (!isValidCustomEmojiId(id)) continue;
      const fallback = text.slice(e.offset, e.offset + e.length).trim();
      const known = found.get(id);
      if (known === undefined) {
        if (found.size >= MAX_CUSTOM_EMOJIS_PER_MESSAGE) break;
        found.set(id, fallback);
      } else if (!known && fallback) found.set(id, fallback);
    }
  }
  return [...found].map(([customEmojiId, fallback]) => ({ customEmojiId, fallback }));
}

/** Le message contient-il au moins un emoji animé (texte ou légende) ? */
export function messageHasCustomEmoji(msg: MessageLike): boolean {
  return [...(msg.entities ?? []), ...(msg.caption_entities ?? [])].some(
    (e) => e.type === "custom_emoji",
  );
}

/** Résultat de l'ajout à la bibliothèque (identifiants Telegram). */
export type CustomEmojiAddOutcome = {
  /** Nouveaux emojis enregistrés. */
  added: string[];
  /** Emojis retirés de la bibliothèque qui y reviennent. */
  restored: string[];
  /** Emojis déjà présents (visibles). */
  already: string[];
};

function plural(n: number, one: string, many: string): string {
  return n > 1 ? many : one;
}

/**
 * Réponse du bot en français (les utilisateurs de la plateforme sont l'équipe) : « 6 emojis animés ajoutés ✅ », puis
 * « 2 déjà dans la bibliothèque » s'il y en a. Null s'il n'y avait aucun emoji animé.
 */
export function customEmojiAddedReply(o: CustomEmojiAddOutcome): string | null {
  const n = o.added.length + o.restored.length;
  const k = o.already.length;
  if (n + k === 0) return null;
  const where = `${plural(n + k, "Retrouvez-le", "Retrouvez-les")} sur le site : Messages → Emojis animés.`;
  if (n === 0) {
    const head =
      k === 1
        ? "Cet emoji animé est déjà dans la bibliothèque ✅"
        : `Ces ${k} emojis animés sont déjà dans la bibliothèque ✅`;
    return `${head}\n\n${where}`;
  }
  const head = `${n} ${plural(n, "emoji animé ajouté", "emojis animés ajoutés")} ✅`;
  const already = k > 0 ? `\n${k} déjà dans la bibliothèque` : "";
  return `${head}${already}\n\n${where}`;
}

/**
 * Ajout à la réponse quand le message transféré vient d'un canal qui n'est pas sur la plateforme et dont aucun de nos
 * bots n'est administrateur (le canal de quelqu'un d'autre, le plus souvent) : seuls les emojis sont ajoutés.
 */
export function customEmojiChannelSkippedNote(botUsername: string): string {
  return `Le canal d'origine n'a pas été ajouté à la plateforme. Si c'est l'un de vos canaux : nommez @${botUsername} administrateur, puis transférez-moi de nouveau un de ses messages.`;
}

/** Réponse quand l'enregistrement échoue (base indisponible) : l'équipe peut renvoyer le message. */
export const CUSTOM_EMOJI_ADD_FAILED_REPLY =
  "Impossible d'ajouter ces emojis animés pour le moment. Renvoyez-moi le message dans une minute.";

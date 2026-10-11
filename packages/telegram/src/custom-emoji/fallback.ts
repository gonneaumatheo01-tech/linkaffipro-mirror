/**
 * Repli des emojis animés dans les messages privés du bot (phase 12) : partagé par le worker (file telegram-send,
 * `sending/send-dm.ts`) et les réponses directes du bot dans le webhook (offre, « ✅ J'ai rejoint »).
 *
 * Depuis le Bot API 9.4, un bot peut envoyer des emojis animés en privé si son propriétaire a Telegram Premium. Si ce
 * n'est plus le cas (Premium expiré, emoji retiré par son auteur), Telegram peut :
 * - refuser le message : erreur 400 de mise en forme ou d'entité (« can't parse entities… », « ENTITY_… »,
 *   « DOCUMENT_INVALID ») ou PREMIUM_ACCOUNT_REQUIRED ; on renvoie alors aussitôt le même message avec les emojis de
 *   remplacement (`withFallbackEmojis`) ;
 * - l'accepter en retirant les emojis animés (le membre voit les emojis normaux) : on le détecte en comparant les
 *   entités `custom_emoji` du message envoyé au nombre de balises du texte, sans renvoi (ce serait un doublon).
 * Dans les deux cas, l'appelant journalise `dm.custom_emoji_fallback` (et l'alerte `custom_emoji_refused` suit).
 */
import { CUSTOM_EMOJI_TAG_RE, hasCustomEmoji, withFallbackEmojis } from "@linkaffipro/core";

/** Erreur Telegram (GrammyError ou forme équivalente) : code et description. */
function telegramErrorOf(err: unknown): { code: number; description: string } | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { error_code?: unknown; description?: unknown };
  if (typeof e.error_code !== "number" || typeof e.description !== "string") return null;
  return { code: e.error_code, description: e.description };
}

/** Refus 400 lié à la mise en forme ou aux entités (dont les emojis animés). */
const REFUSAL_400_RE =
  /parse entities|entit(?:y|ies)|custom[ _-]?emoji|emoji|EMOTICON|STICKER|DOCUMENT_INVALID|PREMIUM/i;
/** Refus 403 lié à l'abonnement Premium (jamais « bot was blocked by the user », qui reste un blocage). */
const REFUSAL_403_RE = /PREMIUM_ACCOUNT_REQUIRED|premium/i;

/**
 * Telegram a-t-il refusé ce texte à cause de ses emojis animés ? Oui si le texte contient au moins une balise
 * `tg-emoji` et que l'erreur est un 400 de mise en forme ou d'entité, ou un refus « Premium requis ». Une vraie erreur
 * de mise en forme sans rapport échouera de nouveau au renvoi (et sera alors signalée comme un échec normal).
 */
export function isCustomEmojiRefusal(err: unknown, text: string | null | undefined): boolean {
  if (!hasCustomEmoji(text)) return false;
  const e = telegramErrorOf(err);
  if (!e) return false;
  if (e.code === 400) return REFUSAL_400_RE.test(e.description);
  if (e.code === 403) return REFUSAL_403_RE.test(e.description);
  return false;
}

/** Nombre de balises d'emoji animé du texte (occurrences, doublons compris). */
export function customEmojiTagCount(html: string | null | undefined): number {
  if (!html) return 0;
  return [...html.matchAll(CUSTOM_EMOJI_TAG_RE)].length;
}

/**
 * Telegram a-t-il accepté le message en retirant ses emojis animés ? Comparaison des entités `custom_emoji` du message
 * renvoyé par Telegram au nombre de balises envoyées. Faux si la réponse n'est pas un message (rien à comparer).
 */
export function customEmojisDropped(html: string | null | undefined, sent: unknown): boolean {
  const expected = customEmojiTagCount(html);
  if (expected === 0 || !sent || typeof sent !== "object") return false;
  const m = sent as {
    text?: unknown;
    caption?: unknown;
    entities?: Array<{ type?: string }>;
    caption_entities?: Array<{ type?: string }>;
  };
  if (typeof m.text !== "string" && typeof m.caption !== "string") return false;
  const got = [...(m.entities ?? []), ...(m.caption_entities ?? [])].filter(
    (e) => e?.type === "custom_emoji",
  ).length;
  return got < expected;
}

/** Texte de l'erreur quand Telegram a retiré les emojis animés sans refuser le message. */
export const CUSTOM_EMOJIS_DROPPED_ERROR =
  "Telegram a affiché les emojis normaux à la place des emojis animés.";

/** Ce qui s'est passé : `resent` = message refusé puis renvoyé avec les emojis de remplacement. */
export type CustomEmojiFallbackInfo = { error: string; resent: boolean };

/**
 * Envoie un texte HTML qui peut contenir des emojis animés : refus de Telegram à cause d'eux → renvoi immédiat du même
 * message avec les emojis de remplacement ; emojis retirés par Telegram → simple signalement. `onFallback` n'est appelé
 * qu'une fois le message réellement parti (un renvoi qui échoue remonte son erreur, sans signalement) ; ses erreurs
 * sont ignorées (journalisation jamais bloquante).
 */
export async function sendWithEmojiFallback<T>(
  text: string,
  send: (text: string) => Promise<T>,
  onFallback?: (info: CustomEmojiFallbackInfo) => unknown,
): Promise<T> {
  const report = async (info: CustomEmojiFallbackInfo) => {
    try {
      await onFallback?.(info);
    } catch (err) {
      console.warn("[custom-emoji] repli non journalisé", (err as Error).message);
    }
  };
  let sent: T;
  try {
    sent = await send(text);
  } catch (err) {
    if (!isCustomEmojiRefusal(err, text)) throw err;
    const resent = await send(withFallbackEmojis(text));
    await report({ error: telegramErrorOf(err)?.description ?? String(err), resent: true });
    return resent;
  }
  if (customEmojisDropped(text, sent))
    await report({ error: CUSTOM_EMOJIS_DROPPED_ERROR, resent: false });
  return sent;
}

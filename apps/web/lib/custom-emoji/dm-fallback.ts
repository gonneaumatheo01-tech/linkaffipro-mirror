/**
 * Messages privés partis avec les emojis normaux à la place des emojis animés (phase 12, D8). Quand Telegram refuse
 * les emojis animés d'un message privé (ou les retire), le service d'arrière-plan l'envoie quand même et écrit une note
 * sur le message (`OutboundMessage.error`, statut SENT ; apps/worker/src/sending/send-dm.ts, `customEmojiFallbackNote`) :
 * « Envoyé avec les emojis normaux : Telegram a refusé les emojis animés. » ou « Telegram a affiché les emojis normaux à
 * la place des emojis animés. ». Ces règles la retrouvent pour la fiche d'un envoi à un groupe (la fiche d'un membre
 * montre la note telle quelle dans son historique).
 */
import type { Prisma } from "@linkaffipro/db";
import { fmtNum } from "@/lib/format";

/** Mots communs aux deux notes du service d'arrière-plan. */
export const EMOJI_FALLBACK_NOTE_MARK = "emojis normaux";

/** La note d'un message (`OutboundMessage.error`) dit-elle qu'il est parti avec les emojis normaux ? */
export function isEmojiFallbackNote(error: string | null | undefined): boolean {
  return !!error && error.includes(EMOJI_FALLBACK_NOTE_MARK);
}

/** Messages partis de cet envoi à un groupe avec les emojis normaux. */
export function emojiFallbackWhere(broadcastId: string): Prisma.OutboundMessageWhereInput {
  return { broadcastId, status: "SENT", error: { contains: EMOJI_FALLBACK_NOTE_MARK } };
}

/** Phrase de la fiche d'un envoi à un groupe (null s'il n'y en a aucun). */
export function emojiFallbackSentence(count: number): string | null {
  if (count <= 0) return null;
  const head =
    count > 1 ? `${fmtNum(count)} messages sont partis` : `${fmtNum(count)} message est parti`;
  return `${head} avec les emojis normaux à la place des emojis animés : Telegram les a refusés. Vérifiez que le compte Telegram propriétaire des bots a toujours Telegram Premium.`;
}

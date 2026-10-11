import { customEmojiIdsOf } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";

/**
 * Note l'utilisation des emojis animés d'un ou plusieurs textes enregistrés (D14, phase 12) : `useCount` + 1 et
 * `lastUsedAt` = maintenant pour chaque emoji de la bibliothèque présent (une fois par emoji et par appel, même s'il
 * revient plusieurs fois ou dans plusieurs textes : version A et B, traductions…). Les emojis inconnus de la
 * bibliothèque sont ignorés. Alimente « Récents de l'équipe » dans le sélecteur de l'éditeur.
 *
 * À appeler par chaque action qui enregistre un texte de message (message de canal, modèle, messages du bot, relance,
 * écrire à un groupe), après l'enregistrement. Ne lève jamais : un échec ne doit pas faire échouer l'enregistrement.
 * Renvoie le nombre d'emojis de la bibliothèque mis à jour.
 */
export async function markCustomEmojisUsed(
  ...texts: ReadonlyArray<string | null | undefined | ReadonlyArray<string | null | undefined>>
): Promise<number> {
  const ids = new Set<string>();
  for (const t of texts.flat()) if (t) for (const id of customEmojiIdsOf(t)) ids.add(id);
  if (ids.size === 0) return 0;
  try {
    const res = await prisma.customEmoji.updateMany({
      where: { customEmojiId: { in: [...ids] } },
      data: { useCount: { increment: 1 }, lastUsedAt: new Date() },
    });
    return res.count;
  } catch (err) {
    console.error("[custom-emoji] utilisation non enregistrée", err);
    return 0;
  }
}

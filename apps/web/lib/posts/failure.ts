/**
 * Message en échec : que faire, d'après la raison donnée par Telegram (`Post.lastError`, phrases de
 * `apps/worker/src/sending/errors.ts`). Fonction pure, testée : la fiche du message affiche la raison, une phrase
 * d'action et le bon lien (le canal pour les droits du bot, « Modifier » pour le texte, les médias ou les boutons).
 */
export type FailureFix = {
  /**
   * « canal » : droits du bot ou accès au canal ; « compte » : compte Telegram connecté (message avec emojis animés,
   * phase 12) ; « message » : contenu refusé ; « autre » : cause inconnue.
   */
  kind: "channel" | "account" | "message" | "other";
  /** Ce qu'il faut faire, en une phrase. */
  hint: string;
};

const CHANNEL =
  /administrateur|droit|accès|introuvable|bloqué le bot|n'existe plus|forbidden|rights|kicked/i;
const MESSAGE = /texte|légende|mise en forme|html|média|bouton|url|trop long/i;
/** Phrases du worker pour un message publié par le compte connecté (apps/worker/src/sending/send-post-account.ts). */
const ACCOUNT = /compte (telegram )?connecté|telegram premium|connexions → telegram/i;

/** Publication interrompue : une partie du message est déjà dans un canal (send-post-account.ts, send-post.ts). */
const PARTIAL = /déjà (été )?publiée/i;

export function failureFix(lastError: string | null | undefined): FailureFix {
  const reason = (lastError ?? "").trim();
  if (PARTIAL.test(reason))
    return {
      kind: "message",
      hint: "Dupliquez ce message et programmez la copie (elle partira en entier) ; supprimez dans Telegram la partie déjà publiée.",
    };
  if (ACCOUNT.test(reason))
    return {
      kind: "account",
      hint: "Vérifiez le compte Telegram connecté (Réglages → Connexions → Telegram) : connecté, avec Telegram Premium, administrateur du canal avec le droit de publier. Reprogrammez ensuite le message.",
    };
  if (CHANNEL.test(reason))
    return {
      kind: "channel",
      hint: "Rendez au bot ses droits d'administrateur dans le canal Telegram, puis « Re-vérifier les droits des bots » sur la page du canal. Reprogrammez ensuite le message.",
    };
  if (MESSAGE.test(reason))
    return {
      kind: "message",
      hint: "Corrigez le message (« Modifier »), puis programmez-le à nouveau.",
    };
  return {
    kind: "other",
    hint: "Vérifiez le bot sur la page du canal, puis modifiez et reprogrammez le message.",
  };
}

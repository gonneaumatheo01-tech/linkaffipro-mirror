/**
 * Message en échec : que faire, d'après la raison donnée par Telegram (`Post.lastError`, phrases de
 * `apps/worker/src/sending/errors.ts`). Fonction pure, testée : la fiche du message affiche la raison, une phrase
 * d'action et le bon lien (le canal pour les droits du bot, « Modifier » pour le texte, les médias ou les boutons).
 */
export type FailureFix = {
  /** « canal » : droits du bot ou accès au canal ; « message » : contenu refusé ; « autre » : cause inconnue. */
  kind: "channel" | "message" | "other";
  /** Ce qu'il faut faire, en une phrase. */
  hint: string;
};

const CHANNEL =
  /administrateur|droit|accès|introuvable|bloqué le bot|n'existe plus|forbidden|rights|kicked/i;
const MESSAGE = /texte|légende|mise en forme|html|média|bouton|url|trop long/i;

export function failureFix(lastError: string | null | undefined): FailureFix {
  const reason = (lastError ?? "").trim();
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

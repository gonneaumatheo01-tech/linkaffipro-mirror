import { fillPlaceholders } from "@linkaffipro/core";

/**
 * Texte d'un message à un groupe pour UN destinataire : {prenom} → prénom du membre (vide s'il n'en a pas), {bot} → nom
 * du bot qui écrit (même mot que les relances automatiques). Valeurs échappées pour le HTML Telegram (un prénom « Tom <3 »
 * ne casse pas le message) ; tout autre mot entre accolades reste tel quel (l'éditeur du site le signale).
 */
export function personalizeBroadcastText(
  text: string,
  vars: { firstName: string | null | undefined; botName: string },
): string {
  return fillPlaceholders(text, { prenom: vars.firstName ?? "", bot: vars.botName });
}

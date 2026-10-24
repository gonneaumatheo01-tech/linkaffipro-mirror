/**
 * Phase 26 : filtres partagés des bots. Un bot `role: ADMIN` (le Boss, dialogue avec l'admin seulement) n'est JAMAIS
 * choisi pour un canal, un lien d'invitation, une séquence, un envoi, une page d'atterrissage, une relance, un compte
 * réel, ni mis en mode assistant : tout sélecteur de bot « de travail » passe par ces filtres. Un test de garde
 * (`packages/telegram/src/bot-selectors-guard.test.ts`) échoue si un nouveau `bot.find…` les oublie.
 */

/** Bot de canal (tout bot sauf le Boss). */
export const CHANNEL_BOT_WHERE = { role: "CHANNEL" as const };

/** Bot de canal actif, en mode normal (ni assistant de conversation, ni Boss). */
export const ACTIVE_CHANNEL_BOT_WHERE = {
  isActive: true,
  mode: "STANDARD" as const,
  role: "CHANNEL" as const,
};

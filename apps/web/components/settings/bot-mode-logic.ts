/**
 * Règles pures du formulaire « Mode » d'un bot (Réglages → Bots, `BotModeForm`), testées à part, partagées avec
 * l'enregistrement (`setBotModeAction`) : un bot qui gère des canaux ne peut pas devenir l'assistante, et faut-il
 * demander confirmation avant d'enregistrer ?
 *
 * Passer en « Assistant de conversation » un bot qui s'occupe de canaux lui retirerait tout le travail des canaux : il
 * n'accueillerait plus personne et ne validerait plus les demandes d'adhésion (les personnes resteraient dehors). C'est
 * donc refusé (formulaire ET serveur) : l'assistante doit avoir un bot à elle, créé exprès dans @BotFather.
 */

const canals = (n: number) => (n > 1 ? `${n.toLocaleString("fr-FR")} canaux` : "1 canal");

/**
 * Pourquoi ce bot ne peut pas devenir l'assistante (il administre `channelCount` canaux), ou null s'il le peut (aucun
 * canal, nombre inconnu, ou bot déjà assistant : changer sa persona reste possible).
 */
export function assistantModeRefusal(
  currentMode: string,
  channelCount?: number | null,
): string | null {
  if (currentMode === "ASSISTANT") return null;
  if (typeof channelCount !== "number" || channelCount <= 0) return null;
  return `Ce bot gère ${canals(channelCount)} : il ne peut pas devenir l'assistante. Créez un bot dédié dans @BotFather (voir le guide) et ajoutez-le ici.`;
}

/**
 * Phrase de confirmation, ou null si l'enregistrement peut partir sans question : seulement quand un bot normal, sans
 * canal, passe en assistant. `channelCount` : canaux que ce bot administre (au moins un : choix impossible, voir
 * `assistantModeRefusal` ; inconnu : la question rappelle de prendre un bot à part).
 */
export function botModeConfirmMessage(
  currentMode: string,
  nextMode: string,
  channelCount?: number | null,
): string | null {
  if (nextMode !== "ASSISTANT" || currentMode === "ASSISTANT") return null;
  if (assistantModeRefusal(currentMode, channelCount)) return null;
  if (channelCount === 0)
    return "Ce bot deviendra l'assistante : il discutera en privé avec les personnes qui lui écrivent et ne s'occupera d'aucun canal (ni accueil, ni demandes d'adhésion, ni messages de canal). Continuer ?";
  return "En assistant de conversation, ce bot ne s'occupera plus d'aucun canal : il n'accueillera plus personne et ne validera plus les demandes d'adhésion. Utilisez plutôt un nouveau bot créé exprès pour l'assistante (bouton « Ajouter un bot »). Continuer ?";
}

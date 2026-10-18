/**
 * Fiche canal (phase 17) : nos bots administrateurs existent, mais aucun ne peut agir pour le canal (accepter les
 * demandes, publier). Le conseil dépend de la raison : un bot normal désactivé se réactive dans Réglages → Bots ; un
 * assistant de conversation ne s'occupe que de ses conversations privées, il faut donc un autre de nos bots.
 */

export type AdminBotState = { username: string; isActive: boolean; mode: string };

export type ActingBotNotice = { title: string; sentences: string[] };

const list = (names: string[]) => names.map((n) => `@${n}`).join(", ");

/** Alerte à afficher, ou null si un bot normal et actif peut agir (ou s'il n'y a aucun bot : autre alerte). */
export function actingBotNotice(admins: readonly AdminBotState[]): ActingBotNotice | null {
  if (admins.length === 0) return null;
  if (admins.some((a) => a.isActive && a.mode === "STANDARD")) return null;
  const disabled = admins.filter((a) => a.mode === "STANDARD").map((a) => a.username);
  const assistants = admins.filter((a) => a.mode !== "STANDARD").map((a) => a.username);
  const sentences: string[] = [];
  if (disabled.length > 0)
    sentences.push(
      disabled.length > 1
        ? `${list(disabled)} sont désactivés : réactivez-en un dans Réglages → Bots.`
        : `${list(disabled)} est désactivé : réactivez-le dans Réglages → Bots.`,
    );
  if (assistants.length > 0)
    sentences.push(
      assistants.length > 1
        ? `${list(assistants)} sont des assistants de conversation : ils ne s'occupent que de leurs conversations privées.`
        : `${list(assistants)} est un assistant de conversation : il ne s'occupe que de ses conversations privées.`,
    );
  if (disabled.length === 0)
    sentences.push(
      "Dans Telegram, ajoutez un autre de nos bots comme administrateur avec le droit « Ajouter des membres », puis cliquez « Re-vérifier les droits des bots ».",
    );
  return { title: "Aucun bot de ce canal ne peut accepter les demandes", sentences };
}

/**
 * Nom affiché d'un lien traqué créé par « Écrire à un groupe » (fonctions pures, testées).
 * Les boutons d'un message à un groupe créent leur lien avec un repère en fin de nom, pour les reconnaître dans
 * Campagnes → Liens. Avant la phase 9, ce repère était « (envoi groupé) » : les liens déjà créés le gardent en base
 * (aucune donnée n'est réécrite), il est remplacé par le mot du client à l'affichage.
 */

/** Repère ajouté au nom d'un lien créé par un message à un groupe. */
export const GROUP_MESSAGE_LINK_SUFFIX = " (message à un groupe)";

/** Ancien repère, encore présent dans le nom des liens créés avant la phase 9. */
const LEGACY_SUFFIX = / \(envoi groupé\)$/;

/** Nom à afficher : l'ancien repère est remplacé par le nouveau ; le reste du nom ne change pas. */
export function linkLabel(label: string): string {
  return label.replace(LEGACY_SUFFIX, GROUP_MESSAGE_LINK_SUFFIX);
}

/** Nom sans le repère (dans la page d'un message à un groupe, où il est évident). */
export function withoutGroupMessageSuffix(label: string): string {
  const shown = linkLabel(label);
  return shown.endsWith(GROUP_MESSAGE_LINK_SUFFIX)
    ? shown.slice(0, -GROUP_MESSAGE_LINK_SUFFIX.length)
    : shown;
}

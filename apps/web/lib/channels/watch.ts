/**
 * Surveillance de la fenêtre « Ajouter un canal existant » (Canaux) : pendant 2 minutes, le dernier canal créé est relu
 * toutes les 5 secondes ; un nouveau canal donne un bandeau « Canal « X » détecté ✅ ».
 * Un canal ajouté depuis la fenêtre même (méthode 2, lien public) a déjà son propre bandeau : il n'est pas annoncé deux fois,
 * quel que soit l'ordre d'arrivée (réponse de l'action avant ou après le tour de surveillance).
 * Fonctions pures (testées) ; la fenêtre garde l'état dans une référence et en recopie `detected` pour l'affichage.
 */

export type DetectedChannel = { id: string; title: string };

export type WatchState = {
  /** Dernier canal connu (référence) : seul un canal différent est annoncé. */
  seen: string | null;
  /** Canaux ajoutés par la méthode 2 depuis l'ouverture : jamais annoncés par la surveillance. */
  acknowledged: string[];
  /** Bandeaux « détecté » à afficher. */
  detected: DetectedChannel[];
};

/** Ouverture (ou réouverture) de la fenêtre : tout repart de zéro, calé sur le dernier canal connu. */
export function watchOpen(latestId: string | null): WatchState {
  return { seen: latestId, acknowledged: [], detected: [] };
}

/** Un tour de surveillance. `changed` : le dernier canal a changé (la liste derrière la fenêtre doit être rafraîchie). */
export function watchPoll(
  state: WatchState,
  latest: DetectedChannel | null,
): { state: WatchState; changed: boolean } {
  if (!latest || latest.id === state.seen) return { state, changed: false };
  const detected = state.acknowledged.includes(latest.id)
    ? state.detected
    : [...state.detected, { id: latest.id, title: latest.title }];
  return { state: { ...state, seen: latest.id, detected }, changed: true };
}

/** Canal ajouté par la méthode 2 : son bandeau « ajouté ✅ » suffit, la surveillance ne l'annonce pas (ou plus). */
export function watchAdded(state: WatchState, channelId: string): WatchState {
  return {
    ...state,
    acknowledged: state.acknowledged.includes(channelId)
      ? state.acknowledged
      : [...state.acknowledged, channelId],
    detected: state.detected.filter((d) => d.id !== channelId),
  };
}

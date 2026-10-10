/**
 * Démarrage de la visite guidée depuis n'importe quel composant client (bouton « Revoir la visite guidée » du volet
 * d'aide) : un événement de fenêtre écouté par `GuidedTour`, monté une fois dans la coque de l'application.
 */
export const TOUR_START_EVENT = "linkaffi:tour-start";

export function requestTourStart(): void {
  window.dispatchEvent(new Event(TOUR_START_EVENT));
}

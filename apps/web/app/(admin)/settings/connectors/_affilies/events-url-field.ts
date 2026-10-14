/**
 * Valeur et clé du champ « Adresse où envoyer les événements des membres » (champ non contrôlé). React remet le
 * formulaire à zéro après chaque action : sans précaution, une saisie refusée disparaissait au profit de l'adresse
 * enregistrée, et un second clic enregistrait l'adresse d'origine. Après une erreur, le champ repart donc de la saisie
 * renvoyée par l'action (nouvelle clé à chaque essai) ; sinon, de l'adresse enregistrée sur le serveur.
 */
export type EventsUrlFieldState = {
  ok?: string;
  error?: string;
  /** Saisie refusée, renvoyée telle quelle pour rester dans le champ. */
  value?: string;
  /** Numéro de l'essai (une nouvelle clé à chaque envoi refusé). */
  attempt?: number;
} | null;

export function eventsUrlField(
  url: string,
  state: EventsUrlFieldState,
): { key: string; defaultValue: string } {
  if (state?.error && state.value !== undefined)
    return { key: `refused:${state.attempt ?? 0}`, defaultValue: state.value };
  return { key: `saved:${url}`, defaultValue: url };
}

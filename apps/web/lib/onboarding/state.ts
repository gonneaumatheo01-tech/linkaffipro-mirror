/**
 * État de la visite guidée et de la liste « À faire pour démarrer », par utilisateur (fonctions pures, testées).
 * Stocké dans `Setting` sous la clé `onboarding.<userId>` (pas de migration) :
 * `{ tourDoneAt: ISO | null, checklistDismissedAt: ISO | null }`.
 */

export const ONBOARDING_KEY_PREFIX = "onboarding.";

export function onboardingKey(userId: string): string {
  return `${ONBOARDING_KEY_PREFIX}${userId}`;
}

export type OnboardingState = {
  /** Visite guidée terminée ou passée (date ISO) ; null = à montrer. */
  tourDoneAt: string | null;
  /** Liste « À faire pour démarrer » masquée (date ISO) ; null = visible tant qu'elle n'est pas finie. */
  checklistDismissedAt: string | null;
};

export const EMPTY_ONBOARDING: OnboardingState = { tourDoneAt: null, checklistDismissedAt: null };

function isoOrNull(v: unknown): string | null {
  return typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null;
}

/** Lecture tolérante d'une valeur de `Setting` (absente, mal formée → état vide). */
export function parseOnboarding(value: unknown): OnboardingState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...EMPTY_ONBOARDING };
  const v = value as Record<string, unknown>;
  return {
    tourDoneAt: isoOrNull(v.tourDoneAt),
    checklistDismissedAt: isoOrNull(v.checklistDismissedAt),
  };
}

export function withTourDone(state: OnboardingState, now: Date): OnboardingState {
  return { ...state, tourDoneAt: state.tourDoneAt ?? now.toISOString() };
}

export function withChecklistDismissed(state: OnboardingState, now: Date): OnboardingState {
  return { ...state, checklistDismissedAt: state.checklistDismissedAt ?? now.toISOString() };
}

/** « Revoir la visite » : tout repart de zéro (visite montrée de nouveau, liste réaffichée si elle n'est pas finie). */
export function resetOnboarding(): OnboardingState {
  return { ...EMPTY_ONBOARDING };
}

/** La visite démarre seule tant qu'elle n'a été ni terminée ni passée. */
export function shouldStartTour(state: OnboardingState): boolean {
  return state.tourDoneAt === null;
}

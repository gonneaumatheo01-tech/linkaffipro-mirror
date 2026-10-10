"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(min-width: 768px)";

function subscribe(cb: () => void) {
  const m = window.matchMedia(QUERY);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}

/**
 * Vrai sur un écran d'ordinateur ou de tablette (768 px et plus). Faux côté serveur et avant l'hydratation : le
 * canevas n'est monté que dans le navigateur, sur un écran assez large (sur téléphone, aperçu en lecture seule).
 */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

"use client";

import { useSyncExternalStore } from "react";
import { isMacPlatform } from "./editor-logic";

const noopSubscribe = () => () => {};

/**
 * Mac (⌘) ou autre (Ctrl), pour écrire les raccourcis comme sur le clavier de la personne. « Autre » au rendu
 * serveur, corrigé après l'hydratation sans avertissement. Partagé par l'éditeur de texte et la liste des raccourcis.
 */
export function useIsMac(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => isMacPlatform(navigator.platform || navigator.userAgent),
    () => false,
  );
}

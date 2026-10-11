"use client";

import { useCallback, useEffect, useState } from "react";
import type { PickerEmoji } from "@/lib/custom-emoji/library";

/**
 * Bibliothèque des emojis animés côté navigateur (sélecteur de l'éditeur) : lue une fois par `GET /api/custom-emoji`,
 * gardée pour la page et relue si elle date de plus de 30 secondes à l'ouverture du sélecteur (un emoji ajouté par
 * un collègue arrive sans recharger la page).
 */
const STALE_MS = 30_000;
let state: { at: number; promise: Promise<PickerEmoji[]> } | null = null;
/** Dernière liste lue (affichée tout de suite à la réouverture du sélecteur, puis rafraîchie). */
let lastItems: PickerEmoji[] | null = null;

export function fetchCustomEmojiLibrary(force = false): Promise<PickerEmoji[]> {
  if (!force && state && Date.now() - state.at < STALE_MS) return state.promise;
  const promise = fetch("/api/custom-emoji", { credentials: "same-origin", cache: "no-store" })
    .then(async (res) => {
      if (!res.ok) throw new Error(`bibliothèque : ${res.status}`);
      const body = (await res.json()) as { items?: PickerEmoji[] };
      lastItems = Array.isArray(body.items) ? body.items : [];
      return lastItems;
    })
    .catch((err: unknown) => {
      state = null; // nouvel essai à la prochaine ouverture
      throw err;
    });
  state = { at: Date.now(), promise };
  return promise;
}

/** Oublie la bibliothèque gardée (après un ajout ou un retrait sur la page de la bibliothèque). */
export function invalidateCustomEmojiLibrary(): void {
  state = null;
  lastItems = null;
}

/** Bibliothèque pour un composant : `items` null tant qu'elle n'est pas lue. */
export function useCustomEmojiLibrary(): {
  items: PickerEmoji[] | null;
  error: boolean;
  reload: () => void;
} {
  const [items, setItems] = useState<PickerEmoji[] | null>(() => lastItems);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    fetchCustomEmojiLibrary(attempt > 0)
      .then((list) => {
        if (!alive) return;
        setItems(list);
        setError(false);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [attempt]);
  const reload = useCallback(() => {
    setError(false);
    setAttempt((n) => n + 1);
  }, []);
  return { items, error, reload };
}

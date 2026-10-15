"use client";

import { useEffect } from "react";

/** L'adresse vise-t-elle ce bloc (`#chiffres`) ? */
export function hashTargets(hash: string, id: string): boolean {
  return hash === `#${id}` || hash === `#${encodeURIComponent(id)}`;
}

/**
 * Ramène la page sur le bloc `id` quand l'adresse se termine par `#id` au chargement (après « Appliquer » de la période
 * des chiffres d'une page). Le navigateur ne le fait pas tout seul : le bloc arrive après l'ossature de la page
 * (chargement progressif), une fois le moment du saut passé. Ne rend rien.
 */
export function ScrollToHash({ id }: { id: string }) {
  useEffect(() => {
    if (!hashTargets(window.location.hash, id)) return;
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [id]);
  return null;
}

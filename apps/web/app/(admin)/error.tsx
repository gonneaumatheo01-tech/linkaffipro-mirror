"use client";

import { ErrorPage } from "@/components/admin/error-page";

/**
 * Erreur dans une page de l'espace connecté qui n'a pas sa propre page d'erreur (accueil, aide, styleguide…) :
 * phrase générale de ErrorPage (« Cette page n'a pas pu s'afficher. »).
 */
export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorPage {...props} />;
}

"use client";

import { ErrorPage } from "@/components/admin/error-page";

/** Erreur dans la section Membres : phrase simple et bouton « Réessayer », sans trace technique. */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorPage error={error} reset={reset} title="La page Membres n'a pas pu s'afficher." />;
}

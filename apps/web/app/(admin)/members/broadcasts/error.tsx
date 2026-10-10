"use client";

import { ErrorPage } from "@/components/admin/error-page";

/** Erreur dans « Écrire à un groupe » : phrase simple et bouton « Réessayer », sans trace technique. */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorPage
      error={error}
      reset={reset}
      title="La page « Écrire à un groupe » n'a pas pu s'afficher."
    />
  );
}

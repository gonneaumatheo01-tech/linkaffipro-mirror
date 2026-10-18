"use client";

import { ErrorPage } from "@/components/admin/error-page";

/** Erreur sur les chiffres des conversations : phrase simple et bouton « Réessayer », sans trace technique. */
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
      title="Les chiffres des conversations n'ont pas pu s'afficher."
    />
  );
}

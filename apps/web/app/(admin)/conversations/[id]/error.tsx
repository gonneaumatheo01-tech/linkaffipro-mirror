"use client";

import { ErrorPage } from "@/components/admin/error-page";

/** Erreur sur la fiche d'une conversation : phrase simple et bouton « Réessayer », sans trace technique. */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorPage error={error} reset={reset} title="Cette conversation n'a pas pu s'afficher." />
  );
}

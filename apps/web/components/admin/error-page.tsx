"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Contenu commun des `error.tsx` : phrase simple, bouton « Réessayer », jamais de trace technique à l'écran.
 * L'erreur est envoyée dans la console pour le diagnostic.
 */
export function ErrorPage({
  error,
  reset,
  title = "Cette page n'a pas pu s'afficher.",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto mt-10 max-w-md rounded-lg border p-6 text-center">
      <p className="text-base font-medium">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">
        Réessayez dans un instant. Si le problème continue, prévenez l&apos;administrateur en
        indiquant l&apos;heure et la page.
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <Button className="max-md:h-10" onClick={() => reset()}>
          Réessayer
        </Button>
        <Button className="max-md:h-10" variant="outline" render={<Link href="/" />}>
          Retour au tableau de bord
        </Button>
      </div>
    </div>
  );
}

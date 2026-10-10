"use client";

import { useEffect } from "react";
import Link from "next/link";
import { SearchX, TriangleAlert } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";

/**
 * Contenu commun des `error.tsx` : carte blanche, icône d'alerte, phrase simple, bouton principal « Réessayer »,
 * jamais de trace technique à l'écran. L'erreur est envoyée dans la console pour le diagnostic.
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
    <div
      role="alert"
      className="mx-auto mt-10 max-w-md rounded-xl border border-border bg-card p-6 text-center"
    >
      <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-danger-soft text-danger">
        <TriangleAlert aria-hidden className="size-6" />
      </span>
      <h1 className="text-title text-foreground">{title}</h1>
      <p className="mt-2 text-body text-muted-foreground">
        Réessayez dans un instant. Si le problème continue, prévenez l&apos;administrateur en
        indiquant l&apos;heure et la page.
      </p>
      <div className="mt-5 flex flex-col-reverse justify-center gap-2 sm:flex-row">
        <Link href="/" className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}>
          Retour à l&apos;accueil
        </Link>
        <Button className="max-md:h-10" onClick={() => reset()}>
          Réessayer
        </Button>
      </div>
    </div>
  );
}

/** Titre de l'onglet de la page introuvable (même gabarit que `metadata.title` dans app/layout.tsx). */
export const NOT_FOUND_DOCUMENT_TITLE = "Page introuvable · LinkAffi Pro";

/** Phrase d'aide de la page introuvable dans l'espace connecté (la recherche est dans l'en-tête). */
export const NOT_FOUND_HINT =
  "Le lien est peut-être ancien, ou l'élément a été supprimé. Utilisez la recherche en haut de la page pour le retrouver.";

/**
 * Page introuvable (lien ancien, élément supprimé) : même carte que ErrorPage, un seul bouton principal.
 * Rendue par app/(admin)/not-found.tsx (dans la coque) et par app/not-found.tsx (écran de marque, hors session :
 * `hint` sans la recherche, `className` pour retirer la marge du haut).
 */
export function NotFoundPage({
  title = "Cette page n'existe pas ou n'existe plus.",
  hint = NOT_FOUND_HINT,
  backHref = "/",
  backLabel = "Retour à l'accueil",
  className,
}: {
  title?: string;
  hint?: string;
  backHref?: string;
  backLabel?: string;
  className?: string;
}) {
  // Dans une fiche, `notFound()` arrive après le début de l'envoi de la page : le titre de l'onglet est déjà celui
  // de la fiche (« Campagne »…). On le remplace pour que l'onglet dise aussi que la page est introuvable.
  useEffect(() => {
    document.title = NOT_FOUND_DOCUMENT_TITLE;
  }, []);
  return (
    <div
      className={cn(
        "mx-auto mt-10 max-w-md rounded-xl border border-border bg-card p-6 text-center",
        className,
      )}
    >
      <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <SearchX aria-hidden className="size-6" />
      </span>
      <h1 className="text-title text-foreground">{title}</h1>
      <p className="mt-2 text-body text-muted-foreground">{hint}</p>
      <div className="mt-5 flex justify-center">
        <Link href={backHref} className={cn(buttonVariants(), "max-md:h-10")}>
          {backLabel}
        </Link>
      </div>
    </div>
  );
}

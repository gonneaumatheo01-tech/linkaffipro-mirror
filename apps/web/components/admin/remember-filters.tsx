"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_KEEP_PARAMS,
  cleanParams,
  hasActiveFilters,
  resetHref,
  shouldRestore,
} from "./remember-filters-logic";

const PREFIX = "lap:filters:";

/**
 * Mémorise les filtres d'une liste dans `localStorage` (clé par page) :
 * - URL sans filtre mais mémoire présente → redirection vers l'URL mémorisée ;
 * - sinon, les filtres courants sont mémorisés.
 * Le bouton « Effacer les filtres » vide la mémoire et revient à l'URL sans filtre, en gardant la vue choisie
 * (`keepParams`, par défaut `view` et `tab` : Liste / Calendrier / Modèles, onglet d'une fiche). Il n'apparaît que
 * s'il y a quelque chose à effacer (`hasActiveFilters`) : aucune page n'a à le cacher elle-même.
 * À monter dans la page de liste (dans un `<Suspense>`), avec `storageKey` unique (ex. "members"). `label` : autre
 * texte du bouton (la mémorisation reste dite au survol).
 */
export function RememberFilters({
  storageKey,
  className,
  keepParams = DEFAULT_KEEP_PARAMS,
  label = "Effacer les filtres",
}: {
  storageKey: string;
  className?: string;
  keepParams?: readonly string[];
  label?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const key = PREFIX + storageKey;

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(key);
    } catch {
      return;
    }
    if (shouldRestore(searchParams, stored)) {
      router.replace(`${pathname}?${stored}`);
      return;
    }
    const current = cleanParams(searchParams);
    try {
      if (current) window.localStorage.setItem(key, current);
      else window.localStorage.removeItem(key);
    } catch {
      /* stockage indisponible : rien à mémoriser */
    }
  }, [key, pathname, router, searchParams]);

  if (!hasActiveFilters(searchParams, keepParams)) return null;

  const reset = () => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignoré */
    }
    router.push(resetHref(pathname, searchParams, keepParams));
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className={className}
      onClick={reset}
      title="Les filtres sont mémorisés sur cet appareil"
    >
      {label}
    </Button>
  );
}

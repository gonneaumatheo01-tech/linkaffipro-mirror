"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

const PREFIX = "lap:filters:";
/** Paramètres qui ne sont pas des filtres (messages de retour, pagination). */
const IGNORED = new Set(["ok", "error", "page"]);

function cleanParams(sp: URLSearchParams): string {
  const p = new URLSearchParams();
  for (const [k, v] of sp.entries()) if (!IGNORED.has(k) && v !== "") p.append(k, v);
  return p.toString();
}

/**
 * Mémorise les filtres d'une liste dans `localStorage` (clé par page) :
 * - URL sans filtre mais mémoire présente → redirection vers l'URL mémorisée ;
 * - sinon, les filtres courants sont mémorisés.
 * Le bouton « Réinitialiser » vide la mémoire et revient à l'URL sans filtre, en gardant la vue choisie
 * (`keepParams`, par défaut `view` et `tab` : Liste / Calendrier / Modèles, onglet d'une fiche).
 * À monter dans la page de liste, avec `storageKey` unique (ex. "members"). `label` : texte du bouton à la place de
 * « Réinitialiser (filtres mémorisés) » (la mémorisation reste dite au survol).
 */
export function RememberFilters({
  storageKey,
  className,
  keepParams = ["view", "tab"],
  label,
}: {
  storageKey: string;
  className?: string;
  keepParams?: string[];
  label?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const key = PREFIX + storageKey;
  const remembered = [...searchParams.keys()].some((k) => !IGNORED.has(k));

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(key);
    } catch {
      return;
    }
    const current = cleanParams(new URLSearchParams(searchParams.toString()));
    const hasAnyParam = [...searchParams.keys()].some((k) => !IGNORED.has(k));
    if (!hasAnyParam && stored) {
      router.replace(`${pathname}?${stored}`);
      return;
    }
    try {
      if (current) window.localStorage.setItem(key, current);
      else window.localStorage.removeItem(key);
    } catch {
      /* stockage indisponible : rien à mémoriser */
    }
  }, [key, pathname, router, searchParams]);

  const reset = () => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignoré */
    }
    const kept = new URLSearchParams();
    for (const name of keepParams) {
      const v = searchParams.get(name);
      if (v) kept.set(name, v);
    }
    const q = kept.toString();
    router.push(q ? `${pathname}?${q}` : pathname);
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className={className}
      onClick={reset}
      title={remembered ? "Les filtres sont mémorisés sur cet appareil" : undefined}
    >
      {label ?? `Réinitialiser${remembered ? " (filtres mémorisés)" : ""}`}
    </Button>
  );
}

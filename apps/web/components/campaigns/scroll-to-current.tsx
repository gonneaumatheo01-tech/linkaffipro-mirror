"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/components/ui/cn";
import { centeredScrollLeft } from "./scroll-to-current-logic";

/**
 * Liste horizontale qui défile (onglets sur téléphone) : à l'affichage et à chaque changement d'élément courant
 * (`currentKey`), l'élément marqué `aria-current` est ramené au centre de la liste. Seule la liste défile, jamais la
 * page. Sans JavaScript, la liste reste une simple liste défilante.
 */
export function ScrollToCurrent({
  currentKey,
  className,
  children,
}: {
  /** Clé de l'élément courant : l'effet se rejoue quand elle change (navigation entre onglets). */
  currentKey: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const list = ref.current;
    const current = list?.querySelector<HTMLElement>("[aria-current]");
    if (!list || !current) return;
    const l = list.getBoundingClientRect();
    const c = current.getBoundingClientRect();
    const left = centeredScrollLeft(
      {
        left: l.left,
        width: list.clientWidth,
        scrollLeft: list.scrollLeft,
        scrollWidth: list.scrollWidth,
      },
      { left: c.left, width: c.width },
    );
    if (left !== list.scrollLeft) list.scrollTo({ left });
  }, [currentKey]);
  return (
    <ul ref={ref} className={cn(className)}>
      {children}
    </ul>
  );
}

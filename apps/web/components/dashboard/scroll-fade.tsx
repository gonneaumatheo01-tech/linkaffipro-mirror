"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/components/ui/cn";
import {
  NO_SCROLL,
  horizontalScrollState,
  sameScrollState,
  type ScrollState,
} from "@/components/ui/table-logic";

/**
 * Rangée qui défile (onglets des Statistiques sur téléphone) : un dégradé sur le bord montre qu'il reste des onglets
 * à voir, tant qu'il en reste (même règle que `Table`, `horizontalScrollState`). Le premier enfant est la zone qui
 * défile (`overflow-x-auto`). Sans JavaScript, ou quand tout tient, aucun dégradé. `fadeClassName` : couleur du fond
 * sur lequel la rangée est posée (fond de page par défaut).
 */
export function ScrollFade({
  children,
  className,
  fadeClassName = "from-background",
}: {
  children: React.ReactNode;
  className?: string;
  fadeClassName?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState<ScrollState>(NO_SCROLL);

  useEffect(() => {
    const el = ref.current?.firstElementChild;
    if (!(el instanceof HTMLElement)) return;
    const update = () => {
      const next = horizontalScrollState(el);
      setScroll((prev) => (sameScrollState(prev, next) ? prev : next));
    };
    update();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    ro?.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      ro?.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, []);

  const fade = cn(
    "pointer-events-none absolute top-0 bottom-px w-10 to-transparent transition-opacity duration-150 motion-reduce:transition-none",
    fadeClassName,
  );
  return (
    <div ref={ref} className={cn("relative", className)}>
      {children}
      <div
        aria-hidden
        className={cn(
          fade,
          "left-0 bg-linear-to-r",
          scroll.overflowing && !scroll.atStart ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        aria-hidden
        className={cn(
          fade,
          "right-0 bg-linear-to-l",
          scroll.overflowing && !scroll.atEnd ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

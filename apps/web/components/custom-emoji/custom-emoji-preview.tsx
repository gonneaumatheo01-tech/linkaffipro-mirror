"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { mountEmojiMedia } from "./emoji-media";

const SIZES = {
  sm: "size-5 text-base",
  md: "size-7 text-[1.375rem]",
  tile: "size-9 text-[1.75rem]",
  lg: "size-16 text-[3rem]",
} as const;

/**
 * Aperçu d'un emoji animé (sélecteur, bibliothèque) : l'emoji de remplacement d'abord, puis l'animation dès qu'elle
 * est chargée (à la demande, près de l'écran ; lue seulement quand elle est visible ; image fixe si l'utilisateur a
 * demandé moins de mouvement). Décoratif : l'élément qui le contient porte le nom lu par les lecteurs d'écran.
 * `hasPreview` faux : aucun chargement, l'emoji de remplacement reste.
 */
export function CustomEmojiPreview({
  id,
  fallback,
  hasPreview = true,
  size = "md",
  className,
}: {
  id: string;
  fallback: string;
  hasPreview?: boolean;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const mediaRef = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const el = mediaRef.current;
    if (!el || !hasPreview) return;
    const handle = mountEmojiMedia(el, id, { onReady: () => setReady(true) });
    return () => {
      handle.destroy();
      setReady(false);
    };
  }, [id, hasPreview]);
  return (
    <span
      aria-hidden
      data-slot="custom-emoji-preview"
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center leading-none select-none",
        SIZES[size],
        className,
      )}
    >
      <span className={cn(ready && "opacity-0")}>{fallback}</span>
      <span
        ref={mediaRef}
        className="absolute inset-0 [&>canvas]:size-full [&>img]:size-full [&>img]:object-contain [&>video]:size-full [&>video]:object-contain"
      />
    </span>
  );
}

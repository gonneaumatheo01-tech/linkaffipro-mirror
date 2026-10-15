"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";

/**
 * « Copier le lien » d'une page d'atterrissage (rubrique « Pages », phase 15) : copie l'adresse à coller dans la pub,
 * annonce « Copié » (lecteurs d'écran compris). Désactivé tant que le lien Telegram de la source n'est pas prêt
 * (`disabledReason` au survol et lu avec le bouton). Dans une ligne cliquable de tableau, le clic ne l'ouvre pas.
 */
export function CopyLinkButton({
  url,
  label = "Copier le lien",
  disabledReason,
  size = "sm",
  compact = false,
  className,
}: {
  url: string;
  label?: string;
  /** Lien pas encore prêt : bouton désactivé, raison au survol. */
  disabledReason?: string | null;
  size?: "sm" | "default";
  /** Sur téléphone, l'icône seule (le libellé reste lu par les lecteurs d'écran) : pour une colonne de tableau. */
  compact?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const disabled = !!disabledReason;
  return (
    <Button
      type="button"
      size={size}
      variant="outline"
      disabled={disabled}
      title={disabledReason ?? url}
      aria-label={disabled ? `${label} : ${disabledReason}` : `${label} : ${url}`}
      className={cn("max-md:h-10", className)}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Presse-papiers refusé (navigateur ancien, page non sécurisée) : l'adresse reste affichée à côté.
          window.prompt("Adresse à copier", url);
        }
      }}
    >
      {copied ? (
        <Check aria-hidden className="size-4 text-success" />
      ) : (
        <Copy aria-hidden className="size-4" />
      )}
      <span aria-live="polite" className={compact ? "max-md:sr-only" : undefined}>
        {copied ? "Copié" : label}
      </span>
    </Button>
  );
}

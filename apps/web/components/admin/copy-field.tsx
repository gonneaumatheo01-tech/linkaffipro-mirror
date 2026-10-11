"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Champ en lecture seule avec un bouton « Copier » (lien, adresse, identifiant de suivi).
 * - `label` : nom du champ pour les lecteurs d'écran (« Adresse à copier » par défaut) ;
 * - `id` : pour relier un libellé visible, `<Label htmlFor="…">` ; le libellé visible nomme alors le champ.
 */
export function CopyField({
  value,
  label = "Adresse à copier",
  id,
}: {
  value: string;
  label?: string;
  id?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        readOnly
        value={value}
        aria-label={id ? undefined : label}
        className="font-mono md:text-note"
        onFocus={(e) => e.currentTarget.select()}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="max-md:h-10"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* le champ reste sélectionnable à la main */
          }
        }}
      >
        {copied ? (
          <Check aria-hidden className="size-4 text-success" />
        ) : (
          <Copy aria-hidden className="size-4" />
        )}
        <span aria-live="polite">{copied ? "Copié" : "Copier"}</span>
      </Button>
    </div>
  );
}

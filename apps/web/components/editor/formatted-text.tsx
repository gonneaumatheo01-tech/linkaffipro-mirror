"use client";

import "./rich-text.css";
import { useMemo } from "react";
import { cn } from "@/components/ui/cn";
import { KNOWN_PLACEHOLDERS } from "./editor-logic";
import { markPlaceholders, telegramToEditorHtml } from "./telegram-format";

/**
 * Texte en HTML Telegram affiché mis en forme, en lecture seule (propositions de l'assistant IA, récapitulatifs) :
 * jamais de balise visible. Le HTML est réécrit depuis la liste blanche avant d'être affiché (sûr à injecter) ;
 * les repères {prenom}… sont en évidence.
 */
export function FormattedText({ html, className }: { html: string; className?: string }) {
  const display = useMemo(
    () => markPlaceholders(telegramToEditorHtml(html, { fragment: true }), KNOWN_PLACEHOLDERS),
    [html],
  );
  return (
    <div
      data-slot="formatted-text"
      className={cn("lap-rich text-body text-foreground", className)}
      dangerouslySetInnerHTML={{ __html: display }}
    />
  );
}

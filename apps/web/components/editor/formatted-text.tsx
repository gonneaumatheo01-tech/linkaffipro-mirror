"use client";

import "./rich-text.css";
import { useMemo, useRef } from "react";
import { cn } from "@/components/ui/cn";
import { useCustomEmojiChips } from "@/components/custom-emoji/emoji-chips";
import { KNOWN_PLACEHOLDERS } from "./editor-logic";
import { markPlaceholders, telegramToEditorHtml } from "./telegram-format";

/**
 * Texte en HTML Telegram affiché mis en forme, en lecture seule (propositions de l'assistant IA, récapitulatifs) :
 * jamais de balise visible. Le HTML est réécrit depuis la liste blanche avant d'être affiché (sûr à injecter) ;
 * les repères {prenom}… sont en évidence ; les emojis animés sont animés (ou leur emoji de remplacement).
 */
export function FormattedText({ html, className }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const display = useMemo(
    () => markPlaceholders(telegramToEditorHtml(html, { fragment: true }), KNOWN_PLACEHOLDERS),
    [html],
  );
  useCustomEmojiChips(ref, display);
  return (
    <div
      ref={ref}
      data-slot="formatted-text"
      className={cn("lap-rich text-body text-foreground", className)}
      dangerouslySetInnerHTML={{ __html: display }}
    />
  );
}

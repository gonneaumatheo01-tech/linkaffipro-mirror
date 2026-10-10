import type { ComponentProps } from "react";
import { TelegramPreview } from "@/components/messages/telegram-preview";
import { cn } from "@/components/ui/cn";

/**
 * Aperçu d'un message déjà enregistré (fiche d'un envoi, page du test A/B) : le compteur de caractères de
 * `TelegramPreview` ne sert qu'en saisie, il est masqué ici (c'est le seul élément `tabular-nums` de l'aperçu).
 * À remplacer par une option de `TelegramPreview` quand elle existera.
 */
export function ReadOnlyPreview({ className, ...props }: ComponentProps<typeof TelegramPreview>) {
  return <TelegramPreview {...props} className={cn("[&_.tabular-nums]:hidden", className)} />;
}

import type { ComponentProps } from "react";
import { TelegramPreview } from "@/components/messages/telegram-preview";

/**
 * Aperçu d'un message déjà enregistré (fiche d'un envoi, page du test A/B) : sans le compteur de caractères de
 * `TelegramPreview`, qui ne sert qu'en saisie.
 */
export function ReadOnlyPreview(props: ComponentProps<typeof TelegramPreview>) {
  return <TelegramPreview counter={false} {...props} />;
}

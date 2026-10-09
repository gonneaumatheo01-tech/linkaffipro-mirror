"use client";

import { Button } from "@/components/ui/button";

type ButtonProps = React.ComponentProps<typeof Button>;

/**
 * Bouton de soumission qui demande confirmation avant d'envoyer le formulaire parent.
 * `message` doit dire ce qui va se passer (« Le message sera supprimé du canal Telegram. Continuer ? »).
 * Accepte toutes les props de `Button` (variant, size, formAction, disabled…).
 */
export function ConfirmSubmit({
  message,
  children,
  onClick,
  ...props
}: ButtonProps & { message: string }) {
  return (
    <Button
      type="submit"
      {...props}
      onClick={(e) => {
        if (!window.confirm(message)) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
    >
      {children}
    </Button>
  );
}

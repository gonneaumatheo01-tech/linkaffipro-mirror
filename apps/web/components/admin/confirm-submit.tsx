"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "./confirm-dialog";
import { confirmSubmitDefaults, submitFromOpener } from "./confirm-logic";

type ButtonProps = React.ComponentProps<typeof Button>;
type ClickEvent = Parameters<NonNullable<ButtonProps["onClick"]>>[0];

/**
 * Bouton de soumission qui demande confirmation (boîte `ConfirmDialog`) avant d'envoyer le formulaire parent.
 * `message` doit dire ce qui va se passer (« Le message sera supprimé du canal Telegram. Continuer ? »).
 * Accepte toutes les props de `Button` (variant, size, name, value, formAction, disabled…) ; à la confirmation,
 * le formulaire est soumis avec ce bouton. Facultatif : `confirmTitle` (par défaut « <libellé du bouton> ? »),
 * `confirmLabel` (par défaut le libellé du bouton), `destructive` (par défaut : variante `destructive` ou
 * texte rouge). `onClick` est appelé après la confirmation, juste avant l'envoi.
 */
export function ConfirmSubmit({
  message,
  confirmTitle,
  confirmLabel,
  destructive,
  children,
  onClick,
  ...props
}: ButtonProps & {
  message: string;
  /** Titre de la boîte de confirmation (`title` reste l'infobulle HTML du bouton). */
  confirmTitle?: string;
  confirmLabel?: string;
  destructive?: boolean;
}) {
  const lastClick = useRef<ClickEvent | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const d = confirmSubmitDefaults({
    children,
    confirmTitle,
    confirmLabel,
    destructive,
    variant: props.variant,
    className: props.className,
  });

  return (
    <ConfirmDialog
      title={d.title}
      description={message}
      confirmLabel={d.confirmLabel}
      destructive={d.destructive}
      onConfirm={
        onClick
          ? () => {
              if (lastClick.current) onClick(lastClick.current);
              submitFromOpener(buttonRef.current);
            }
          : undefined
      }
      trigger={
        <Button
          type="submit"
          {...props}
          ref={buttonRef}
          onClickCapture={(e) => {
            lastClick.current = e as ClickEvent;
          }}
        >
          {children}
        </Button>
      }
    />
  );
}

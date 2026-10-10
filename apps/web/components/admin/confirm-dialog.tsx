"use client";

import { cloneElement, useEffect, useRef, useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { confirmTriggerAria, submitFromOpener } from "./confirm-logic";

type TriggerProps = {
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
  "aria-haspopup"?: React.AriaAttributes["aria-haspopup"];
  "aria-expanded"?: React.AriaAttributes["aria-expanded"];
};

/**
 * Boîte de confirmation (Base UI AlertDialog) : un titre, une phrase qui dit ce qui va se passer,
 * « Annuler » (focus par défaut) et le bouton de confirmation, rouge si l'action est destructive.
 * Échap ou « Annuler » ferment sans rien faire. Le déclencheur annonce la boîte (`aria-haspopup="dialog"`,
 * `aria-expanded`) ; un double clic sur « Confirmer » n'envoie qu'une fois.
 *
 * Deux usages :
 * - avec un formulaire d'action serveur : `trigger` est le bouton de soumission
 *   (`<Button type="submit" name="intent" value="delete">Supprimer</Button>`) ; à la confirmation,
 *   le formulaire parent est soumis avec ce bouton (son `name`/`value` et son `formAction` sont conservés) ;
 * - avec `onConfirm` : la fonction est appelée (le bouton attend la fin si elle renvoie une promesse).
 * Contrôlé : `open` + `onOpenChange` (sans `trigger`).
 */
export function ConfirmDialog({
  trigger,
  open: openProp,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  destructive = false,
  onConfirm,
}: {
  trigger?: React.ReactElement<TriggerProps>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: React.ReactNode;
  cancelLabel?: React.ReactNode;
  destructive?: boolean;
  onConfirm?: () => void | Promise<void>;
}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const [pending, setPending] = useState(false);
  // Élément qui a ouvert la boîte : le focus y revient, et c'est lui qui soumet le formulaire.
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  // Une confirmation par ouverture : un double clic sur « Confirmer » n'envoie pas deux fois le formulaire.
  const confirmed = useRef(false);
  const open = openProp ?? innerOpen;
  useEffect(() => {
    if (open) confirmed.current = false;
  }, [open]);
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setInnerOpen(next);
    onOpenChange?.(next);
  };

  const triggerEl = trigger
    ? cloneElement(trigger, {
        ...confirmTriggerAria(trigger.props, open),
        onClick: (e: React.MouseEvent<HTMLElement>) => {
          trigger.props.onClick?.(e);
          // Le clic ne soumet pas le formulaire : il ouvre la confirmation.
          e.preventDefault();
          setOpener(e.currentTarget);
          setOpen(true);
        },
      })
    : null;

  async function confirm() {
    if (confirmed.current) return;
    confirmed.current = true;
    if (onConfirm) {
      setPending(true);
      try {
        await onConfirm();
      } finally {
        setPending(false);
        setOpen(false);
      }
      return;
    }
    setOpen(false);
    submitFromOpener(opener);
  }

  return (
    <>
      {triggerEl}
      <AlertDialog.Root open={open} onOpenChange={(next) => setOpen(next)}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-night/40 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
          <AlertDialog.Popup
            data-slot="confirm-dialog"
            finalFocus={trigger ? () => opener ?? true : undefined}
            className="fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border border-border bg-popover p-5 text-body text-popover-foreground shadow-lg outline-none transition-[opacity,scale] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 sm:max-w-md"
          >
            <div className="space-y-1.5">
              <AlertDialog.Title className="text-title text-foreground">{title}</AlertDialog.Title>
              {description ? (
                <AlertDialog.Description className="text-body text-muted-foreground">
                  {description}
                </AlertDialog.Description>
              ) : null}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <AlertDialog.Close render={<Button variant="outline" className="max-md:h-10" />}>
                {cancelLabel}
              </AlertDialog.Close>
              <Button
                type="button"
                variant={destructive ? "danger" : "default"}
                className={cn("max-md:h-10")}
                disabled={pending}
                onClick={() => void confirm()}
              >
                {pending ? "Un instant…" : confirmLabel}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}

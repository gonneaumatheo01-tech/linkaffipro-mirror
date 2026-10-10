"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";

const WIDTHS = {
  sm: "md:max-w-sm",
  md: "md:max-w-md",
  lg: "md:max-w-lg",
  xl: "md:max-w-2xl",
} as const;

/**
 * Volet latéral de détail (à droite sur ordinateur, plein écran sur téléphone), construit sur le Dialog
 * de Base UI : titre relié, fermeture par Échap, par la croix « Fermer » ou par un clic à côté,
 * focus piégé dans le volet puis rendu à l'élément qui l'a ouvert.
 * - contrôlé : `open` + `onOpenChange` ; non contrôlé : `trigger` (élément qui ouvre le volet) ;
 * - `footer` : actions en bas du volet (un bouton principal au plus).
 */
export function SidePanel({
  open,
  onOpenChange,
  defaultOpen,
  trigger,
  title,
  description,
  children,
  footer,
  size = "md",
  className,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  /** Élément qui ouvre le volet (ex. `<Button variant="outline">Voir</Button>`), en mode non contrôlé. */
  trigger?: React.ReactElement;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: keyof typeof WIDTHS;
  className?: string;
}) {
  return (
    <DialogPrimitive.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange ? (next) => onOpenChange(next) : undefined}
    >
      {trigger ? <DialogPrimitive.Trigger render={trigger} /> : null}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-night/30 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <DialogPrimitive.Popup
          data-slot="side-panel"
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex h-dvh w-full flex-col border-l border-border bg-surface text-body text-foreground shadow-xl outline-none transition-transform duration-200 ease-out data-ending-style:translate-x-full data-starting-style:translate-x-full",
            WIDTHS[size],
            className,
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-4 md:px-6">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-title text-foreground">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1 text-body text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Fermer"
                  className="-mr-1 shrink-0"
                />
              }
            >
              <XIcon aria-hidden />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-5">{children}</div>
          {footer ? (
            <div className="flex flex-col-reverse gap-2 border-t border-border px-4 py-3 sm:flex-row sm:justify-end md:px-6">
              {footer}
            </div>
          ) : null}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Bouton qui ferme le volet (à placer dans `footer`), ex. `<SidePanelClose>Fermer</SidePanelClose>`. */
export function SidePanelClose({
  children = "Fermer",
  variant = "outline",
}: {
  children?: React.ReactNode;
  variant?: "outline" | "ghost" | "secondary";
}) {
  return (
    <DialogPrimitive.Close render={<Button variant={variant} className="max-md:h-10" />}>
      {children}
    </DialogPrimitive.Close>
  );
}

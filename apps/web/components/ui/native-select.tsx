import * as React from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/components/ui/cn";

/**
 * Bordure des champs (Input, Textarea, SelectTrigger, Checkbox, select natif) : contraste d'au moins 3:1 sur blanc
 * et sur le fond des pages (WCAG 1.4.11). Les boutons « outline » gardent `border-input`, plus clair : leur texte
 * suffit à les reconnaître.
 */
export const fieldBorderClass = "border-muted-foreground/75";

/**
 * Classes d'un `<select>` natif au style de `Input` / `SelectTrigger` : 36 px (40 px sur téléphone), texte 16 px sur
 * téléphone (pas de zoom automatique d'iOS au focus), flèche dessinée par `NativeSelect` (pas celle du système).
 */
export const nativeSelectClass = cn(
  "h-9 w-full min-w-0 cursor-pointer appearance-none rounded-lg border bg-surface py-1 pr-8 pl-3 text-base text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-brand/30 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-danger aria-invalid:ring-3 aria-invalid:ring-danger/15 max-md:h-10 md:text-body",
  fieldBorderClass,
);

/**
 * Liste de choix native (formulaire GET simple, filtres) : mêmes dimensions, bordure et flèche que `SelectTrigger`.
 * Toutes les props de `<select>` ; `className` va au `<select>`, `wrapperClassName` à son conteneur.
 * Libellé : `<Label htmlFor>` vers son `id`, ou `aria-label`.
 */
function NativeSelect({
  className,
  wrapperClassName,
  ...props
}: React.ComponentProps<"select"> & { wrapperClassName?: string }) {
  return (
    <span
      data-slot="native-select-wrapper"
      className={cn("relative inline-flex min-w-0", wrapperClassName)}
    >
      <select data-slot="native-select" className={cn(nativeSelectClass, className)} {...props} />
      <ChevronDownIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  );
}

export { NativeSelect };

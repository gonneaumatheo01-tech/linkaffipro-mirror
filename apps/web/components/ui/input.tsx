import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "@/components/ui/cn"

/**
 * Champ de saisie : 36 px (40 px sur téléphone), fond blanc, bordure gris moyen (contraste 3:1 sur blanc et sur le
 * fond des pages, WCAG 1.4.11), anneau orange foncé au focus.
 * Texte 16 px sur téléphone (évite le zoom automatique d'iOS), 14 px sur ordinateur.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-lg border border-muted-foreground/75 bg-surface px-3 py-1 text-base text-foreground transition-colors outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-body file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-brand/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-danger aria-invalid:ring-3 aria-invalid:ring-danger/15 max-md:h-10 md:text-body",
        className
      )}
      {...props}
    />
  )
}

export { Input }

"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { cn } from "@/components/ui/cn"
import { CheckIcon } from "lucide-react"

/**
 * Case à cocher : 16 px, cochée en orange (coche nuit) ; zone cliquable agrandie autour.
 * `focus-visible:outline-solid` est indispensable : `outline-none` (Tailwind 4) pose `--tw-outline-style: none`, que
 * `focus-visible:outline-2` réutilise ; sans lui, le contour de focus clavier reste invisible.
 */
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-muted-foreground/75 bg-surface transition-colors outline-none group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-3 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger data-checked:border-brand data-checked:bg-brand data-checked:text-brand-foreground",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
      >
        <CheckIcon
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }

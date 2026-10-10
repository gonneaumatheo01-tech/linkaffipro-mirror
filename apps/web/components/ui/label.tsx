"use client"

import * as React from "react"
import { cn } from "@/components/ui/cn"

/** Libellé d'un champ (relié par `htmlFor`) : texte 14 px semi-gras. */
function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-body leading-tight font-medium text-foreground select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }

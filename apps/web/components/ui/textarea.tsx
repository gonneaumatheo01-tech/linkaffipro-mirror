import * as React from "react"
import { cn } from "@/components/ui/cn"

/** Zone de texte : même style que `Input`, hauteur qui suit le contenu. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-20 w-full rounded-lg border border-muted-foreground/75 bg-surface px-3 py-2 text-base text-foreground transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-brand/30 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-danger aria-invalid:ring-3 aria-invalid:ring-danger/15 md:text-body",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }

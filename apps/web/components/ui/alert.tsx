import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/components/ui/cn"

/**
 * Bandeau d'information dans la page : `default` (neutre), `info`, `success`, `warning`, `destructive`.
 * Une icône lucide en premier enfant se place à gauche. `role="alert"` par défaut (erreurs) :
 * passez `role="status"` pour un message de réussite ou d'information.
 */
const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-lg border px-4 py-3 text-left text-body has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2.5 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "border-border bg-surface text-foreground",
        info: "border-info/25 bg-info-soft text-info *:data-[slot=alert-description]:text-foreground",
        success:
          "border-success/25 bg-success-soft text-success *:data-[slot=alert-description]:text-foreground",
        warning:
          "border-warning/25 bg-warning-soft text-warning *:data-[slot=alert-description]:text-foreground",
        destructive:
          "border-danger/25 bg-danger-soft text-danger *:data-[slot=alert-description]:text-danger",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-semibold group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-body text-balance text-muted-foreground group-has-[>svg]/alert:col-start-2 md:text-pretty [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-3 [&_p:not(:last-child)]:mb-2",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-2.5 right-3", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }

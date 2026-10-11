import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/components/ui/cn"

/**
 * Étiquette courte (compteur, catégorie, mot-clé). Pour un état (envoyé, en attente, échec…),
 * utilisez `StatusPill` / `StatusBadge`, qui ajoutent le point coloré et le libellé standard.
 * `badgeVariants()` rend des classes déjà fusionnées (comme `buttonVariants()`).
 */
const badgeVariantsRaw = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-note font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-danger [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "border-brand/30 bg-brand-soft text-brand-ink [a]:hover:bg-brand/20",
        secondary: "bg-muted text-foreground [a]:hover:bg-accent",
        destructive: "bg-danger-soft text-danger [a]:hover:bg-danger/15",
        outline: "border-border bg-surface text-foreground [a]:hover:bg-muted",
        success: "bg-success-soft text-success",
        warning: "bg-warning-soft text-warning",
        info: "bg-info-soft text-info",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        link: "text-brand-ink underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

/** Classes d'une étiquette, fusionnées par `cn` (la bordure d'`outline` remplace la bordure transparente). */
function badgeVariants(props?: Parameters<typeof badgeVariantsRaw>[0]): string {
  return cn(badgeVariantsRaw(props))
}

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }

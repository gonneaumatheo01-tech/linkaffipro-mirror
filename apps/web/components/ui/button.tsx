import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/components/ui/cn"

/**
 * Bouton (docs/DESIGN-SYSTEM.md, « Boutons »).
 * - `default` : bouton principal orange, texte nuit ; UN SEUL par écran.
 * - `outline` / `secondary` / `ghost` : actions secondaires, sobres.
 * - `destructive` : action qui supprime ou arrête (rouge lisible sur fond doux) ;
 *   `danger` : confirmation d'une action destructive (rouge plein, dans ConfirmDialog).
 * Tailles : `default` 36 px, `sm` 32 px, `lg` 40 px ; sur téléphone, toute cible fait au moins 40 px.
 * Pour un lien qui ressemble à un bouton, utilisez `buttonVariants()` sur `<Link>` (pas `render`) : les classes
 * rendues sont déjà fusionnées (la bordure d'`outline` remplace la bordure transparente de la base).
 * Focus clavier : `focus-visible:outline-solid` reste dans la base pour que le contour reste visible même si un
 * appelant ajoute `outline-none` (Tailwind 4 : `outline-none` pose `--tw-outline-style: none`).
 */
const buttonVariantsRaw = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-body font-medium whitespace-nowrap transition-colors select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 aria-invalid:border-danger max-md:min-h-10 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-brand text-brand-foreground hover:bg-[color-mix(in_oklab,var(--brand),var(--night)_10%)] aria-expanded:bg-[color-mix(in_oklab,var(--brand),var(--night)_10%)]",
        outline:
          "border-input bg-surface text-foreground hover:bg-muted aria-expanded:bg-muted",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklab,var(--secondary),var(--foreground)_6%)] aria-expanded:bg-[color-mix(in_oklab,var(--secondary),var(--foreground)_6%)]",
        ghost:
          "text-foreground hover:bg-muted aria-expanded:bg-muted",
        destructive:
          "border-danger/25 bg-danger-soft text-danger hover:bg-[color-mix(in_oklab,var(--danger-soft),var(--danger)_10%)] focus-visible:outline-danger",
        danger:
          "bg-danger text-white hover:bg-[color-mix(in_oklab,var(--danger),var(--night)_15%)] focus-visible:outline-danger",
        link: "h-auto! px-0! text-brand-ink underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-1.5 px-3.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-7 gap-1 rounded-md px-2 text-note has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-8 gap-1.5 rounded-md px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        lg: "h-10 gap-2 px-4 has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
        icon: "size-9 max-md:min-w-10",
        "icon-xs":
          "size-7 rounded-md max-md:min-w-10 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-8 rounded-md max-md:min-w-10",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

/**
 * Classes d'un bouton, déjà fusionnées par `cn` : sans fusion, `<Link className={buttonVariants({ variant:
 * "outline" })}>` gardait `border-transparent` (base) à côté de `border-input` (variante), et la bordure
 * disparaissait (Tailwind écrit `border-transparent` après `border-input`).
 */
function buttonVariants(props?: Parameters<typeof buttonVariantsRaw>[0]): string {
  return cn(buttonVariantsRaw(props))
}

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  )
}

export { Button, buttonVariants }

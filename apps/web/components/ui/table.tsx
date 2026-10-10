"use client"

import * as React from "react"
import { cn } from "@/components/ui/cn"
import {
  NO_SCROLL,
  horizontalScrollState,
  sameScrollState,
  scrollRegionLabel,
  type ScrollState,
} from "@/components/ui/table-logic"

/**
 * Tableau : en-têtes en note grise, lignes de 48 px, survol discret.
 * Chiffres tabulaires seulement dans les cellules de chiffres (`numeric`, ou alignées à droite) : appliqués à tout
 * le tableau, ils élargissaient les tirets d'Inter (« week - end », « - 1001111 »).
 * Tableau plus large que l'écran : la zone défile, reçoit le focus clavier (flèches gauche / droite) avec un nom
 * (`label`, sinon la légende), et un dégradé sur le bord indique qu'il reste des colonnes à voir.
 * Cinq colonnes au plus à l'écran : pour une liste avec tri et volet de détail, utilisez `DataTable`.
 */
function Table({
  className,
  label,
  ...props
}: React.ComponentProps<"table"> & {
  /** Nom de la zone défilante pour les lecteurs d'écran (par défaut : le texte de la légende). */
  label?: string
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = React.useState<ScrollState>(NO_SCROLL)
  const [caption, setCaption] = React.useState<string | null>(null)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const next = horizontalScrollState(el)
      setScroll((prev) => (sameScrollState(prev, next) ? prev : next))
      setCaption(el.querySelector(":scope > table > caption")?.textContent ?? null)
    }
    update()
    const ro =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update)
    ro?.observe(el)
    if (el.firstElementChild) ro?.observe(el.firstElementChild)
    el.addEventListener("scroll", update, { passive: true })
    return () => {
      ro?.disconnect()
      el.removeEventListener("scroll", update)
    }
  }, [])

  const region = scroll.overflowing
    ? {
        tabIndex: 0,
        role: "region",
        "aria-label": scrollRegionLabel(label ?? caption),
      }
    : {}
  const fade =
    "pointer-events-none absolute inset-y-0 w-10 from-card to-transparent transition-opacity duration-150"

  return (
    <div
      data-slot="table-frame"
      data-overflowing={scroll.overflowing || undefined}
      className="relative w-full"
    >
      <div
        ref={ref}
        data-slot="table-container"
        className="w-full overflow-x-auto rounded-[inherit] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        {...region}
      >
        <table
          data-slot="table"
          className={cn(
            "w-full caption-bottom text-body normal-nums [&_td.text-right]:tabular-nums",
            className
          )}
          {...props}
        />
      </div>
      <div
        aria-hidden
        data-slot="table-scroll-hint"
        className={cn(
          fade,
          "left-0 bg-linear-to-r",
          scroll.overflowing && !scroll.atStart ? "opacity-100" : "opacity-0"
        )}
      />
      <div
        aria-hidden
        data-slot="table-scroll-hint"
        className={cn(
          fade,
          "right-0 bg-linear-to-l",
          scroll.overflowing && !scroll.atEnd ? "opacity-100" : "opacity-0"
        )}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b [&_tr]:hover:bg-transparent", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t border-border bg-muted/40 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b border-border transition-colors hover:bg-muted/40 has-aria-expanded:bg-muted/40 data-[state=selected]:bg-brand-soft/60",
        className
      )}
      {...props}
    />
  )
}

/** En-tête de colonne ; `numeric` : colonne de chiffres (alignée à droite). */
function TableHead({
  className,
  numeric,
  ...props
}: React.ComponentProps<"th"> & { numeric?: boolean }) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-3 text-left align-middle text-note font-medium text-muted-foreground md:whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        numeric && "text-right",
        className
      )}
      {...props}
    />
  )
}

/** Cellule ; `numeric` : chiffre aligné à droite, en chiffres tabulaires (les colonnes restent alignées). */
function TableCell({
  className,
  numeric,
  ...props
}: React.ComponentProps<"td"> & { numeric?: boolean }) {
  return (
    <td
      data-slot="table-cell"
      data-numeric={numeric || undefined}
      className={cn(
        "h-12 px-3 py-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        numeric && "text-right tabular-nums",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-note text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}

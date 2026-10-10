import Link from "next/link";
import { cn } from "@/components/ui/cn";

export type FilterChip = {
  key: string;
  label: string;
  href: string;
  count?: number;
  selected: boolean;
  /** Élément à gauche du libellé (pastille d'univers). */
  icon?: React.ReactNode;
};

/**
 * Rangée de pastilles de filtre (liens) : un clic filtre la liste, la pastille choisie est orange pâle
 * (`aria-current`). Sur téléphone, les pastilles passent à la ligne (la pastille choisie reste toujours visible) et
 * chacune fait 40 px de haut ; sur ordinateur, la rangée défile horizontalement si elle est trop longue.
 * La liste est positionnée (`relative`) : un texte masqué en position absolue reste dans sa zone et n'élargit pas
 * la page.
 */
export function FilterChips({
  label,
  chips,
  className,
}: {
  /** Nom du groupe (« Univers », « Statut »), affiché et annoncé. */
  label: string;
  chips: FilterChip[];
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex min-w-0 items-center gap-2 max-md:items-start", className)}
    >
      <span
        className="w-14 shrink-0 text-note font-medium text-muted-foreground max-md:pt-3"
        aria-hidden
      >
        {label}
      </span>
      <ul className="relative -my-1 flex min-w-0 items-center gap-1.5 py-1 max-md:flex-wrap md:overflow-x-auto">
        {chips.map((c) => (
          <li key={c.key} className="shrink-0">
            <Link
              href={c.href}
              aria-current={c.selected ? "true" : undefined}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-note font-medium whitespace-nowrap transition-colors max-md:h-10",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                c.selected
                  ? "border-brand bg-brand-soft text-brand-ink"
                  : "border-border bg-surface text-foreground hover:bg-muted",
              )}
            >
              {c.icon}
              {c.label}
              {c.count !== undefined ? (
                <span
                  className={cn(
                    "tabular-nums",
                    c.selected ? "text-brand-ink" : "text-muted-foreground",
                  )}
                >
                  {c.count}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

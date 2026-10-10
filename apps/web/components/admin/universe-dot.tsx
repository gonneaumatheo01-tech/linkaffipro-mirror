import { cn } from "@/components/ui/cn";
import { toUniverse, universeClasses, universeLabel } from "@/lib/universe";

/**
 * Couleur d'univers (Casino violet, Paris sportifs vert, Rencontres rose), jamais en fond plein :
 * - `variant="dot"` (par défaut) : petit point, seul ou suivi du libellé (`withLabel`) ;
 * - `variant="pill"` : étiquette à bordure fine colorée, point et libellé coloré.
 * Le point seul porte le libellé en `title` et pour les lecteurs d'écran.
 * Valeur absente ou inconnue : gris, « Sans univers ».
 */
export function UniverseDot({
  universe,
  withLabel = false,
  variant = "dot",
  label,
  className,
}: {
  /** « CASINO », « SPORTS », « DATING » (ou en minuscules) ; null = sans univers. */
  universe: string | null | undefined;
  withLabel?: boolean;
  variant?: "dot" | "pill";
  /** Libellé à afficher à la place du libellé standard. */
  label?: string;
  className?: string;
}) {
  const u = toUniverse(universe);
  const c = universeClasses(u);
  const text = label ?? universeLabel(u);
  const dot = <span aria-hidden className={cn("size-2 shrink-0 rounded-full", c.dot)} />;

  if (variant === "pill") {
    return (
      <span
        data-slot="universe-pill"
        data-universe={u ?? "none"}
        className={cn(
          "inline-flex h-6 w-fit shrink-0 items-center gap-1.5 rounded-full border bg-surface px-2.5 text-note font-medium whitespace-nowrap",
          c.border,
          c.ink,
          className,
        )}
      >
        {dot}
        {text}
      </span>
    );
  }

  if (!withLabel) {
    return (
      <span
        data-slot="universe-dot"
        data-universe={u ?? "none"}
        title={text}
        className={cn("inline-flex items-center", className)}
      >
        {dot}
        <span className="sr-only">{text}</span>
      </span>
    );
  }

  return (
    <span
      data-slot="universe-dot"
      data-universe={u ?? "none"}
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)}
    >
      {dot}
      <span>{text}</span>
    </span>
  );
}

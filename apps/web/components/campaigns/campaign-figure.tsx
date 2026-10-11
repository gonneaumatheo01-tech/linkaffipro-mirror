import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Term } from "@/components/admin/help-tip";
import {
  formatVariation,
  variationSummary,
  variationTone,
  type Favorable,
} from "@/components/admin/stat-card-logic";
import { cn } from "@/components/ui/cn";

const TONE_TEXT = {
  positive: "text-success",
  negative: "text-danger",
  neutral: "text-muted-foreground",
} as const;

/**
 * Variation d'un chiffre (même rendu que `StatCard`) : flèche, signe et pourcentage colorés (vert si favorable),
 * phrase complète pour les lecteurs d'écran. `delta` null : « — » (pas de comparaison possible).
 */
export function FigureDelta({
  delta,
  favorable = "up",
  comparison = "vs période précédente",
  className,
}: {
  delta: number | null | undefined;
  favorable?: Favorable;
  comparison?: string;
  className?: string;
}) {
  const rounded = formatVariation(delta);
  if (rounded === "—")
    return (
      <span className={cn("text-note text-muted-foreground", className)}>
        <span aria-hidden>—</span>
        <span className="sr-only">{variationSummary(null, comparison)}</span>
      </span>
    );
  const tone = variationTone(delta, favorable);
  const Arrow = rounded === "0 %" ? Minus : delta! > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-note font-medium whitespace-nowrap tabular-nums",
        TONE_TEXT[tone],
        className,
      )}
    >
      <Arrow aria-hidden className="size-3.5" />
      <span aria-hidden>{rounded}</span>
      <span className="sr-only">{variationSummary(delta, comparison)}</span>
    </span>
  );
}

/**
 * Un chiffre d'une carte de campagne : libellé en note grise (terme technique au survol), valeur 20 px en chiffres
 * tabulaires, variation facultative TOUJOURS sur sa propre ligne sous la valeur (hauteur réservée : les cases d'une
 * carte gardent la même hauteur, qu'un chiffre soit court ou long), phrase d'explication facultative (`hint`).
 * `valueTone` colore la valeur (bénéfice positif ou négatif). À placer dans un `<dl>` (le bloc est un groupe
 * `dt` / `dd`).
 */
export function CampaignFigure({
  label,
  term,
  value,
  delta,
  favorable = "up",
  valueTone = "neutral",
  hint,
  className,
}: {
  label: string;
  term?: string;
  value: string;
  /** Absent : pas de ligne de variation ; null : « — ». */
  delta?: number | null;
  favorable?: Favorable;
  valueTone?: "positive" | "negative" | "neutral";
  /** Une phrase sous le chiffre : ce qu'il mesure. */
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-note text-muted-foreground">
        {/* Dans une carte à lien « étiré », `Term` se place seul (survolable sur ordinateur, la carte au toucher). */}
        <Term term={term}>{label}</Term>
      </dt>
      <dd
        className={cn(
          "truncate text-title tabular-nums",
          valueTone === "positive" && "text-success",
          valueTone === "negative" && "text-danger",
          valueTone === "neutral" && "text-foreground",
        )}
      >
        {value}
      </dd>
      {delta !== undefined ? (
        <dd className="flex min-h-4 items-center">
          <FigureDelta delta={delta} favorable={favorable} />
        </dd>
      ) : null}
      {hint ? <dd className="mt-0.5 text-note text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}

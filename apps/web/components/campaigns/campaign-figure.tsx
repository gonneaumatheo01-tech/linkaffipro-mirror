import { Term } from "@/components/admin/help-tip";
import { VariationText } from "@/components/admin/stat-card";
import type { Favorable, Variation } from "@/components/admin/stat-card-logic";
import { cn } from "@/components/ui/cn";

/**
 * Variation d'un chiffre, rendu commun avec `StatCard` (`VariationText`) : flèche, « +12 % » ou « nouveau » coloré
 * (vert si favorable), phrase complète pour les lecteurs d'écran ; rien quand les deux périodes valent 0 ; « — » sans
 * comparaison possible, ou « Avant : X » quand `before` est donné (période d'avant en perte : une perte à côté d'un
 * pourcentage se lirait comme une hausse). `variation` (règle unique `comparableVariation`, qui connaît la base) prime
 * sur `delta` (pourcentage déjà calculé, ancienne forme : null = « — »).
 */
export function FigureDelta({
  delta,
  variation,
  favorable = "up",
  comparison = "vs période précédente",
  before,
  className,
}: {
  delta?: number | null;
  variation?: Variation;
  favorable?: Favorable;
  comparison?: string;
  /** Valeur d'avant déjà formatée, écrite à la place de « — » quand aucun pourcentage n'est possible. */
  before?: string | null;
  className?: string;
}) {
  const v: Variation =
    variation ??
    (delta === null || delta === undefined || !Number.isFinite(delta)
      ? { kind: "unknown" }
      : { kind: "pct", pct: delta });
  if (v.kind === "unknown" && before)
    return (
      <span className={cn("text-note text-muted-foreground tabular-nums", className)}>
        Avant : {before}
        <span className="sr-only"> (pas de comparaison possible)</span>
      </span>
    );
  return (
    <VariationText
      variation={v}
      favorable={favorable}
      comparison={comparison}
      className={className}
    />
  );
}

/**
 * Un chiffre d'une carte de campagne : libellé en note grise (terme technique au survol), valeur 20 px en chiffres
 * tabulaires, variation facultative TOUJOURS sur sa propre ligne sous la valeur (hauteur réservée : les cases d'une
 * carte gardent la même hauteur, qu'un chiffre soit court ou long), phrase d'explication facultative (`hint`).
 * `valueTone` colore la valeur (gains positifs ou négatifs). À placer dans un `<dl>` (le bloc est un groupe
 * `dt` / `dd`).
 */
export function CampaignFigure({
  label,
  term,
  value,
  delta,
  variation,
  favorable = "up",
  valueTone = "neutral",
  before,
  hint,
  className,
}: {
  label: string;
  term?: string;
  value: string;
  /** Absent : pas de ligne de variation ; null : « — ». Préférer `variation`. */
  delta?: number | null;
  /** Variation d'après la valeur et sa base (`comparableVariation`) : « nouveau » depuis 0 ; prime sur `delta`. */
  variation?: Variation;
  favorable?: Favorable;
  /** Valeur d'avant formatée : « Avant : X » à la place de « — » quand aucun pourcentage n'est possible. */
  before?: string | null;
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
      {variation !== undefined || delta !== undefined ? (
        <dd className="flex min-h-4 items-center">
          <FigureDelta delta={delta} variation={variation} favorable={favorable} before={before} />
        </dd>
      ) : null}
      {hint ? <dd className="mt-0.5 text-note text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}

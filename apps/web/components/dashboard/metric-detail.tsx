import { Term } from "@/components/admin/help-tip";
import type { Favorable, Variation } from "@/components/admin/stat-card-logic";
import { FigureDelta } from "@/components/campaigns/campaign-figure";
import { cn } from "@/components/ui/cn";

export type DetailFigure = {
  key: string;
  label: string;
  term?: string;
  /** Valeur déjà formatée. */
  value: string;
  /** Valeur de la période précédente, déjà formatée (comparaison cochée). */
  previous?: string;
  /** Variation en % (comparaison cochée) ; null : pas de comparaison possible. Préférer `variation`. */
  delta?: number | null;
  /** Variation d'après la valeur et sa base (`comparableVariation`) : « nouveau » depuis 0 ; prime sur `delta`. */
  variation?: Variation;
  favorable?: Favorable;
};

/**
 * Détail d'une ligne (volet latéral) : tous les chiffres, chacun avec la période précédente et la variation quand la
 * comparaison est cochée. Liste de définitions (`dl`), une ligne par chiffre, le terme technique au survol.
 */
export function MetricDetail({
  figures,
  compare,
  className,
}: {
  figures: DetailFigure[];
  compare: boolean;
  className?: string;
}) {
  return (
    <dl className={cn("divide-y divide-border", className)}>
      {figures.map((f) => (
        <div key={f.key} className="flex items-start justify-between gap-4 py-2.5">
          <dt className="min-w-0 text-body text-muted-foreground">
            <Term term={f.term}>{f.label}</Term>
          </dt>
          <dd className="text-right">
            <span className="text-body font-semibold text-foreground tabular-nums">{f.value}</span>
            {compare ? (
              <span className="mt-0.5 flex items-center justify-end gap-2 text-note text-muted-foreground">
                {f.previous !== undefined ? (
                  <span className="tabular-nums">Avant : {f.previous}</span>
                ) : null}
                <FigureDelta
                  delta={f.delta ?? null}
                  variation={f.variation}
                  favorable={f.favorable}
                />
              </span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

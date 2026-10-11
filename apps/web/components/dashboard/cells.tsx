import type { Favorable, Variation } from "@/components/admin/stat-card-logic";
import { FigureDelta } from "@/components/campaigns/campaign-figure";

/**
 * Cellule de chiffre d'un tableau des statistiques : la valeur, quand la comparaison est cochée sa variation JUSTE
 * DESSOUS (elle porte sur la valeur), puis une précision grise facultative (« 2,10 € par membre », « 3 € de perte »),
 * pour qu'une variation ne se lise jamais comme celle de la précision.
 * Le tri du tableau passe par `sortValues` (la cellule est un nœud React).
 */
export function NumCell({
  value,
  note,
  delta,
  variation,
  favorable = "up",
}: {
  value: string;
  note?: string | null;
  /** Absent : pas de ligne de variation. Préférer `variation`. */
  delta?: number | null;
  /** Variation d'après la valeur et sa base (`comparableVariation`) : « nouveau » depuis 0 ; prime sur `delta`. */
  variation?: Variation;
  favorable?: Favorable;
}) {
  return (
    <span className="inline-flex flex-col items-end">
      <span className="tabular-nums">{value}</span>
      {variation !== undefined || delta !== undefined ? (
        <FigureDelta delta={delta} variation={variation} favorable={favorable} />
      ) : null}
      {note ? <span className="text-note text-muted-foreground">{note}</span> : null}
    </span>
  );
}

/** Classe commune : masque la mini-courbe d'une `StatCard` sur téléphone (deux cartes par ligne, chiffre lisible). */
export const STAT_GRID_PHONE = "max-md:[&_.text-figure+svg]:hidden";

import type { Favorable } from "@/components/admin/stat-card-logic";
import { FigureDelta } from "@/components/campaigns/campaign-figure";

/**
 * Cellule de chiffre d'un tableau des statistiques : la valeur, une précision grise facultative (« 2,10 € par
 * membre ») et, quand la comparaison est cochée, la variation par rapport à la période précédente.
 * Le tri du tableau passe par `sortValues` (la cellule est un nœud React).
 */
export function NumCell({
  value,
  note,
  delta,
  favorable = "up",
}: {
  value: string;
  note?: string | null;
  /** Absent : pas de ligne de variation. */
  delta?: number | null;
  favorable?: Favorable;
}) {
  return (
    <span className="inline-flex flex-col items-end">
      <span className="tabular-nums">{value}</span>
      {note ? <span className="text-note text-muted-foreground">{note}</span> : null}
      {delta !== undefined ? <FigureDelta delta={delta} favorable={favorable} /> : null}
    </span>
  );
}

/** Classe commune : masque la mini-courbe d'une `StatCard` sur téléphone (deux cartes par ligne, chiffre lisible). */
export const STAT_GRID_PHONE = "max-md:[&_.text-figure+svg]:hidden";

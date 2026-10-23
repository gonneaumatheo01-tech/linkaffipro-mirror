import { cn } from "@/components/ui/cn";
import { barPercent } from "./chart-logic";

export type ColumnItem = {
  key: string;
  /** Libellé sous la colonne (« 19 h », « mar. »). */
  label: string;
  value: number;
  /** Valeur en mots, reprise au survol et dans le tableau (« 2,4 % sur 31 posts »). */
  valueText: string;
  /** Colonne mise en avant (fenêtre conseillée) : orange plein ; les autres en orange pâle. */
  emphasis?: boolean;
  /** Case sans données suffisantes : colonne grise. */
  muted?: boolean;
};

/**
 * Colonnes verticales en SVG (heures de la journée, jours de la semaine), composant serveur sans bibliothèque.
 * Une seule série, donc pas de légende : le titre la nomme. Chaque colonne a son infobulle native (zone de survol
 * pleine hauteur, plus large que la colonne) ; le tableau des valeurs est dans un bloc repliable, la couleur n'est
 * jamais la seule façon de lire un chiffre.
 */
export function ColumnChart({
  title,
  items,
  height = 160,
  valuesSummary = "Voir les chiffres",
  unitLabel = "Créneau",
  className,
}: {
  title: string;
  items: ColumnItem[];
  height?: number;
  valuesSummary?: string;
  unitLabel?: string;
  className?: string;
}) {
  const max = items.reduce((m, i) => Math.max(m, i.value), 0);
  const slot = items.length <= 7 ? 64 : 24;
  const gap = 2;
  const labelH = 18;
  const plotH = height - labelH;
  const width = items.length * slot;
  const every = items.length > 12 ? 3 : 1;
  const best = items.filter((i) => i.emphasis).map((i) => i.label);
  const desc =
    max <= 0
      ? `${title} : rien de mesuré sur cette période.`
      : `${title}. Plus haut : ${items.find((i) => i.value === max)?.label ?? ""}.${best.length ? ` Mis en avant : ${best.join(", ")}.` : ""}`;
  return (
    <figure className={cn("space-y-2", className)}>
      <svg
        role="img"
        aria-label={desc}
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full max-w-3xl"
      >
        <line x1={0} x2={width} y1={plotH} y2={plotH} className="stroke-border" strokeWidth={1} />
        {items.map((it, i) => {
          const h = max > 0 ? (barPercent(it.value, max) / 100) * (plotH - 4) : 0;
          const x = i * slot + gap / 2;
          const w = slot - gap;
          return (
            <g key={it.key}>
              <title>{`${it.label} : ${it.valueText}`}</title>
              <rect x={i * slot} y={0} width={slot} height={plotH} className="fill-transparent" />
              {h > 0 ? (
                <rect
                  x={x + 3}
                  y={plotH - h}
                  width={w - 6}
                  height={h}
                  rx={3}
                  className={it.muted ? "fill-muted-foreground/35" : it.emphasis ? "fill-brand" : "fill-brand/45"}
                />
              ) : null}
              {i % every === 0 ? (
                <text
                  x={i * slot + slot / 2}
                  y={height - 4}
                  textAnchor="middle"
                  className="fill-muted-foreground"
                  fontSize={10}
                >
                  {it.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <details className="text-note text-muted-foreground">
        <summary className="cursor-pointer">{valuesSummary}</summary>
        <table className="mt-2 w-full max-w-md text-left">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              <th scope="col" className="py-1 pr-3 font-medium">
                {unitLabel}
              </th>
              <th scope="col" className="py-1 font-medium">
                Valeur
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.key} className="border-t border-border">
                <td className="py-1 pr-3 text-foreground">{it.label}</td>
                <td className="py-1 tabular-nums text-foreground">{it.valueText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

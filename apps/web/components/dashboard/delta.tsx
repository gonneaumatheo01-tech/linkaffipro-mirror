/**
 * Variation en % par rapport à la période précédente : vert si favorable, rouge sinon, gris si nulle ;
 * `invert` pour les coûts (une baisse est favorable). `—` si non calculable (période précédente à zéro).
 */
export function Delta({
  value,
  invert = false,
  className = "",
}: {
  value: number | null | undefined;
  invert?: boolean;
  className?: string;
}) {
  if (value === null || value === undefined)
    return <span className={`text-xs text-muted-foreground ${className}`}>—</span>;
  const good = invert ? value <= 0 : value >= 0;
  const cls = value === 0 ? "text-muted-foreground" : good ? "text-green-600" : "text-red-600";
  return (
    <span
      className={`text-xs tabular-nums ${cls} ${className}`}
      title="Variation par rapport à la période précédente"
    >
      {value > 0 ? "+" : ""}
      {value.toLocaleString("fr-FR")} %
    </span>
  );
}

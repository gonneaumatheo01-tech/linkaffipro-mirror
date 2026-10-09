/** Variation en % par rapport à la période précédente (vert si positive, rouge si négative ; `invert` pour les coûts). */
export function Delta({ value, invert = false }: { value: number | null | undefined; invert?: boolean }) {
  if (value === null || value === undefined) return <span className="text-xs text-muted-foreground">—</span>;
  const good = invert ? value <= 0 : value >= 0;
  const cls = value === 0 ? "text-muted-foreground" : good ? "text-green-600" : "text-red-600";
  return <span className={`text-xs tabular-nums ${cls}`}>{value > 0 ? "+" : ""}{value.toLocaleString("fr-FR")} %</span>;
}

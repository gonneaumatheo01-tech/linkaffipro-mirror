/** Petit graphique de tendance en SVG inline (sans bibliothèque). */
export function Sparkline({ values, width = 120, height = 32, className }: { values: number[]; width?: number; height?: number; className?: string }) {
  if (values.length === 0) return null;
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * (height - 4) - 2).toFixed(1)}`);
  const last = values[values.length - 1] ?? 0;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden="true">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" points={points.join(" ")} />
      <circle cx={(values.length - 1) * step} cy={height - (last / max) * (height - 4) - 2} r="2" fill="currentColor" />
    </svg>
  );
}

/** Histogramme minimal (barres) pour une série par jour. */
export function Bars({ values, keys, height = 48, className }: { values: number[]; keys: string[]; height?: number; className?: string }) {
  const max = Math.max(...values, 1);
  return (
    <div className={`flex items-end gap-px ${className ?? ""}`} style={{ height }} role="img" aria-label="Tendance par jour">
      {values.map((v, i) => (
        <div key={keys[i] ?? i} title={`${keys[i] ?? ""} : ${v}`} className="flex-1 rounded-sm bg-primary/70" style={{ height: `${Math.max(2, (v / max) * 100)}%` }} />
      ))}
    </div>
  );
}

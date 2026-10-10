import { buildSeries, type ViewMetric, type ViewSample } from "@/lib/views/chart";
import { fmtDate, fmtNum } from "@/lib/format";

const METRIC_LABEL: Record<ViewMetric, string> = { views: "Vues", forwards: "Transferts" };

/** Petite courbe d'une mesure (SVG maison) : ligne 2 px, points survolables avec info-bulle native, axes discrets. */
function MetricChart({ samples, metric }: { samples: ViewSample[]; metric: ViewMetric }) {
  const s = buildSeries(samples, metric);
  if (!s) return null;
  const label = METRIC_LABEL[metric];
  const summary = `${label} : ${fmtNum(s.last.value)} au dernier relevé (${fmtDate(s.last.at)}), ${s.points.length} relevé${s.points.length > 1 ? "s" : ""} depuis le ${fmtDate(s.first.at)}.`;
  const x0 = s.padding.left;
  const x1 = s.width - s.padding.right;
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {fmtNum(s.last.value)} <span className="text-xs">au dernier relevé</span>
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${s.width} ${s.height}`}
        className="h-auto w-full"
        role="img"
        aria-label={summary}
      >
        <title>{summary}</title>
        {s.yTicks.map((tick) => (
          <g key={tick.value}>
            <line
              x1={x0}
              x2={x1}
              y1={tick.y}
              y2={tick.y}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={x0 - 6}
              y={tick.y + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[11px]"
            >
              {fmtNum(tick.value)}
            </text>
          </g>
        ))}
        {s.xTicks.map((tick, i) => (
          <text
            key={`${tick.label}-${i}`}
            x={tick.x}
            y={s.height - 6}
            textAnchor={i === 0 ? "start" : i === s.xTicks.length - 1 ? "end" : "middle"}
            className="fill-muted-foreground text-[11px]"
          >
            {tick.label}
          </text>
        ))}
        {s.points.length > 1 ? (
          <polyline
            points={s.polyline}
            fill="none"
            className="stroke-primary"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
        {s.points.map((p) => (
          <g key={p.at.getTime()}>
            <circle
              cx={p.x}
              cy={p.y}
              r={3}
              className="fill-primary stroke-background"
              strokeWidth={2}
            />
            <circle cx={p.x} cy={p.y} r={9} fill="transparent" className="hover:fill-primary/15">
              <title>{`${fmtDate(p.at)} : ${fmtNum(p.value)} ${label.toLowerCase()}`}</title>
            </circle>
          </g>
        ))}
      </svg>
    </figure>
  );
}

/** Courbes vues et transferts dans le temps + tableau des derniers relevés (repliable). */
export function ViewsChart({ samples }: { samples: ViewSample[] }) {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => b.at.getTime() - a.at.getTime());
  const hasForwards = sorted.some((x) => x.forwards > 0);
  return (
    <div className="space-y-4">
      <MetricChart samples={samples} metric="views" />
      {hasForwards ? <MetricChart samples={samples} metric="forwards" /> : null}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          Voir les relevés ({sorted.length})
        </summary>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1 font-medium">Relevé</th>
              <th className="py-1 text-right font-medium">Vues</th>
              <th className="py-1 text-right font-medium">Transferts</th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 50).map((x) => (
              <tr key={x.at.getTime()} className="border-t">
                <td className="py-1">{fmtDate(x.at)}</td>
                <td className="py-1 text-right tabular-nums">{fmtNum(x.views)}</td>
                <td className="py-1 text-right tabular-nums">{fmtNum(Math.max(0, x.forwards))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

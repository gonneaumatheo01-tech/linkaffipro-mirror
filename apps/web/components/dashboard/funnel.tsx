import type { FunnelStep } from "@/lib/dashboard/metrics";

/** Entonnoir en barres SVG inline : valeur, taux de passage et perte à chaque étape. */
export function Funnel({ steps }: { steps: FunnelStep[] }) {
  const max = Math.max(...steps.map((s) => s.value), 1);
  return (
    <div className="space-y-2">
      {steps.map((s) => (
        <div key={s.key} className="grid grid-cols-[120px_1fr_150px] items-center gap-3 text-sm">
          <div className="text-muted-foreground">{s.label}</div>
          <svg width="100%" height="22" viewBox="0 0 100 22" preserveAspectRatio="none" aria-hidden="true">
            <rect x="0" y="2" width="100" height="18" rx="3" className="fill-muted" />
            <rect x="0" y="2" width={Math.max(0.5, (s.value / max) * 100)} height="18" rx="3" className="fill-primary/80" />
          </svg>
          <div className="tabular-nums">
            <span className="font-medium">{s.value.toLocaleString("fr-FR")}</span>
            {s.rate !== null ? <span className="ml-2 text-xs text-muted-foreground">{s.rate} %{s.loss !== null && s.loss > 0 ? ` · −${s.loss} %` : ""}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

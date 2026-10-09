import { HelpTip } from "@/components/admin/help-tip";
import type { FunnelStep } from "@/lib/dashboard/metrics";
import { METRIC_HELP } from "./metric-help";

/** Entonnoir en barres SVG inline : valeur, taux de passage et perte à chaque étape. */
export function Funnel({ steps }: { steps: FunnelStep[] }) {
  const max = Math.max(...steps.map((s) => s.value), 1);
  return (
    <div className="space-y-2">
      {steps.map((s) => (
        <div
          key={s.key}
          className="grid grid-cols-[104px_1fr_110px] items-center gap-2 text-sm sm:grid-cols-[140px_1fr_150px] sm:gap-3"
        >
          <div className="flex items-center gap-1 text-muted-foreground">
            <span className="truncate">{s.label}</span>
            {METRIC_HELP[s.key] ? (
              <HelpTip label={`Définition : ${s.label}`}>{METRIC_HELP[s.key]}</HelpTip>
            ) : null}
          </div>
          <svg
            width="100%"
            height="22"
            viewBox="0 0 100 22"
            preserveAspectRatio="none"
            role="img"
            aria-label={`${s.label} : ${s.value.toLocaleString("fr-FR")}${s.rate !== null ? `, ${s.rate} % de l'étape précédente` : ""}`}
          >
            <rect x="0" y="2" width="100" height="18" rx="3" className="fill-muted" />
            <rect
              x="0"
              y="2"
              width={Math.max(0.5, (s.value / max) * 100)}
              height="18"
              rx="3"
              className="fill-primary/80"
            />
          </svg>
          <div className="tabular-nums">
            <span className="font-medium">{s.value.toLocaleString("fr-FR")}</span>
            {s.rate !== null ? (
              <span className="ml-2 text-xs text-muted-foreground">
                {s.rate} %{s.loss !== null && s.loss > 0 ? ` · −${s.loss} %` : ""}
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

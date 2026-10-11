import { Term } from "@/components/admin/help-tip";
import { BarList } from "@/components/charts/bar-list";
import { FigureDelta } from "@/components/campaigns/campaign-figure";
import { fmtNum } from "@/lib/format";
import { funnelLabel, stepNote } from "@/lib/dashboard/display";
import { deltaPct, type FunnelStep } from "@/lib/dashboard/metrics";

/**
 * Parcours (ex-entonnoir) en barres horizontales : à chaque étape, le nombre de personnes, la part gardée par
 * rapport à l'étape d'avant et, avec la comparaison, la valeur de la période précédente et la variation.
 * Tout est écrit en texte : les barres ne sont qu'un repère visuel.
 */
export function Funnel({
  steps,
  previous,
}: {
  steps: FunnelStep[];
  previous?: FunnelStep[] | null;
}) {
  const prevByKey = new Map((previous ?? []).map((s) => [s.key, s.value]));
  return (
    <BarList
      label="Parcours, étape par étape"
      items={steps.map((s) => {
        const { label, term } = funnelLabel(s);
        const before = prevByKey.get(s.key) ?? 0;
        return {
          key: s.key,
          label: <Term term={term}>{label}</Term>,
          value: s.value,
          valueText: fmtNum(s.value),
          note: (
            <>
              {stepNote(s.rate) ? <span className="block">{stepNote(s.rate)}</span> : null}
              {previous ? (
                <span className="flex items-center justify-end gap-2 md:justify-start">
                  <span className="tabular-nums">Avant : {fmtNum(before)}</span>
                  <FigureDelta delta={deltaPct(s.value, before)} />
                </span>
              ) : null}
            </>
          ),
        };
      })}
    />
  );
}

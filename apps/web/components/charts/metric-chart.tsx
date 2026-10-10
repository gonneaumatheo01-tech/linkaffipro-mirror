"use client";

import { useId, useState } from "react";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/components/ui/cn";
import type { ChartFormat } from "./chart-logic";
import { TimeChart, type ChartSeries } from "./time-chart";

/** Un chiffre que l'on peut afficher dans le graphique (données sérialisables, préparées côté serveur). */
export type ChartMetric = {
  key: string;
  /** Mot du client (« Premiers dépôts »). */
  label: string;
  format: ChartFormat;
  integer?: boolean;
  values: number[];
  /** Même chiffre sur la période précédente (comparaison cochée), aligné jour pour jour. */
  previous?: number[] | null;
};

/**
 * Graphique d'une page des statistiques avec le choix du chiffre affiché (« Afficher : Membres entrés »).
 * Le choix ne recharge pas la page (aucun changement de contexte) ; une seule courbe à la fois (pas de double axe),
 * la période précédente en gris quand la comparaison est cochée.
 */
export function MetricChart({
  metrics,
  labels,
  previousLabels,
  period,
  defaultKey,
  kind = "line",
  suffix = "jour par jour",
  unitLabel,
  valuesSummary,
  height,
  className,
}: {
  metrics: ChartMetric[];
  labels: string[];
  previousLabels?: string[];
  period?: string;
  defaultKey?: string;
  kind?: "line" | "bar";
  /** Fin du titre du graphique : « Membres entrés jour par jour ». */
  suffix?: string;
  unitLabel?: string;
  valuesSummary?: string;
  height?: number;
  className?: string;
}) {
  const id = useId();
  const [key, setKey] = useState(defaultKey ?? metrics[0]?.key ?? "");
  const m = metrics.find((x) => x.key === key) ?? metrics[0];
  if (!m) return null;
  const series: ChartSeries[] = [
    {
      id: "current",
      label: m.previous ? "Cette période" : m.label,
      values: m.values,
      tone: "current",
    },
    ...(m.previous
      ? [
          {
            id: "previous",
            label: "Période précédente",
            values: m.previous,
            tone: "previous" as const,
          },
        ]
      : []),
  ];
  return (
    <div className={cn("min-w-0", className)}>
      {metrics.length > 1 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Label htmlFor={`${id}-metric`} className="text-body text-muted-foreground">
            Afficher
          </Label>
          <NativeSelect
            id={`${id}-metric`}
            value={m.key}
            onChange={(e) => setKey(e.target.value)}
            className="w-auto"
          >
            {metrics.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}
      <TimeChart
        key={m.key}
        title={`${m.label} ${suffix}`}
        period={period}
        labels={labels}
        previousLabels={previousLabels}
        series={series}
        format={m.format}
        integer={m.integer}
        kind={kind}
        unitLabel={unitLabel}
        valuesSummary={valuesSummary}
        height={height}
      />
    </div>
  );
}

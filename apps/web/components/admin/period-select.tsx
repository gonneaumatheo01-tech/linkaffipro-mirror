"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { PERIOD_KEYS, PERIOD_LABELS, type Period, type PeriodKey } from "@/lib/periods";

/**
 * Sélecteur de période commun (formulaire GET) : aujourd'hui, hier, 7 / 30 / 90 jours, mois en cours, personnalisée
 * (deux dates) et case « comparer à la période précédente ». Paramètres d'URL : `range`, `from`, `to`, `compare=1`.
 * `extra` : autres paramètres à conserver (onglet, filtres), recopiés en champs cachés.
 */
export function PeriodSelect({
  period,
  compare,
  extra = {},
  action,
  className,
}: {
  period: Period;
  compare: boolean;
  extra?: Record<string, string | undefined>;
  /** Chemin de la page (par défaut : la page courante). */
  action?: string;
  className?: string;
}) {
  const [key, setKey] = useState<PeriodKey>(period.key);
  const custom = key === "custom";
  return (
    <form
      method="get"
      action={action}
      className={`flex flex-wrap items-end gap-2 ${className ?? ""}`}
      aria-label="Période"
    >
      {Object.entries(extra).map(([k, v]) =>
        v ? <input key={k} type="hidden" name={k} value={v} /> : null,
      )}
      <div className="flex flex-col gap-1">
        <Label htmlFor="period-range" className="sr-only">
          Période
        </Label>
        <NativeSelect
          id="period-range"
          name="range"
          value={key}
          onChange={(e) => setKey(e.target.value as PeriodKey)}
          className="w-auto"
        >
          {PERIOD_KEYS.map((k) => (
            <option key={k} value={k}>
              {PERIOD_LABELS[k]}
            </option>
          ))}
        </NativeSelect>
      </div>
      {custom ? (
        <>
          <div className="flex flex-col gap-1">
            <Label htmlFor="period-from" className="text-note font-normal text-muted-foreground">
              Du
            </Label>
            <Input
              id="period-from"
              name="from"
              type="date"
              required
              defaultValue={period.from}
              className="h-10 w-40 md:h-9"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="period-to" className="text-note font-normal text-muted-foreground">
              au
            </Label>
            <Input
              id="period-to"
              name="to"
              type="date"
              required
              defaultValue={period.to}
              className="h-10 w-40 md:h-9"
            />
          </div>
        </>
      ) : null}
      <label className="flex h-10 cursor-pointer items-center gap-2 text-body md:h-9">
        <input
          type="checkbox"
          name="compare"
          value="1"
          defaultChecked={compare}
          className="size-4 accent-brand"
        />
        Comparer à la période précédente
      </label>
      <Button type="submit" variant="outline" className="max-md:h-10">
        Appliquer
      </Button>
    </form>
  );
}

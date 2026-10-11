"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { STATS_DEFAULT_RANGE, moreFiltersCount } from "@/lib/dashboard/stats-pages";
import { PERIOD_KEYS, PERIOD_LABELS, type Period, type PeriodKey } from "@/lib/periods";
import { UNIVERSES, UNIVERSE_LABELS } from "@/lib/universe";

/** Adresse propre : sans champ vide ni la période par défaut de la page (« 7 derniers jours » en général). */
function cleanQuery(form: HTMLFormElement, defaultRange: PeriodKey): string {
  const p = new URLSearchParams();
  for (const [k, v] of new FormData(form)) {
    if (typeof v !== "string" || v === "") continue;
    if (k === "range" && v === defaultRange) continue;
    p.append(k, v);
  }
  return p.toString();
}

/**
 * Sélecteur unique des statistiques, en haut de chaque page : période (avec deux dates pour « Personnalisée », juste
 * après la période qu'elles précisent), comparaison avec la période précédente, univers, campagne ; le canal est
 * rangé dans « Plus de filtres ». `defaultRange` : période par défaut de la page (non écrite dans l'adresse).
 * Formulaire GET vers la page courante : les valeurs vivent dans l'adresse et suivent la sous-navigation.
 * Un filtre qu'une page n'utilise pas (`showCompare`, `showChannel` à faux) est gardé en champ caché.
 * « Appliquer » recharge la page (pas d'envoi automatique : lire une liste au clavier ne change pas la page).
 * Largeur des listes sur leur conteneur (`wrapperClassName`) : la flèche dessinée reste collée au champ, même dans un
 * parent qui s'étire (bloc « Plus de filtres »).
 */
export function StatsFilters({
  action,
  period,
  compare,
  vertical,
  campaignId,
  channelId,
  campaigns,
  channels,
  showCompare = true,
  showChannel = true,
  channelHelp,
  defaultRange = STATS_DEFAULT_RANGE,
  className,
}: {
  action: string;
  period: Period;
  compare: boolean;
  vertical: string;
  campaignId: string;
  channelId: string;
  campaigns: Array<{ id: string; name: string }>;
  channels: Array<{ id: string; title: string }>;
  showCompare?: boolean;
  showChannel?: boolean;
  /** Une phrase sous le choix du canal (ce qu'il change sur cette page). */
  channelHelp?: string;
  /** Période par défaut de la page (`statsDefaultRange`). */
  defaultRange?: PeriodKey;
  className?: string;
}) {
  const id = useId();
  const router = useRouter();
  const [range, setRange] = useState<PeriodKey>(period.key);
  const custom = range === "custom";
  const more = moreFiltersCount({ channelId });

  return (
    <form
      method="get"
      action={action}
      aria-label="Filtres des statistiques"
      onSubmit={(e) => {
        e.preventDefault();
        const q = cleanQuery(e.currentTarget, defaultRange);
        router.push(q ? `${action}?${q}` : action);
      }}
      className={cn("mb-2 rounded-xl border border-border bg-card p-3 md:p-4", className)}
    >
      <div className="grid grid-cols-1 gap-3 md:flex md:flex-wrap md:items-end">
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={`${id}-range`} className="text-note font-medium text-muted-foreground">
            Période
          </Label>
          <NativeSelect
            id={`${id}-range`}
            name="range"
            value={range}
            onChange={(e) => setRange(e.target.value as PeriodKey)}
            wrapperClassName="w-full md:w-48"
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
            <div className="flex min-w-0 flex-col gap-1">
              <Label htmlFor={`${id}-from`} className="text-note font-medium text-muted-foreground">
                Du
              </Label>
              <Input
                id={`${id}-from`}
                name="from"
                type="date"
                required
                defaultValue={period.from}
                className="md:w-40"
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <Label htmlFor={`${id}-to`} className="text-note font-medium text-muted-foreground">
                Au
              </Label>
              <Input
                id={`${id}-to`}
                name="to"
                type="date"
                required
                defaultValue={period.to}
                className="md:w-40"
              />
            </div>
          </>
        ) : null}
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={`${id}-vertical`} className="text-note font-medium text-muted-foreground">
            Univers
          </Label>
          <NativeSelect
            id={`${id}-vertical`}
            name="vertical"
            defaultValue={vertical}
            wrapperClassName="w-full md:w-44"
          >
            <option value="">Tous les univers</option>
            {UNIVERSES.map((u) => (
              <option key={u} value={u}>
                {UNIVERSE_LABELS[u]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={`${id}-campaign`} className="text-note font-medium text-muted-foreground">
            Campagne
          </Label>
          <NativeSelect
            id={`${id}-campaign`}
            name="campaignId"
            defaultValue={campaignId}
            wrapperClassName="w-full md:w-56"
          >
            <option value="">Toutes les campagnes</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        {showCompare ? (
          <label className="flex min-h-10 cursor-pointer items-center gap-2 text-body md:h-9 md:min-h-0">
            <Checkbox name="compare" value="1" defaultChecked={compare} />
            Comparer à la période précédente
          </label>
        ) : compare ? (
          <input type="hidden" name="compare" value="1" />
        ) : null}
        <Button type="submit" variant="outline" className="md:ml-auto">
          Appliquer
        </Button>
      </div>
      {showChannel ? (
        <details className="group/more mt-3" open={more > 0}>
          <summary className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md text-note font-medium text-muted-foreground hover:text-foreground max-md:min-h-10">
            <SlidersHorizontal aria-hidden className="size-3.5" />
            Plus de filtres{more ? ` (${more})` : ""}
          </summary>
          <div className="mt-2 flex flex-col gap-1">
            <Label
              htmlFor={`${id}-channel`}
              className="text-note font-medium text-muted-foreground"
            >
              Canal
            </Label>
            <NativeSelect
              id={`${id}-channel`}
              name="channelId"
              defaultValue={channelId}
              wrapperClassName="w-full md:w-64"
            >
              <option value="">Tous les canaux</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </NativeSelect>
            {channelHelp ? <p className="text-note text-muted-foreground">{channelHelp}</p> : null}
          </div>
        </details>
      ) : channelId ? (
        <input type="hidden" name="channelId" value={channelId} />
      ) : null}
    </form>
  );
}

import { cn } from "@/components/ui/cn";
import { barPercent } from "./chart-logic";

export type BarListItem = {
  key: string;
  /** Nom de la ligne (texte ou nœud : pastille de couleur, `Term`). */
  label: React.ReactNode;
  /** Valeur qui fixe la longueur de la barre. */
  value: number;
  /** Valeur affichée (« 1 240 », « 2,4 clics par message »). */
  valueText: React.ReactNode;
  /** Précision sous la valeur (part gardée, période précédente…). */
  note?: React.ReactNode;
};

/**
 * Barres horizontales lisibles sans couleur (parcours, catégories) : chaque ligne écrit son nom et sa valeur, la
 * barre orange n'est qu'un repère visuel (masquée aux lecteurs d'écran). Composant serveur, sans dépendance.
 * Ordinateur : nom | barre | valeur ; téléphone : nom et valeur sur une ligne, la barre en dessous.
 * `max` : valeur de la barre pleine (par défaut, la plus grande).
 */
export function BarList({
  items,
  label,
  max,
  className,
}: {
  items: BarListItem[];
  /** Nom de la liste pour les lecteurs d'écran (« Parcours, étape par étape »). */
  label: string;
  max?: number;
  className?: string;
}) {
  const top = max ?? items.reduce((m, i) => Math.max(m, i.value), 0);
  return (
    <ol aria-label={label} className={cn("space-y-4", className)}>
      {items.map((it) => (
        <li
          key={it.key}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1.5 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_minmax(0,15rem)] md:items-center"
        >
          <div className="min-w-0 text-body text-foreground">{it.label}</div>
          <div className="text-right md:order-3 md:text-left">
            <span className="text-body font-semibold text-foreground tabular-nums">
              {it.valueText}
            </span>
            {it.note ? (
              <span className="block text-note text-muted-foreground">{it.note}</span>
            ) : null}
          </div>
          <div
            aria-hidden
            className="col-span-2 h-3 rounded-full bg-muted md:order-2 md:col-span-1"
          >
            <div
              className="h-full rounded-full bg-brand"
              style={{ width: `${barPercent(it.value, top)}%` }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

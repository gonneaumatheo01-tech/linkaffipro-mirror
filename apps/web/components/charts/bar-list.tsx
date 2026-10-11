import { cn } from "@/components/ui/cn";
import { barListLayout, barTone, type BarLabelWidth } from "./bar-list-logic";
import { barPercent } from "./chart-logic";

export type { BarLabelWidth } from "./bar-list-logic";

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
  /**
   * Barre mise en avant (la version gagnante d'un test A/B) : dès qu'une ligne l'est, les autres barres passent en
   * gris. Sans aucune mise en avant, toutes les barres sont orange.
   */
  emphasis?: boolean;
  /** Infobulle native de la ligne (survol) : précision secondaire, jamais la seule source d'un chiffre. */
  title?: string;
};

/**
 * Barres horizontales lisibles sans couleur (parcours, catégories, test A/B) : chaque ligne écrit son nom et sa
 * valeur, la barre orange n'est qu'un repère visuel (masquée aux lecteurs d'écran). Composant serveur, sans
 * dépendance. Ordinateur : nom | barre | valeur ; téléphone : nom et valeur sur une ligne, la barre en dessous.
 * `max` : valeur de la barre pleine (par défaut, la plus grande). `labelWidth` : colonne des noms large (noms de
 * catégories, étapes) ou étroite (« Version A »). Sans aucune `note`, la colonne des valeurs prend juste la place
 * des chiffres (alignés à droite).
 */
export function BarList({
  items,
  label,
  max,
  labelWidth = "wide",
  className,
}: {
  items: BarListItem[];
  /** Nom de la liste pour les lecteurs d'écran (« Parcours, étape par étape »). */
  label: string;
  max?: number;
  labelWidth?: BarLabelWidth;
  className?: string;
}) {
  const top = max ?? items.reduce((m, i) => Math.max(m, i.value), 0);
  const layout = barListLayout(
    labelWidth,
    items.some((i) => i.note != null && i.note !== false),
  );
  const anyEmphasis = items.some((i) => i.emphasis);
  return (
    <ol aria-label={label} className={cn("space-y-4", className)}>
      {items.map((it) => (
        <li
          key={it.key}
          title={it.title}
          className={cn(
            "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1.5 md:items-center",
            layout.columns,
          )}
        >
          <div className="min-w-0 text-body text-foreground">{it.label}</div>
          <div className={cn("text-right md:order-3", layout.valueAlign)}>
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
              className={cn(
                "h-full rounded-full",
                barTone(it.emphasis, anyEmphasis) === "muted"
                  ? "bg-muted-foreground/45"
                  : "bg-brand",
              )}
              style={{ width: `${barPercent(it.value, top)}%` }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

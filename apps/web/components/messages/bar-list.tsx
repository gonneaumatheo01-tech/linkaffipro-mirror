import { cn } from "@/components/ui/cn";
import { barWidths } from "@/lib/posts/compare";

export type BarItem = {
  key: string;
  label: React.ReactNode;
  value: number;
  /** Valeur écrite à droite de la barre (déjà formatée). */
  display: string;
  /** Barre mise en avant (orange foncé) ; les autres sont grises. Par défaut : toutes en orange foncé. */
  emphasis?: boolean;
  /** Infobulle native de la ligne (survol). */
  title?: string;
};

/**
 * Barres horizontales d'une seule mesure (une couleur, valeur écrite à côté : jamais la couleur seule). Barre en
 * `brand-ink` (contraste 5,4:1 sur blanc), piste grise, bout arrondi. Composant serveur, sans dépendance.
 */
export function BarList({
  items,
  label,
  labels = "wide",
  className,
}: {
  items: BarItem[];
  /** Nom de la liste pour les lecteurs d'écran. */
  label: string;
  /** Largeur de la colonne des libellés : « wide » (noms de catégories) ou « narrow » (« Version A »). */
  labels?: "wide" | "narrow";
  className?: string;
}) {
  const widths = barWidths(items.map((i) => i.value));
  const anyEmphasis = items.some((i) => i.emphasis);
  return (
    <ul aria-label={label} className={cn("space-y-2", className)}>
      {items.map((it, i) => (
        <li
          key={it.key}
          title={it.title}
          className={cn(
            "grid items-center gap-3 text-body",
            labels === "narrow"
              ? "grid-cols-[5rem_minmax(0,1fr)_auto]"
              : "grid-cols-[minmax(0,40%)_minmax(0,1fr)_auto] md:grid-cols-[14rem_minmax(0,1fr)_auto]",
          )}
        >
          <span className="min-w-0 truncate">{it.label}</span>
          <span aria-hidden className="h-2.5 overflow-hidden rounded-full bg-muted">
            <span
              className={cn(
                "block h-full rounded-full",
                anyEmphasis && !it.emphasis ? "bg-muted-foreground/45" : "bg-brand-ink",
              )}
              style={{ width: `${widths[i]}%` }}
            />
          </span>
          <span className="text-right font-medium tabular-nums">{it.display}</span>
        </li>
      ))}
    </ul>
  );
}

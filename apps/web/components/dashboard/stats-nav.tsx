import Link from "next/link";
import { ScrollToCurrent } from "@/components/campaigns/scroll-to-current";
import { cn } from "@/components/ui/cn";
import {
  STATS_PAGES,
  statsHref,
  type StatsFilters,
  type StatsPageKey,
} from "@/lib/dashboard/stats-pages";

/**
 * Sous-navigation de Statistiques, sous le titre des cinq pages (comme les onglets d'une campagne, du Journal ou des
 * Réglages) : Vue d'ensemble, Pubs, Parcours, Canaux, Membres dans le temps. Chaque lien garde le sélecteur
 * (période, comparaison, univers, campagne, canal) : on change de page sans perdre ses filtres. Page ouverte
 * soulignée d'orange ; sur téléphone, une seule ligne qui défile (onglets de 40 px), la page ouverte ramenée au
 * centre. Pas de bouton orange : le seul de la page reste celui du `PageHeader`.
 */
export function StatsNav({
  current,
  filters,
  className,
}: {
  current: StatsPageKey;
  filters: StatsFilters;
  className?: string;
}) {
  return (
    <nav
      aria-label="Pages des statistiques"
      className={cn("mb-6 border-b border-border", className)}
    >
      <ScrollToCurrent currentKey={current} className="-mb-px flex gap-1 overflow-x-auto">
        {STATS_PAGES.map((p) => {
          const active = p.key === current;
          return (
            <li key={p.key} className="shrink-0">
              <Link
                href={statsHref(p.path, filters)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-10 items-center border-b-2 px-3 text-body whitespace-nowrap transition-colors",
                  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                  active
                    ? "border-brand font-semibold text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                {p.label}
              </Link>
            </li>
          );
        })}
      </ScrollToCurrent>
    </nav>
  );
}

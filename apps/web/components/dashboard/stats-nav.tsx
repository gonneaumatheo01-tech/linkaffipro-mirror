import { TabNav } from "@/components/admin/tab-nav";
import {
  STATS_PAGES,
  statsHref,
  type StatsFilters,
  type StatsPageKey,
} from "@/lib/dashboard/stats-pages";

/**
 * Sous-navigation de Statistiques, sous le titre des cinq pages (`TabNav`, comme les onglets d'une campagne, d'un
 * canal, de Membres ou du Journal) : Vue d'ensemble, Pubs, Parcours, Canaux, Membres dans le temps. Chaque lien
 * garde le sélecteur (période, comparaison, univers, campagne, canal) : on change de page sans perdre ses filtres.
 * Sur téléphone, une seule ligne qui défile, la page ouverte ramenée au centre, un dégradé sur le bord tant qu'il
 * reste des onglets à voir.
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
    <TabNav
      label="Pages des statistiques"
      current={current}
      items={STATS_PAGES.map((p) => ({
        key: p.key,
        href: statsHref(p.path, filters),
        label: p.label,
      }))}
      className={className}
    />
  );
}

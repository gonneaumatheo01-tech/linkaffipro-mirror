import { StatCard } from "@/components/admin/stat-card";
import { fmtNum } from "@/lib/format";
import { comparisonLabel, gainsHint, gainsValue, type HomeFigures } from "@/lib/home/figures";

/** Période des pages Statistiques ouvertes depuis l'accueil (chiffres du jour). */
export const STATS_TODAY_HREF = "/stats?range=today";

/**
 * Les trois chiffres du jour (heure de Paris) avec leur variation par rapport à hier : membres arrivés, premiers
 * dépôts, gains du jour (nos commissions − dépense pub, décomposés en petit sous le chiffre : « commissions X € − pub
 * Y € »). Même définition que « Campagnes actives », les Statistiques et les rapports. Chaque carte ouvre sa page.
 * Variation : règle unique du site (`comparableVariation`) : « nouveau » quand hier valait 0, rien si les deux valent
 * 0, pas de pourcentage quand hier était en perte (la valeur d'hier est écrite sous les gains), sinon le pourcentage
 * (plafonné à ±999 %).
 */
export function TodayCards({ figures }: { figures: HomeFigures }) {
  const comparison = comparisonLabel();
  // Téléphone : les deux compteurs côte à côte (sans icône, le libellé tient sur deux lignes), les gains et leur
  // décomposition sur toute la largeur.
  return (
    <section
      aria-label="Chiffres du jour"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4"
    >
      <StatCard
        label="Membres arrivés aujourd'hui"
        value={fmtNum(figures.members.value)}
        variation={figures.members.variation}
        comparison={comparison}
        href="/members"
      />
      <StatCard
        label="Premiers dépôts aujourd'hui"
        term="FTD"
        value={fmtNum(figures.ftds.value)}
        variation={figures.ftds.variation}
        comparison={comparison}
        href={STATS_TODAY_HREF}
      />
      <StatCard
        label="Gains du jour"
        value={gainsValue(figures.breakdown)}
        variation={figures.gains.variation}
        comparison={comparison}
        hint={gainsHint(figures)}
        href={STATS_TODAY_HREF}
        className="col-span-2 sm:col-span-1"
      />
    </section>
  );
}

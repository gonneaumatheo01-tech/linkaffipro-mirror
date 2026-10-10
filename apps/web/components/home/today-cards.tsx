import { StatCard } from "@/components/admin/stat-card";
import { fmtNum } from "@/lib/format";
import {
  comparisonLabel,
  profitBreakdown,
  profitValue,
  type HomeFigures,
} from "@/lib/home/figures";

/** Période des pages Statistiques ouvertes depuis l'accueil (chiffres du jour). */
export const STATS_TODAY_HREF = "/stats?range=today";

/**
 * Les trois chiffres du jour (heure de Paris) avec leur variation par rapport à hier : membres arrivés, premiers
 * dépôts, bénéfice du jour (dépôts + revenu net − dépense pub, décomposé sous le chiffre). Chaque carte ouvre sa page.
 */
export function TodayCards({ figures }: { figures: HomeFigures }) {
  const comparison = comparisonLabel();
  // Téléphone : les deux compteurs côte à côte (sans icône, le libellé tient sur deux lignes), le bénéfice et sa
  // décomposition sur toute la largeur.
  return (
    <section
      aria-label="Chiffres du jour"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4"
    >
      <StatCard
        label="Membres arrivés aujourd'hui"
        value={fmtNum(figures.members.value)}
        delta={figures.members.delta}
        comparison={comparison}
        href="/members"
      />
      <StatCard
        label="Premiers dépôts aujourd'hui"
        term="FTD"
        value={fmtNum(figures.ftds.value)}
        delta={figures.ftds.delta}
        comparison={comparison}
        href={STATS_TODAY_HREF}
      />
      <StatCard
        label="Bénéfice du jour"
        value={profitValue(figures.breakdown)}
        delta={figures.profit.delta}
        comparison={comparison}
        hint={profitBreakdown(figures.breakdown)}
        href={STATS_TODAY_HREF}
        className="col-span-2 sm:col-span-1"
      />
    </section>
  );
}

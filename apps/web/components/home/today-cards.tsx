import { StatCard } from "@/components/admin/stat-card";
import { fmtNum } from "@/lib/format";
import {
  comparisonLabel,
  homeMoney,
  previousHint,
  profitBreakdown,
  profitValue,
  type HomeFigure,
  type HomeFigures,
} from "@/lib/home/figures";

/** Période des pages Statistiques ouvertes depuis l'accueil (chiffres du jour). */
export const STATS_TODAY_HREF = "/stats?range=today";

/**
 * Variation passée à la carte : sans pourcentage possible (hier valait 0), pas de ligne « Pas de comparaison
 * possible » ; la valeur d'hier est écrite dessous à la place (`previousHint`).
 */
function deltaOf(f: HomeFigure): number | undefined {
  return f.delta ?? undefined;
}

/**
 * Les trois chiffres du jour (heure de Paris) avec leur variation par rapport à hier : membres arrivés, premiers
 * dépôts, bénéfice du jour (dépôts + revenu net − dépense pub, décomposé sous le chiffre). Chaque carte ouvre sa page.
 * Le libellé « dépôts compris » distingue ce bénéfice de celui des campagnes (revenu net − dépense pub), affiché plus
 * bas dans « Campagnes actives ».
 */
export function TodayCards({ figures }: { figures: HomeFigures }) {
  const comparison = comparisonLabel();
  const profitBefore = previousHint(figures.profit, (n) => homeMoney(n));
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
        delta={deltaOf(figures.members)}
        comparison={comparison}
        hint={previousHint(figures.members, fmtNum)}
        href="/members"
      />
      <StatCard
        label="Premiers dépôts aujourd'hui"
        term="FTD"
        value={fmtNum(figures.ftds.value)}
        delta={deltaOf(figures.ftds)}
        comparison={comparison}
        hint={previousHint(figures.ftds, fmtNum)}
        href={STATS_TODAY_HREF}
      />
      <StatCard
        label="Bénéfice du jour (dépôts compris)"
        value={profitValue(figures.breakdown)}
        delta={deltaOf(figures.profit)}
        comparison={comparison}
        hint={
          profitBefore ? (
            <>
              <span className="block">{profitBefore}</span>
              <span className="block">{profitBreakdown(figures.breakdown)}</span>
            </>
          ) : (
            profitBreakdown(figures.breakdown)
          )
        }
        href={STATS_TODAY_HREF}
        className="col-span-2 sm:col-span-1"
      />
    </section>
  );
}

import { Fragment } from "react";
import { hasResults, resultsParts, type RuleResults } from "@/lib/automations/results";
import { compactMoney } from "@/lib/campaigns/cards";

/**
 * Résultats d'une relance en une ligne de carte (« Depuis le début : 12 envoyés · 7 clics · 4 inscriptions · 3 premiers
 * dépôts · 50 € de gains ») : chaque morceau reste entier, la ligne passe à la ligne entre deux morceaux (téléphone).
 * `attribution: false` (relance sans bouton Offre) : les envoyés seulement. `label` : « Depuis le début » ou « Depuis le
 * 11 oct. » (relance plus ancienne que le suivi par relance, voir `resultsSinceLabel`).
 */
export function RuleResultsLine({
  results,
  attribution = true,
  label = "Depuis le début",
}: {
  results: RuleResults;
  attribution?: boolean;
  label?: string;
}) {
  const parts = resultsParts(results, compactMoney, { attribution });
  return (
    <p className="text-note text-muted-foreground">
      <span className="sr-only">Résultats {label.toLowerCase()} : </span>
      <span aria-hidden>{label} : </span>
      {parts.map((p, i) => (
        <Fragment key={p.words}>
          {i > 0 ? <span aria-hidden> · </span> : null}
          <span className="whitespace-nowrap">
            <span className="font-semibold text-foreground tabular-nums">{p.figure}</span> {p.words}
          </span>
        </Fragment>
      ))}
    </p>
  );
}

/** Ligne de résultats, ou « Pas encore de résultat » tant que rien n'est venu (pas de rangée de zéros). */
export function RuleResultsSummary(props: {
  results: RuleResults;
  attribution: boolean;
  label: string;
}) {
  if (!hasResults(props.results))
    return <p className="text-note text-muted-foreground">Pas encore de résultat</p>;
  return <RuleResultsLine {...props} />;
}

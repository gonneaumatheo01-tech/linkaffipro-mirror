/**
 * Cellules des fichiers CSV (Statistiques → Pubs, et Campagnes) : règles pures, testées dans export-cells.test.ts.
 * Les en-têtes restent dans les routes d'export (`…/export/route.ts`), seule place où le terme technique est permis
 * entre parenthèses après le mot du client (un fichier n'a pas de survol).
 */
import { comparableDelta } from "./display";

/** Format d'une cellule : montant au centime, rapport à 2 décimales, nombre tel quel. */
export type ExportFormat = "money" | "ratio" | "number";

/**
 * Valeur d'une cellule de l'export Pubs : montant au centime (« 12.50 »), rapport à 2 décimales (le calcul garde le
 * rapport exact, seul le fichier l'arrondit), nombre tel quel ; vide si non calculable.
 */
export function adsExportCell(v: number | null | undefined, format: ExportFormat): string | number {
  if (v === null || v === undefined || !Number.isFinite(v)) return "";
  return format === "number" ? v : v.toFixed(2);
}

/**
 * Variation en % écrite dans un export : la règle unique du site (`comparableDelta`) : vide sur une base négative
 * (gains ou revenu net d'avant en perte), son signe tromperait.
 */
export function exportDelta(
  delta: number | null | undefined,
  previous: number | null | undefined,
): number | null {
  return comparableDelta(delta, previous);
}

/**
 * En-têtes d'un export : « (CPA, … ) » ne doit désigner qu'une colonne, le coût par inscription (« CPA » veut dire
 * « coût par inscription » dans ce produit ; les primes des joueurs sont la « commission CPA »). Renvoie les en-têtes
 * fautifs (vide = conforme).
 */
export function ambiguousCpaHeaders(labels: readonly string[]): string[] {
  const tagged = labels.filter((l) => l.includes("(CPA,"));
  const ok = tagged.length <= 1 && tagged.every((l) => /^Coût par inscription \(CPA,/.test(l));
  return ok ? [] : tagged;
}

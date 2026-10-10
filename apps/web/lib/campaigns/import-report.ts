/**
 * Historique des imports CSV : lecture du rapport d'un import (règles pures, testées dans import-report.test.ts).
 * Les lignes ignorées sont enregistrées en texte (« Ligne 12 : date illisible « n/a » ») dans `ImportBatch.errors`.
 */

/** Lignes d'erreur d'un import (champ JSON libre) : seulement les textes. */
export function importErrorLines(errors: unknown): string[] {
  return Array.isArray(errors) ? errors.filter((e): e is string => typeof e === "string") : [];
}

/**
 * Regroupe les lignes ignorées par raison (« Ligne 12 : date illisible « n/a » » → « date illisible »), de la plus
 * fréquente à la moins fréquente (ordre d'apparition en cas d'égalité). Une ligne d'un autre format compte comme
 * « erreur à l'enregistrement ».
 */
export function groupImportErrors(
  lines: readonly string[],
): Array<{ reason: string; count: number }> {
  const reasons = new Map<string, number>();
  for (const line of lines) {
    const m = /^Ligne \d+ : ([^«]+?)(?: «.*)?$/.exec(line);
    const reason = m ? m[1]!.trim() : "erreur à l'enregistrement";
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  return [...reasons.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

/** Lignes ignorées d'un import (jamais négatif). */
export function ignoredRows(b: { rows: number; imported: number }): number {
  return Math.max(0, b.rows - b.imported);
}

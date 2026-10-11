/**
 * Graphiques de comparaison des messages (test A/B, catégories) : mesures et classement, affichés en barres
 * horizontales par `BarList` (components/charts, longueur des barres : `barPercent`). Fonctions pures, testées dans
 * compare.test.ts.
 */
import type { CategoryRow } from "./category-stats";

/** Variante d'un test A/B (chiffres de `PostStats`). */
export type AbVariantFigures = {
  variant: string;
  views: number;
  clicks: number;
  uniqueClickers: number;
  registrations: number;
  ftds: number;
};

export type AbMetricRow = {
  key: "uniqueClickers" | "clicks" | "ctr" | "registrations" | "ftds";
  label: string;
  term?: string;
  values: Array<{ variant: string; value: number }>;
  /** Version en tête sur cette mesure (null : égalité ou rien encore). */
  leader: string | null;
};

/**
 * Mesures du graphique A/B, dans l'ordre de lecture : personnes qui ont cliqué, clics, taux de clic (seulement si
 * toutes les versions ont des vues), inscriptions, premiers dépôts.
 */
export function abMetricRows(variants: AbVariantFigures[]): AbMetricRow[] {
  const withViews = variants.length > 0 && variants.every((v) => v.views > 0);
  const defs: Array<{
    key: AbMetricRow["key"];
    label: string;
    term?: string;
    get: (v: AbVariantFigures) => number;
  }> = [
    { key: "uniqueClickers", label: "Personnes qui ont cliqué", get: (v) => v.uniqueClickers },
    { key: "clicks", label: "Clics", get: (v) => v.clicks },
    ...(withViews
      ? [
          {
            key: "ctr" as const,
            label: "Taux de clic",
            term: "CTR",
            get: (v: AbVariantFigures) => v.uniqueClickers / v.views,
          },
        ]
      : []),
    { key: "registrations", label: "Inscriptions", get: (v) => v.registrations },
    { key: "ftds", label: "Premiers dépôts", term: "FTD", get: (v) => v.ftds },
  ];
  return defs.map((d) => {
    const values = variants.map((v) => ({ variant: v.variant, value: d.get(v) }));
    const max = Math.max(0, ...values.map((x) => x.value));
    const top = values.filter((x) => x.value === max);
    return {
      key: d.key,
      label: d.label,
      term: d.term,
      values,
      leader: max > 0 && top.length === 1 ? top[0]!.variant : null,
    };
  });
}

/** Mesures proposées pour comparer les catégories (moyenne par message envoyé). */
export const CATEGORY_MEASURES = [
  { key: "clicks", label: "Clics par message" },
  { key: "registrations", label: "Inscriptions par message" },
  { key: "ftds", label: "Premiers dépôts par message", term: "FTD" },
  { key: "depositAmount", label: "Montant déposé par message" },
] as const;
export type CategoryMeasure = (typeof CATEGORY_MEASURES)[number]["key"];

export function toCategoryMeasure(v: unknown): CategoryMeasure {
  return CATEGORY_MEASURES.some((m) => m.key === v) ? (v as CategoryMeasure) : "clicks";
}

/** Catégories classées pour le graphique : celles qui ont des messages, de la meilleure moyenne à la moins bonne. */
export function rankCategories(rows: CategoryRow[], measure: CategoryMeasure): CategoryRow[] {
  return rows
    .filter((r) => r.posts > 0)
    .sort(
      (a, b) =>
        b.avg[measure] - a.avg[measure] || b.posts - a.posts || a.name.localeCompare(b.name, "fr"),
    );
}

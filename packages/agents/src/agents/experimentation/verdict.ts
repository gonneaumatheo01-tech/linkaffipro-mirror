/**
 * Verdict d'un test A/B (pur) : taille minimale par variante, puis test de deux proportions (taux de clic offre,
 * inscriptions pour les vues, taux de réponse) ou de deux moyennes (vues à 24 h) au seuil `alpha` (5 %).
 * « A gagne », « B gagne » ou « pas de différence » ; « pas assez de données » tant que la taille n'est pas atteinte.
 */
import { round } from "../../algo/math";
import { twoMeanTest, twoProportionTest } from "./stats";

export const EXPERIMENT_METRICS = ["offer_ctr", "views24h", "reply_rate", "registrations"] as const;
export type ExperimentMetric = (typeof EXPERIMENT_METRICS)[number];

export const METRIC_LABELS: Record<ExperimentMetric, string> = {
  offer_ctr: "taux de clic sur l'offre",
  views24h: "vues à 24 h",
  reply_rate: "taux de réponse",
  registrations: "inscriptions pour 1000 vues",
};

/** Données d'une variante : `samples` = posts (ou conversations) ; succès / essais pour une proportion ; valeurs pour une moyenne. */
export type VariantData = { samples: number; successes?: number; trials?: number; values?: number[] };

export type ExperimentVerdict = {
  status: "insufficient" | "decided";
  winner: "A" | "B" | "NONE" | null;
  p: number | null;
  test: "proportions" | "means";
  A: { samples: number; value: number | null };
  B: { samples: number; value: number | null };
};

export function isProportionMetric(m: string): boolean {
  return m !== "views24h";
}

function valueOf(metric: string, d: VariantData): number | null {
  if (isProportionMetric(metric)) {
    if (!d.trials) return null;
    const r = (d.successes ?? 0) / d.trials;
    return round(metric === "registrations" ? r * 1000 : r, 5);
  }
  const v = d.values ?? [];
  return v.length ? round(v.reduce((s, x) => s + x, 0) / v.length, 2) : null;
}

export function experimentVerdict(
  metric: string,
  A: VariantData,
  B: VariantData,
  o: { minSamples: number; alpha: number },
): ExperimentVerdict {
  const test = isProportionMetric(metric) ? "proportions" : "means";
  const base = {
    test,
    A: { samples: A.samples, value: valueOf(metric, A) },
    B: { samples: B.samples, value: valueOf(metric, B) },
  } as const;
  if (A.samples < o.minSamples || B.samples < o.minSamples) return { ...base, status: "insufficient", winner: null, p: null };
  const r =
    test === "proportions"
      ? twoProportionTest(A.successes ?? 0, A.trials ?? 0, B.successes ?? 0, B.trials ?? 0)
      : twoMeanTest(A.values ?? [], B.values ?? []);
  if (!r) return { ...base, status: "insufficient", winner: null, p: null };
  const p = round(r.p, 6);
  const winner = r.p < o.alpha && r.diff !== 0 ? (r.diff > 0 ? "A" : "B") : "NONE";
  return { ...base, status: "decided", winner, p };
}

/** Phrase du verdict (journal, rapport). */
export function verdictSentence(v: ExperimentVerdict, metric: string): string {
  const label = METRIC_LABELS[metric as ExperimentMetric] ?? metric;
  if (v.status === "insufficient") return `pas encore assez de données (${v.A.samples} / ${v.B.samples})`;
  if (v.winner === "NONE") return `pas de différence nette sur le ${label} (p = ${v.p})`;
  return `${v.winner} gagne sur le ${label} (p = ${v.p})`;
}

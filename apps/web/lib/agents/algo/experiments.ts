/**
 * Tests A/B de l'équipe Algorithme à l'écran (phase 21) : type, mesure, versions, chiffres et verdict en mots.
 * Lecture tolérante des champs écrits par l'agent Expérimentation (`variants`, `result`). Le seuil statistique du
 * moteur n'est jamais montré : seul le verdict (« A gagne », « B gagne », « pas de différence ») l'est.
 */

export type ExperimentView = {
  id: string;
  teamKey: string;
  channelId: string | null;
  personaId: string | null;
  kind: string;
  hypothesis: string;
  variants: unknown;
  metric: string;
  minSamples: number;
  status: string;
  startedAt: Date | null;
  endsAt: Date | null;
  closedAt: Date | null;
  result: unknown;
  winner: string | null;
  createdAt: Date;
  /** Canal ou persona du test, résolu par la requête. */
  targetLabel: string | null;
};

export const METRIC_LABELS: Record<string, { label: string; kind: "pct" | "num" }> = {
  offer_ctr: { label: "taux de clic sur l'offre", kind: "pct" },
  views24h: { label: "vues à 24 h", kind: "num" },
  reply_rate: { label: "taux de réponse", kind: "pct" },
  registrations: { label: "inscriptions", kind: "num" },
};

export function metricLabel(metric: string): string {
  return METRIC_LABELS[metric]?.label ?? metric;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Libellé d'une version (« Légende en question », « 19 h »…). */
export function variantLabel(variants: unknown, side: "A" | "B"): string {
  const v = isObj(variants) ? variants[side] : null;
  if (typeof v === "string") return v.slice(0, 120);
  if (isObj(v)) {
    const s = str(v.label) ?? str(v.name) ?? str(v.description);
    if (s) return s.slice(0, 120);
  }
  return `Version ${side}`;
}

export type SideResult = { n: number | null; value: number | null };

/** Effectif et valeur mesurée d'une version, quelle que soit la forme écrite par le moteur. */
export function sideResult(result: unknown, side: "A" | "B"): SideResult {
  if (!isObj(result)) return { n: null, value: null };
  const inner = isObj(result[side]) ? (result[side] as Record<string, unknown>) : isObj(result.variants) && isObj((result.variants as Record<string, unknown>)[side]) ? ((result.variants as Record<string, unknown>)[side] as Record<string, unknown>) : null;
  if (inner)
    return {
      n: num(inner.n) ?? num(inner.samples) ?? num(inner.count) ?? num(inner.posts),
      value: num(inner.rate) ?? num(inner.mean) ?? num(inner.value),
    };
  return {
    n: num(result[`n${side}`]),
    value: num(result[`rate${side}`]) ?? num(result[`mean${side}`]) ?? num(result[`value${side}`]),
  };
}

export function metricValueText(metric: string, v: number | null): string {
  if (v === null) return "—";
  return METRIC_LABELS[metric]?.kind === "pct"
    ? `${(v * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`
    : v.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
}

/** Verdict d'un test clos ; null tant qu'il n'est pas clos. */
export function verdictText(e: Pick<ExperimentView, "status" | "winner">): string | null {
  if (e.status !== "CLOSED") return null;
  if (e.winner === "A") return "La version A gagne";
  if (e.winner === "B") return "La version B gagne";
  return "Pas de différence nette entre les deux versions";
}

/** Avancement d'un test en cours : « 12 et 9 cas sur 20 minimum par version ». */
export function progressText(e: Pick<ExperimentView, "result" | "minSamples">): string {
  const a = sideResult(e.result, "A").n ?? 0;
  const b = sideResult(e.result, "B").n ?? 0;
  return `${a.toLocaleString("fr-FR")} et ${b.toLocaleString("fr-FR")} cas mesurés, ${e.minSamples.toLocaleString("fr-FR")} au moins par version`;
}

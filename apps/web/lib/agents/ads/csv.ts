/**
 * Exports CSV de la page Agent Ads (`/agents/ads/export`) : recommandations (cible, action, preuves, état, commentaire)
 * ou chiffres de la période (une ligne par campagne, groupe et pub). Règles pures, testées (ads.test.ts).
 */
import type { AdsAnalysis, AdsRow } from "@linkaffipro/agents";
import { csvDate, csvNumber, toCsv } from "@/lib/members/csv";
import { statusLabel } from "@/lib/status-badges";
import { universeLabel } from "@/lib/universe";
import { ADS_METRIC_VIEWS, adsEvidenceLines, bottleneckStep, adsTargetLabel, type AdsMetricKey, type AdsRecommendationView } from "./display";

export const RECOMMENDATIONS_CSV_HEADERS = [
  "Proposée le (Paris)",
  "Univers",
  "Cible",
  "Nom",
  "Action conseillée",
  "Preuves",
  "Gain attendu",
  "État",
  "Commentaire",
  "Faite le (Paris)",
  "Refusée le (Paris)",
  "Identifiant",
];

export function recommendationsCsv(recs: readonly AdsRecommendationView[]): string {
  return toCsv(
    RECOMMENDATIONS_CSV_HEADERS,
    recs.map((r) => [
      csvDate(r.createdAt),
      r.vertical ? universeLabel(r.vertical) : "",
      adsTargetLabel(r.target),
      r.targetLabel,
      r.action ? statusLabel("adsAction", r.action) : "",
      adsEvidenceLines(r.evidence).join(" · "),
      r.expectedGain ?? "",
      statusLabel("recommendation", r.status),
      r.comment ?? "",
      csvDate(r.doneAt),
      csvDate(r.rejectedAt),
      r.id,
    ]),
  );
}

/** Colonnes de chiffres de l'export, dans l'ordre du parcours puis de l'argent. */
export const FIGURES_KEYS: AdsMetricKey[] = [
  "spend",
  "impressions",
  "adClicks",
  "landingVisits",
  "telegramJoins",
  "members",
  "offerClicks",
  "registrations",
  "ftds",
  "deposits",
  "commissions",
  "gains",
  "roas",
  "costPerMember",
  "costPerRegistration",
  "costPerFtd",
];

const LEVEL_LABELS: Record<AdsRow["level"], string> = { campaign: "Campagne", adset: "Groupe de pubs", ad: "Pub" };

function unit(key: AdsMetricKey): string {
  const f = ADS_METRIC_VIEWS[key].format;
  return f === "money" ? " (€)" : f === "ratio" ? " (×)" : "";
}

export const FIGURES_CSV_HEADERS = [
  "Du",
  "Au",
  "Niveau",
  "Nom",
  "Univers",
  ...FIGURES_KEYS.map((k) => `${ADS_METRIC_VIEWS[k].label}${unit(k)}`),
  ...FIGURES_KEYS.map((k) => `${ADS_METRIC_VIEWS[k].label}, période d'avant${unit(k)}`),
  "Assez de chiffres pour juger",
  "Étape la plus faible",
  "Identifiant",
];

function cell(key: AdsMetricKey, v: number | null | undefined): string {
  const f = ADS_METRIC_VIEWS[key].format;
  return csvNumber(v, f === "number" && ADS_METRIC_VIEWS[key].integer ? 0 : 2);
}

function bottleneckLabel(b: string | null): string {
  const k = bottleneckStep(b);
  return k ? ADS_METRIC_VIEWS[k].label : "";
}

export function figuresCsv(a: Pick<AdsAnalysis, "from" | "to" | "rows">): string {
  const order: Record<AdsRow["level"], number> = { campaign: 0, adset: 1, ad: 2 };
  const rows = [...a.rows].sort((x, y) => order[x.level] - order[y.level] || y.current.spend - x.current.spend);
  return toCsv(
    FIGURES_CSV_HEADERS,
    rows.map((r) => [
      a.from.slice(0, 10),
      a.to.slice(0, 10),
      LEVEL_LABELS[r.level],
      r.name,
      r.vertical ? universeLabel(r.vertical) : "",
      ...FIGURES_KEYS.map((k) => cell(k, r.current[k])),
      ...FIGURES_KEYS.map((k) => cell(k, r.previous[k])),
      r.enoughData ? "oui" : "non",
      bottleneckLabel(r.bottleneck),
      r.id,
    ]),
  );
}

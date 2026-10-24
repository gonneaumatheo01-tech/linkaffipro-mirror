/**
 * Contrats de l'Agent Ads (phase 24). Signatures FIGÉES : A (moteur, règles, rapports, alertes), C (site).
 * L'agent RECOMMANDE, il n'agit jamais chez Meta / TikTok (aucune fonction d'écriture n'existe).
 */
import type { PrismaClient } from "@linkaffipro/db";
import type { AgentsDeps, AgentsPrisma } from "../types";
import { computeAdsAnalysisImpl } from "../agents/ads/analysis";
import { markAdsRecommendationImpl } from "../agents/ads/recommendations";
import type { ActorRef } from "../admin/team";

export type AdsPeriod = "yesterday" | "7d" | "28d";

export type AdsMetrics = {
  spend: number;
  impressions: number;
  adClicks: number;
  landingVisits: number;
  telegramJoins: number;
  members: number;
  offerClicks: number;
  registrations: number;
  ftds: number;
  deposits: number;
  commissions: number;
  /** commissions − dépense. */
  gains: number;
  /** commissions ÷ dépense (null sans dépense). */
  roas: number | null;
  costPerMember: number | null;
  costPerRegistration: number | null;
  costPerFtd: number | null;
};

export type AdsRow = {
  level: "campaign" | "adset" | "ad";
  id: string;
  name: string;
  vertical: string | null;
  campaignId: string | null;
  current: AdsMetrics;
  previous: AdsMetrics;
  /** Variations par chiffre (`comparableVariation` de core). */
  variations: Partial<Record<keyof AdsMetrics, unknown>>;
  /** Étape la plus faible de l'entonnoir, si assez de données. */
  bottleneck: string | null;
  /** Trop jeune ou trop peu de dépense pour conclure. */
  enoughData: boolean;
};

export type AdsAnalysis = {
  period: AdsPeriod;
  from: string;
  to: string;
  /** Aucun connecteur Meta / TikTok branché : coûts importés ou saisis seulement. */
  connectorsMissing: boolean;
  totals: AdsMetrics;
  rows: AdsRow[];
  /** Ce que rapportent les membres acquis par chaque pub après 7, 14 et 30 jours. */
  cohorts: { adId: string; name: string; d7: number; d14: number; d30: number; members: number }[];
};

/** Analyse complète (logique programmée, chiffres des fonctions existantes). Chantier A. */
export async function computeAdsAnalysis(
  prisma: PrismaClient,
  q: { period: AdsPeriod; now?: Date },
): Promise<AdsAnalysis> {
  return computeAdsAnalysisImpl(prisma as unknown as AgentsPrisma, q);
}

/** Le client marque une recommandation « Fait » ou « Refusé » (avec commentaire) ; AuditLog. Chantier A. */
export async function markAdsRecommendation(
  deps: AgentsDeps,
  input: { id: string; status: "DONE" | "REJECTED"; comment?: string | null },
  actor: ActorRef,
): Promise<{ ok: boolean; message: string }> {
  return markAdsRecommendationImpl(deps, input, actor);
}

/** Seuils par univers (`Setting` `agents.ads.thresholds`). */
export type AdsThresholds = Record<
  "CASINO" | "SPORTS" | "DATING",
  { targetCostPerRegistration: number | null; minRoas: number | null; observationDays: number; minSpend: number }
>;

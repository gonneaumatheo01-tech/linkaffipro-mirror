/**
 * Résumé de supervision (phase 25, CONTRAT ; propriétaire : chantier A). Une seule source pour la page /agents, la
 * carte « Agents » de l'État du système, la commande « agents » du bot et `pnpm agents:status`.
 */
import type { PrismaClient } from "@linkaffipro/db";

export type TeamOverview = {
  teamKey: string;
  label: string;
  enabled: boolean;
  simulation: boolean;
  paused: boolean;
  autonomyLevel: number;
  today: { created: number; published: number; waiting: number; rejected: number; failed: number; fallbacks: number };
  /** Dépense du mois par poste (centimes), plafond, projection à fin de mois. */
  spend: { provider: string; cents: number; capCents: number | null; projectedCents: number }[];
  /** Résultats des posts produits par l'équipe (mêmes règles que Statistiques). */
  results: Record<"d7" | "d28", { posts: number; views: number; clicks: number; registrations: number; ftds: number; commissions: number }>;
};

export type AgentsOverview = {
  at: string;
  pausedAll: boolean;
  teams: TeamOverview[];
  ads: { paused: boolean; openRecommendations: number; lastReportAt: string | null };
  algoAppliedThisWeek: { id: string; teamKey: string; field: string; targetLabel: string; appliedAt: string }[];
  experimentsRunning: number;
  openAlerts: number;
  openHumanRequests: number;
  pendingValidations: number;
  health: {
    lastGrandChefAt: string | null;
    stuckMissions: number;
    providers: { key: string; label: string; keyPresent: boolean; lastOkAt: string | null; errors24h: number }[];
  };
};

export async function agentsOverview(_prisma: PrismaClient, _opts?: { now?: Date }): Promise<AgentsOverview> {
  throw new Error("agentsOverview : à écrire (chantier A)");
}

/** Résumé en 8 lignes au plus (commande « agents », `pnpm agents:status`). */
export function overviewLines(_o: AgentsOverview): string[] {
  throw new Error("overviewLines : à écrire (chantier A)");
}

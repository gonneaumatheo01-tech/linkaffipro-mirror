/**
 * Contrats de l'équipe Paris sportifs (phase 23). Signatures FIGÉES : A (cotes, sélection, chaîne, résultats), C (site).
 * Les captures automatiques des sites (chantier B) sont retirées depuis le 28 octobre 2026.
 */
import type { PrismaClient } from "@linkaffipro/db";
import type { AgentsDeps } from "../types";
import type { CreateMissionResult } from "../missions/lifecycle";
import { computeBetSummary } from "./summary";
import { createTestBet } from "./test-bet";

/** « Produire un pari de test » : faux fournisseur de cotes, page locale, simulation, canal Test. Chantier A. */
export async function createTestBetMission(
  deps: AgentsDeps,
  input: { categoryId?: string | null; byUserId: string | null },
): Promise<CreateMissionResult> {
  return createTestBet(deps, input);
}

export type BetSummaryRow = {
  /** Clé de regroupement (catégorie, ligue, bookmaker ou semaine). */
  key: string;
  label: string;
  published: number;
  won: number;
  lost: number;
  void: number;
  /** Gagnés ÷ (gagnés + perdus). */
  hitRate: number | null;
  avgOdds: number | null;
  /** Rendement à mise constante : (somme des gains − mises) ÷ mises. */
  roi: number | null;
};

/** Bilan des paris publiés sur la période. Chantier A. */
export async function betSummary(
  prisma: PrismaClient,
  q: { from: Date; to: Date; by: "category" | "league" | "bookmaker" | "week" },
): Promise<BetSummaryRow[]> {
  return computeBetSummary(prisma as never, q);
}

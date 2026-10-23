/**
 * Contrats de l'équipe Paris sportifs (phase 23). Signatures FIGÉES : A (cotes, sélection, chaîne, résultats),
 * B (captures, bookmakers, parade anti-blocage), C (site).
 */
import type { PrismaClient } from "@linkaffipro/db";
import type { AgentsDeps } from "../types";
import type { CreateMissionResult } from "../missions/lifecycle";
import type { CaptureResult } from "../providers/screenshot";

/** « Produire un pari de test » : faux fournisseur de cotes, page locale, simulation, canal Test. Chantier A. */
export async function createTestBetMission(
  _deps: AgentsDeps,
  _input: { categoryId?: string | null; byUserId: string | null },
): Promise<CreateMissionResult> {
  throw new Error("createTestBetMission : à écrire (chantier A)");
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
  _prisma: PrismaClient,
  _q: { from: Date; to: Date; by: "category" | "league" | "bookmaker" | "week" },
): Promise<BetSummaryRow[]> {
  throw new Error("betSummary : à écrire (chantier A)");
}

/** « Tester la connexion » d'un bookmaker (identifiants du client, session chiffrée) ; résultat sans secret. Chantier B. */
export async function testBookmakerConnection(
  _deps: AgentsDeps,
  _bookmaker: string,
): Promise<{ result: CaptureResult; assetId: string | null; message: string }> {
  throw new Error("testBookmakerConnection : à écrire (chantier B)");
}

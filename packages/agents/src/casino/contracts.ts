/**
 * Contrats de l'équipe Casino (phase 22). Signatures FIGÉES : A (moteur, stock, chaîne), B (dépôt par le bot,
 * classement), C (site). Pas de migration : un média casino porte son thème principal dans `MediaAsset.theme` et tous
 * ses thèmes dans `MediaAsset.tags` (`["theme:roulette", "theme:bonus"]`) ; « à classer » = `teamKey = "casino"`,
 * `theme = null`, tag `"a-classer"`. Les thèmes de l'équipe vivent dans `AgentTeamConfig.settings.casino.themes`.
 */
import type { PrismaClient } from "@linkaffipro/db";
import type { AgentsDeps } from "../types";
import type { ActorRef } from "../admin/team";

/** Thèmes de départ de l'équipe Casino (clés ASCII ; libellés affichés par le site). */
export const CASINO_DEFAULT_THEMES = [
  "machines-a-sous",
  "roulette",
  "blackjack",
  "bonus",
  "jackpot",
  "live",
  "tournoi",
  "cashback",
  "ambiance",
] as const;

export type CasinoStockRow = {
  channelId: string;
  channelTitle: string;
  theme: string;
  /** Médias fournis (origin HUMAN) de ce thème non utilisés sur ce canal depuis la durée de rotation. */
  unused: number;
  /** « manque » sous le seuil (3 par défaut, `settings.casino.lowStock`). */
  state: "ok" | "low" | "empty";
};

/** Stock par canal casino (plan activé ou non) et par thème du canal. Chantier A. */
export async function casinoStock(
  prisma: PrismaClient,
  opts?: { now?: Date; channelId?: string },
): Promise<CasinoStockRow[]> {
  // Import différé : stock → settings → contracts formerait un cycle au chargement (CASINO_DEFAULT_THEMES).
  const { computeCasinoStock } = await import("./stock");
  return computeCasinoStock(prisma, opts);
}

/** Classe un média « à classer » (ou en change les thèmes) : thèmes connus seulement ; AuditLog. Chantier B. */
export async function classifyCasinoMedia(
  deps: AgentsDeps,
  input: { assetId: string; themes: string[] },
  actor: ActorRef,
): Promise<{ ok: boolean; message: string }> {
  // Import différé : classify → settings → contracts formerait un cycle au chargement (CASINO_DEFAULT_THEMES).
  const { classifyCasinoMediaImpl } = await import("./classify");
  return classifyCasinoMediaImpl(deps, input, actor);
}

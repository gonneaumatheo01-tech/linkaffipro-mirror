/**
 * Règlement d'un pari après le match (phase 23, règle PURE) : gagné, perdu ou annulé (remboursé) selon le type de
 * marché : plus / moins sur la ligne (égalité = remboursé), oui / non, résultat 1N2 ou à 2 issues, handicap. Match
 * annulé = remboursé. Résultat pas encore connu = null (on relira plus tard).
 */
import type { OddsResult } from "../providers/odds";
import { parseMarketId } from "../sports/labels";

export type SettleOutcome = "WON" | "LOST" | "VOID";

/** Valeur d'une statistique dans `OddsResult.stats` (`<période>.<entité>.<stat>`), `all` = domicile + extérieur. */
export function statValue(result: Pick<OddsResult, "stats" | "homeScore" | "awayScore">, statId: string, entity: string, period: string): number | null {
  const get = (p: string, e: string) => result.stats[`${p}.${e}.${statId}`];
  const read = (e: string): number | undefined => get(period, e) ?? (period === "reg" ? get("game", e) : undefined);
  const direct = read(entity);
  if (typeof direct === "number") return direct;
  if (entity === "all") {
    const h = read("home");
    const a = read("away");
    if (typeof h === "number" && typeof a === "number") return h + a;
  }
  // Buts du match sans détail : le score final suffit.
  if (statId === "points" && (period === "game" || period === "reg")) {
    if (entity === "home" && result.homeScore !== null) return result.homeScore;
    if (entity === "away" && result.awayScore !== null) return result.awayScore;
    if (entity === "all" && result.homeScore !== null && result.awayScore !== null) return result.homeScore + result.awayScore;
  }
  return null;
}

export type SettleInput = { marketId: string; line: number | null };

export type Settlement = { outcome: SettleOutcome; value: number | null; detail: string } | null;

export function settleBet(bet: SettleInput, result: OddsResult | null): Settlement {
  if (!result) return null;
  if (result.cancelled) return { outcome: "VOID", value: null, detail: "match annulé" };
  if (!result.finalized) return null;
  const p = parseMarketId(bet.marketId);
  if (!p) return null;
  const valueOf = (entity: string) => (entity === p.entity && typeof result.marketScores[bet.marketId] === "number" ? result.marketScores[bet.marketId]! : statValue(result, p.statId, entity, p.period));

  if (p.betType === "ou") {
    const v = valueOf(p.entity);
    if (v === null || bet.line === null) return null;
    if (v === bet.line) return { outcome: "VOID", value: v, detail: `${v} = ligne ${bet.line} : remboursé` };
    const over = v > bet.line;
    const won = p.side === "under" ? !over : over;
    return { outcome: won ? "WON" : "LOST", value: v, detail: `${v} pour une ligne à ${bet.line}` };
  }
  if (p.betType === "yn") {
    const v = valueOf(p.entity);
    if (v === null) return null;
    const yes = v > 0;
    return { outcome: (p.side === "no" ? !yes : yes) ? "WON" : "LOST", value: v, detail: `valeur finale ${v}` };
  }
  if (p.betType === "ml" || p.betType === "ml3way" || p.betType === "sp") {
    const h = statValue(result, p.statId, "home", p.period);
    const a = statValue(result, p.statId, "away", p.period);
    if (h === null || a === null) return null;
    const detail = `${h} - ${a}`;
    if (p.betType === "sp") {
      if (bet.line === null) return null;
      const diff = p.side === "away" ? a + bet.line - h : h + bet.line - a;
      if (diff === 0) return { outcome: "VOID", value: diff, detail: `${detail}, handicap ${bet.line} : remboursé` };
      return { outcome: diff > 0 ? "WON" : "LOST", value: diff, detail: `${detail}, handicap ${bet.line}` };
    }
    if (h === a) {
      if (p.side === "draw") return { outcome: "WON", value: 0, detail };
      // Résultat à 2 issues : le nul rembourse ; 1N2 : le nul fait perdre domicile et extérieur.
      return { outcome: p.betType === "ml" ? "VOID" : "LOST", value: 0, detail };
    }
    if (p.side === "draw") return { outcome: "LOST", value: h - a, detail };
    const homeWon = h > a;
    return { outcome: (p.side === "home" ? homeWon : !homeWon) ? "WON" : "LOST", value: h - a, detail };
  }
  return null;
}

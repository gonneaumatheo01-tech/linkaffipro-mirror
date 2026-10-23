/**
 * Bilan des paris publiés (phase 23, règle PURE) : par catégorie, ligue, bookmaker ou semaine ; taux de réussite
 * (gagnés ÷ gagnés + perdus), cote moyenne, rendement à mise constante (un remboursé ne compte ni en gain ni en mise).
 */
import type { BetSummaryRow } from "../sports/contracts";

export type SummaryPick = { key: string; label: string; status: string; odds: number };

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

export const SETTLED_OR_PUBLISHED = ["PUBLISHED", "WON", "LOST", "VOID"] as const;

export function summarizeBets(picks: readonly SummaryPick[]): BetSummaryRow[] {
  const groups = new Map<string, { label: string; rows: SummaryPick[] }>();
  for (const p of picks) {
    if (!(SETTLED_OR_PUBLISHED as readonly string[]).includes(p.status)) continue;
    const g = groups.get(p.key) ?? { label: p.label, rows: [] };
    g.rows.push(p);
    groups.set(p.key, g);
  }
  const out: BetSummaryRow[] = [];
  for (const [key, g] of groups) {
    const won = g.rows.filter((r) => r.status === "WON");
    const lost = g.rows.filter((r) => r.status === "LOST").length;
    const voided = g.rows.filter((r) => r.status === "VOID").length;
    const stakes = won.length + lost;
    const profit = won.reduce((s, r) => s + (r.odds - 1), 0) - lost;
    const odds = g.rows.map((r) => r.odds).filter((o) => o > 1);
    out.push({
      key,
      label: g.label,
      published: g.rows.length,
      won: won.length,
      lost,
      void: voided,
      hitRate: stakes ? round(won.length / stakes) : null,
      avgOdds: odds.length ? round(odds.reduce((a, b) => a + b, 0) / odds.length, 3) : null,
      roi: stakes ? round(profit / stakes) : null,
    });
  }
  return out.sort((a, b) => b.published - a.published || a.label.localeCompare(b.label, "fr"));
}

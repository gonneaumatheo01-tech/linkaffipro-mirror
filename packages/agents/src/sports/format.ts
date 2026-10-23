/**
 * Texte d'un pari (phase 23, règle PURE) : match, ligue et heure, marché et sélection, cote constatée chez le
 * bookmaker, une ou deux phrases de raisonnement tirées UNIQUEMENT des chiffres retenus (cote de référence,
 * probabilité, moyenne récente), ligne de prudence. Aucune promesse, aucun chiffre inventé : écrit par le code.
 */
import { escapeHtml } from "@linkaffipro/core";
import type { PickReasoning } from "../agents/cotes/select";
import { bookmakerLabel, frNumber, frOdds, leagueLabel, parseMarketId, statLabel } from "./labels";

export type BetPostInput = {
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoffAt: Date;
  marketId: string;
  marketLabel: string;
  selectionLabel: string;
  bookmaker: string;
  odds: number;
  reasoning: Partial<PickReasoning> | null;
  disclaimer: string;
};

const KICKOFF_FMT = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function kickoffLabel(d: Date): string {
  return KICKOFF_FMT.format(d).replace(":", " h ").replace(/\s+/g, " ");
}

/** Phrases de raisonnement (pur, chiffres du raisonnement seulement). */
export function reasoningSentences(i: Pick<BetPostInput, "bookmaker" | "odds" | "reasoning" | "marketId">): string[] {
  const r = i.reasoning ?? {};
  const out: string[] = [];
  const bk = bookmakerLabel(i.bookmaker);
  if (typeof r.consensusOdds === "number" && r.consensusOdds > 1) {
    const n = typeof r.bookmakers === "number" && r.bookmakers > 0 ? ` de ${r.bookmakers} bookmaker${r.bookmakers > 1 ? "s" : ""}` : "";
    const cmp = i.odds > r.consensusOdds * 1.005 ? "au-dessus de" : i.odds < r.consensusOdds * 0.995 ? "en dessous de" : "au niveau de";
    out.push(`La cote ${bk} (${frOdds(i.odds)}) est ${cmp} la cote de référence${n} (${frOdds(r.consensusOdds)}).`);
  }
  const parts: string[] = [];
  if (typeof r.consensusProbability === "number") parts.push(`probabilité estimée d'après les cotes : ${Math.round(r.consensusProbability * 100)} %`);
  const p = parseMarketId(i.marketId);
  if (typeof r.recentAverage === "number" && typeof r.line === "number" && p)
    parts.push(`moyenne récente : ${frNumber(r.recentAverage, 1)} ${statLabel(p.statId).toLowerCase()} par match pour une ligne à ${frNumber(r.line)}`);
  if (parts.length) out.push(`${parts.join(" ; ").replace(/^./, (c) => c.toUpperCase())}.`);
  return out.slice(0, 2);
}

export function betPostText(i: BetPostInput): string {
  const lines = [
    `⚽ <b>${escapeHtml(i.homeTeam)} – ${escapeHtml(i.awayTeam)}</b>`,
    `🏆 ${escapeHtml(leagueLabel(i.league))} · ${escapeHtml(kickoffLabel(i.kickoffAt))}`,
    `🎯 ${escapeHtml(i.marketLabel)} : <b>${escapeHtml(i.selectionLabel)}</b>`,
    `💶 Cote ${escapeHtml(bookmakerLabel(i.bookmaker))} : <b>${frOdds(i.odds)}</b>`,
  ];
  const why = reasoningSentences(i);
  if (why.length) lines.push("", `📊 ${escapeHtml(why.join(" "))}`);
  if (i.disclaimer) lines.push("", `<i>${escapeHtml(i.disclaimer)}</i>`);
  return lines.join("\n");
}

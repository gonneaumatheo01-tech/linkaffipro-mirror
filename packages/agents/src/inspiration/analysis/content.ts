/**
 * Phase 27, chantier B : fond des posts par univers (pur) et règles du client vues chez eux (`flagged`).
 * - tous : appels au VIP, prix, gratuit / payant, annonces de gains (signalées : promesse interdite chez nous) ;
 * - paris sportifs : cotes, matchs, posts de résultat, séries pari → résultat (un post de cote suivi, dans les 48 h,
 *   du premier post de résultat pas encore apparié) et leur délai médian ;
 * - casino : bonus, codes promo.
 */
import type { InspirationUniverse, Measure } from "../contract";
import { forbiddenWordsIn } from "../../rules/content";
import { median, pct } from "./stats";
import type { AnalysisPost } from "./types";

/** Délai maximal entre une annonce de pari et son résultat pour former une série. */
export const BET_SERIES_MAX_HOURS = 48;

export type BetSeries = { betId: string; resultId: string; delayMinutes: number };

/** Séries pari → résultat (pur). */
export function betSeriesOf(posts: readonly AnalysisPost[], maxHours = BET_SERIES_MAX_HOURS): BetSeries[] {
  const sorted = [...posts].sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());
  const used = new Set<string>();
  const out: BetSeries[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const bet = sorted[i]!;
    if (!bet.hasOdds || bet.isBetResult) continue;
    for (let j = i + 1; j < sorted.length; j++) {
      const r = sorted[j]!;
      const delay = (r.postedAt.getTime() - bet.postedAt.getTime()) / 60_000;
      if (delay > maxHours * 60) break;
      if (!r.isBetResult || used.has(r.id)) continue;
      used.add(r.id);
      out.push({ betId: bet.id, resultId: r.id, delayMinutes: Math.round(delay) });
      break;
    }
  }
  return out;
}

export function contentMeasures(posts: readonly AnalysisPost[], universe: InspirationUniverse): Measure[] {
  const n = posts.length;
  const share = (key: string, label: string, f: (p: AnalysisPost) => boolean): Measure => ({
    key,
    label,
    value: n ? pct(posts.filter(f).length, n) : null,
    unit: "%",
    sampleSize: n,
  });
  const out: Measure[] = [
    share("vipCallShare", "Posts avec un appel au VIP (DM, écris-moi, places limitées)", (p) => p.hasVipCall),
    share("priceShare", "Posts avec un prix", (p) => p.hasPrice),
    share("freeShare", "Posts qui parlent de gratuit", (p) => p.free),
    share("paidShare", "Posts qui parlent de payant ou d'abonnement", (p) => p.paid),
    share("gainClaimShare", "Posts qui annoncent des gains (interdit chez nous)", (p) => p.gainClaim),
  ];
  if (universe === "sports") {
    const bets = posts.filter((p) => p.hasOdds && !p.isBetResult).length;
    const series = betSeriesOf(posts);
    const delay = median(series.map((s) => s.delayMinutes));
    out.push(
      share("oddsShare", "Posts avec une cote", (p) => p.hasOdds),
      share("matchShare", "Posts qui annoncent un match", (p) => p.hasMatch),
      share("betResultShare", "Posts de résultat (✅, cote passée…)", (p) => p.isBetResult),
      { key: "betSeries", label: "Séries pari → résultat", value: series.length, unit: "séries", sampleSize: bets },
      { key: "betSeriesShare", label: "Paris suivis d'un résultat", value: bets ? pct(series.length, bets) : null, unit: "%", sampleSize: bets },
      { key: "betSeriesDelayMinutes", label: "Délai médian pari → résultat", value: delay === null ? null : Math.round(delay), unit: "min", sampleSize: series.length },
    );
  }
  if (universe === "casino")
    out.push(
      share("bonusShare", "Posts qui parlent de bonus", (p) => p.hasBonus),
      share("promoCodeShare", "Posts avec un code promo", (p) => p.hasPromoCode),
    );
  return out;
}

/** Règles du client que leur style violerait : signalées (chiffres du code), jamais reproduites. */
export function flaggedOf(posts: readonly AnalysisPost[], universe: InspirationUniverse, forbiddenWords: readonly string[] = []): string[] {
  const n = posts.length;
  const c = (f: (p: AnalysisPost) => boolean) => posts.filter(f).length;
  const out: string[] = [];
  const gains = c((p) => p.gainClaim);
  if (gains) out.push(`Annonces de gains dans ${gains} posts sur ${n} : promesse interdite chez nous, jamais reproduite.`);
  const ai = c((p) => p.aiMention);
  if (ai) out.push(`Mention d'IA, de robot ou d'assistant dans ${ai} posts sur ${n} : jamais chez nous.`);
  const links = c((p) => p.hasLink);
  if (links) out.push(`Liens dans ${links} posts sur ${n} : jamais suivis ni réutilisés, aucun lien hors plateforme chez nous.`);
  if (forbiddenWords.length) {
    const found = new Map<string, number>();
    for (const p of posts) if (p.text) for (const w of forbiddenWordsIn(p.text, forbiddenWords)) found.set(w, (found.get(w) ?? 0) + 1);
    if (found.size)
      out.push(`Mots interdits de l'équipe vus chez eux : ${[...found.entries()].map(([w, k]) => `« ${w} » (${k} posts)`).join(", ")}.`);
  }
  if (universe === "casino") {
    const media = c((p) => p.mediaKind === "photo" || p.mediaKind === "video");
    if (media) out.push(`Photos ou vidéos dans ${media} posts sur ${n} : chez nous, seuls les médias fournis par l'équipe.`);
  }
  return out;
}

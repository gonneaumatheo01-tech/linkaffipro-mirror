/**
 * Phase 27, chantier B : forme commune d'un post analysé, qu'il vienne du canal de référence (`ReferencePost`, mesures
 * gardées même après l'effacement du texte) ou d'un canal du client (`Post` + `PostInsight`). Toutes les mesures de
 * l'analyse (rythme, forme, fond, résultats) se calculent sur cette forme, par le code.
 */
import type { ReferenceMediaKind } from "../contract";

export type AnalysisPost = {
  /** Numéro du post (référence) ou identifiant du `Post` (canal du client). */
  id: string;
  postedAt: Date;
  /** Texte visible (null : effacé après 30 jours, ou post sans texte). Jamais réutilisé, seulement cité (10 mots). */
  text: string | null;
  length: number;
  lines: number;
  emojiCount: number;
  mediaKind: ReferenceMediaKind;
  /** Vues si visibles (null sinon). */
  views: number | null;
  hasLink: boolean;
  hasButton: boolean;
  hasPrice: boolean;
  hasOdds: boolean;
  hasVipCall: boolean;
  hashtags: number;
  mentions: number;
  questions: number;
  /** Part des lettres en majuscules (0 à 1). */
  capsRatio: number;
  /** Annonce de match (« PSG vs OM », « coup d'envoi »). */
  hasMatch: boolean;
  /** Post de résultat d'un pari (« ✅ cote passée », « perdu ❌ »). */
  isBetResult: boolean;
  hasBonus: boolean;
  hasPromoCode: boolean;
  /** Annonce de gains (« j'ai pris +500 € ») : promesse interdite chez nous, signalée. */
  gainClaim: boolean;
  /** Mention d'IA ou d'assistant (règle du client : jamais chez nous). */
  aiMention: boolean;
  free: boolean;
  paid: boolean;
};

/** Univers d'un canal du client (`Channel.vertical`) → univers d'inspiration. */
export const UNIVERSE_OF_VERTICAL: Record<string, "dating" | "casino" | "sports"> = {
  DATING: "dating",
  CASINO: "casino",
  SPORTS: "sports",
};

export const UNIVERSE_LABELS: Record<"dating" | "casino" | "sports", string> = {
  dating: "Rencontres",
  casino: "Casino",
  sports: "Paris sportifs",
};

/**
 * Phase 27, chantier B : motifs du fond (règles pures, français d'abord, anglais courant). Servent quand une mesure
 * manque dans `ReferencePost.features` (texte encore présent) et pour les posts du client (mêmes règles des deux côtés).
 * Les motifs sont lus sur le texte replié (minuscules, sans accents) ; les emojis sur le texte brut.
 */
import { stripHtml, decodeEntities } from "@linkaffipro/core";
import { mentionsAi } from "../../rules/content";

/** Minuscules, sans accents, espaces simples (les emojis et la ponctuation restent). */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const W = (src: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${src})(?![\\p{L}\\p{N}])`, "u");

/** Appel au VIP : « DM », « écris-moi », « places limitées », « rejoins le VIP »… */
export const VIP_RE = W(
  "vip|dm|mp|inbox|ecris[- ]moi|ecrivez[- ]moi|contacte[- ]moi|contactez[- ]moi|message prive|en prive|places? limitees?|derni[eè]res? places?|write me|text me|dm me|limited (?:spots?|places?)",
);
/** Annonce de cote : « cote 1,85 », « @1.85 », « odds ». */
export const ODDS_RE = /(?<![\p{L}])(?:cotes?|odds?|quotes?)(?![\p{L}])|@\s?\d+[.,]\d{1,2}(?!\d)/u;
/** Annonce de match : « PSG vs OM », « PSG - OM », « coup d'envoi », « kick-off ». */
export const MATCH_RE = /(?<![\p{L}])(?:vs\.?|versus|contre|coup d'envoi|kick[- ]?off|match)(?![\p{L}])|\p{Lu}[\p{L}.]+ - \p{Lu}[\p{L}.]+/u;
/** Résultat d'un pari : « ✅ », « ❌ », « cote passée », « pari gagné », « perdu ». */
export const BET_RESULT_RE =
  /[✅❌✔]|(?<![\p{L}])(?:cotes? passees?|pari (?:gagne|passe|perdu|valide)|ticket (?:gagnant|passe|valide|perdu)|c'est passe|bet (?:won|lost)|cashed out)(?![\p{L}])/u;
export const BONUS_RE = W("bonus|free ?spins?|tours? gratuits?|cashback|freebet|pari gratuit|depot double|deposit bonus");
export const PROMO_CODE_RE = W("code(?: promo)?|promo ?code|coupon");
/**
 * Annonce de gains : « j'ai pris +500 € », « on a encaissé 1 200 € », « +300 € ce soir », « gains garantis »,
 * « argent facile ». Interdite chez nous (règle du client) : seulement signalée, jamais reproduite.
 */
const GAIN_RES: readonly RegExp[] = [
  /(?<![\p{L}])(?:j'ai|on a|nous avons|vous avez|ils ont|il a|elle a|tu as|t'as|membres? ont)\s+(?:gagne|encaisse|pris|empoche|touche|fait|remporte)\s+(?:\+\s?)?\d/u,
  /\+\s?\d[\d\s.,]*\s?(?:€|\$|eur(?:os?)?|k)(?![\p{L}])/u,
  /(?<![\p{L}])(?:gains?|benefices?|profits?)\s+(?:de\s+)?\+?\s?\d/u,
  /(?<![\p{L}])(?:gains?|victoire|pari|argent)\s+(?:garantie?s?|assuree?s?|sure?s?)(?![\p{L}])/u,
  /(?<![\p{L}])(?:argent facile|100 ?% (?:sur|sure|gagnant|garanti)|sans risque|tu vas gagner|vous allez gagner|guaranteed|easy money)(?![\p{L}])/u,
];
export const FREE_RE = W("gratuit|gratuite|gratos|offert|offerte|free");
export const PAID_RE = W("payant|payante|abonnement|abonne[- ]toi|acces vip|\\d+\\s?(?:€|\\$|euros?)\\s?(?:/|par )\\s?(?:mois|semaine|an)|subscription|paid");
export const PRICE_RE = /\d[\d\s.,]*\s?(?:€|\$|£|euros?|eur)(?![\p{L}])|[€$£]\s?\d/u;
export const LINK_RE = /https?:\/\/|t\.me\/|www\.|@[a-z0-9_]{5,}/i;
const HASHTAG_RE = /(?<![\p{L}\p{N}_])#[\p{L}\p{N}_]+/gu;
const MENTION_RE = /(?<![\p{L}\p{N}_])@[a-z0-9_]{3,}/giu;

/** Texte visible d'un HTML Telegram (ou d'un texte brut). */
export function visibleText(htmlOrText: string): string {
  return decodeEntities(stripHtml(htmlOrText ?? ""));
}

export function hasGainClaim(text: string): boolean {
  const f = fold(text);
  return GAIN_RES.some((re) => re.test(f));
}

export function countHashtags(text: string): number {
  return [...text.matchAll(HASHTAG_RE)].length;
}

export function countMentions(text: string): number {
  return [...text.matchAll(MENTION_RE)].length;
}

export function countQuestions(text: string): number {
  return [...text.matchAll(/\?+/g)].length;
}

/** Part des lettres en majuscules (0 si aucune lettre). */
export function capsRatioOf(text: string): number {
  const letters = [...text].filter((c) => /\p{L}/u.test(c));
  if (!letters.length) return 0;
  const upper = letters.filter((c) => /\p{Lu}/u.test(c)).length;
  return upper / letters.length;
}

export type TextSignals = {
  hasVipCall: boolean;
  hasOdds: boolean;
  hasMatch: boolean;
  isBetResult: boolean;
  hasBonus: boolean;
  hasPromoCode: boolean;
  gainClaim: boolean;
  aiMention: boolean;
  free: boolean;
  paid: boolean;
  hasPrice: boolean;
  hasLink: boolean;
  hashtags: number;
  mentions: number;
  questions: number;
  capsRatio: number;
};

/** Toutes les mesures de fond tirées d'un texte (visible). */
export function textSignals(text: string): TextSignals {
  const f = fold(text);
  return {
    hasVipCall: VIP_RE.test(f),
    hasOdds: ODDS_RE.test(f),
    hasMatch: MATCH_RE.test(text) || MATCH_RE.test(f),
    isBetResult: BET_RESULT_RE.test(text) || BET_RESULT_RE.test(f),
    hasBonus: BONUS_RE.test(f),
    hasPromoCode: PROMO_CODE_RE.test(f),
    gainClaim: hasGainClaim(text),
    aiMention: mentionsAi(text) !== null,
    free: FREE_RE.test(f),
    paid: PAID_RE.test(f),
    hasPrice: PRICE_RE.test(f),
    hasLink: LINK_RE.test(text),
    hashtags: countHashtags(text),
    mentions: countMentions(text),
    questions: countQuestions(text),
    capsRatio: capsRatioOf(text),
  };
}

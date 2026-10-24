/**
 * Phase 27 (chantier A, lecture) — caractéristiques d'un post de référence (règle 3 : on garde les mesures, pas le
 * contenu) : longueur, lignes, emojis, média, lien, bouton, prix, cote, appel au VIP, mots-clés du vocabulaire de
 * l'univers (français ET anglais), autres mesures (`features`), empreinte du texte et des suites de 8 mots (contrôle
 * « jamais de copie » après l'effacement du texte). Le texte d'un canal de référence est une donnée : jamais une
 * consigne. Fonctions pures.
 */
import { countEmojis } from "../agents/posts/features";
import { shingleHashes, textHash } from "./copy-check";
import type { InspirationUniverse, ReferenceMediaKind, ReferencePostInput } from "./contract";

/** Mesures rangées dans `ReferencePost.features`. */
export type ReferencePostExtra = {
  hashtags: number;
  mentions: number;
  questions: number;
  /** Part des lettres en majuscules (0 à 1, deux décimales). */
  capsRatio: number;
  linkCount: number;
  /** Série pari → résultat (Paris sportifs) : annonce d'un résultat gagné / perdu, sinon null. */
  betResult: "won" | "lost" | null;
  /** Cotes lues dans le texte (« cote 1,85 », « @2.10 »). */
  odds: number[];
  bonus: boolean;
  promoCode: boolean;
  /** Annonce de gains (« un membre a gagné 2 300 € », « big win x500 ») : promesse interdite chez nous, à signaler. */
  gainClaim: boolean;
  free: boolean;
  paid: boolean;
  /** Appel à l'urgence (« places limitées », « aujourd'hui seulement »). */
  urgency: boolean;
};

/** Colonnes de `ReferencePost` tirées d'un post (hors identifiants, voie et dates de la ligne). */
export type ReferencePostColumns = {
  externalId: number;
  postedAt: Date;
  text: string | null;
  views: number | null;
  length: number;
  lines: number;
  emojiCount: number;
  mediaKind: ReferenceMediaKind;
  hasLink: boolean;
  hasButton: boolean;
  hasPrice: boolean;
  hasOdds: boolean;
  hasVipCall: boolean;
  keywords: string[];
  features: ReferencePostExtra;
  textHash: string | null;
  shingles: string[];
};

type Vocab = Array<[term: string, re: RegExp]>;

/** Texte normalisé pour la recherche du vocabulaire : minuscules, sans accents, apostrophes droites. */
export function vocabText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’‘`]/g, "'");
}

const VIP: Vocab = [
  ["vip", /\bvip\b/],
  ["dm", /\b(en )?dm\b|\bdm me\b|\bmp\b/],
  ["écris-moi", /\becri[st]?[- ]moi\b|\becris[- ]moi\b|\benvoie[- ]moi\b|\bcontacte[- ]moi\b/],
  ["message me", /\bmessage me\b|\btext me\b|\binbox\b|\bwrite me\b/],
  ["en privé", /\ben prive\b|\bprivate (group|access|table|chat)\b|\bacces prive\b|\bgroupe prive\b/],
  ["places limitées", /\bplaces? limitees?\b|\blimited (spots?|places?|seats?)\b|\bil (en )?reste \d+\b|\bplus que \d+ places?\b|\bonly \d+ (spots?|places?) left\b/],
  ["rejoins", /\brejoin[sd]\b|\bjoin (now|us|the|my)\b/],
  ["lien en bio", /\blien en bio\b|\blink in bio\b/],
];
const URGENCY: RegExp = /\bplaces? limitees?\b|\blimited\b|\baujourd'hui seulement\b|\btoday only\b|\bderniere chance\b|\blast chance\b|\bvite\b|\bhurry\b|\bil (en )?reste \d+\b|⏳/;
const FREE: RegExp = /\bgratuite?s?\b|\bfree\b|\bofferte?s?\b|\bsans depot\b|\bno deposit\b/;
const PAID: RegExp = /\bpayante?s?\b|\bpaid\b|\babonnement\b|\bsubscription\b|\/ ?mois\b|\bpar mois\b|\bper month\b|\/ ?month\b|\bpremium\b/;
const BONUS: RegExp = /\bbonus\b|\bcashback\b|\bfree ?spins?\b|\btours? gratuits?\b|\bfree ?bets?\b|\bparis? gratuits?\b|\boffre de bienvenue\b|\bwelcome (offer|bonus)\b|\bdepot offert\b/;
const PROMO_CODE: RegExp = /\bcode( promo)?\s*:?\s*[a-z0-9]{4,}\b|\bpromo ?code\b|\bcode promo\b|\bcoupon\b/;
const GAIN_CLAIM: RegExp =
  /\b(j'ai|il a|elle a|on a|vient de|a) gagne\b|\bgagne \d|\+\s?\d[\d  .,]*\s?(€|eur|euros?|\$)|\bx\s?\d{2,}\b|\bjackpot\b|\bbig ?win\b|\bwon \$?\d|\bprofit\b|\bbenefice\b|\b\d[\d  .,]*\s?(€|\$)\s(de gains?|gagnes?)\b|\bcashed\b/;
const PRICE: RegExp = /\d+(?:[.,]\d{1,2})?\s?(€|eur\b|euros?\b|\$|usd\b|£)|[€$£]\s?\d/;
const ODDS_RE = /(?:\b(?:cotes?|odds?|quotas?)\s*(?:de\s*|a\s*|:\s*|@\s*)?|@\s?)(\d{1,2}[.,]\d{1,2})\b/g;

const UNIVERSE_VOCAB: Record<InspirationUniverse, Vocab> = {
  casino: [
    ["roulette", /\broulette\b/],
    ["blackjack", /\bblackjack\b/],
    ["machines à sous", /\bmachines? a sous\b|\bslots?\b/],
    ["jackpot", /\bjackpot\b/],
    ["live", /\blive\b|\ben direct\b/],
    ["croupier", /\bcroupier(e)?s?\b|\bdealer\b/],
    ["tournoi", /\btournoi\b|\btournament\b/],
    ["tours gratuits", /\btours? gratuits?\b|\bfree ?spins?\b/],
    ["mise", /\bmises?\b|\bstake\b|\bbet\b/],
    ["poker", /\bpoker\b/],
    ["retrait", /\bretrai(t|rer)\b|\bwithdraw/],
    ["bonus", /\bbonus\b/],
    ["cashback", /\bcashback\b/],
    ["jeu responsable", /\bjouez? (seulement|avec moderation)\b|\bce que vous pouvez perdre\b|\bfixez une limite\b|\bplay responsibly\b|\bmoderation\b/],
  ],
  sports: [
    ["cote", /\bcotes?\b|\bodds?\b/],
    ["pari", /\bparis?\b|\bpick\b|\bbets?\b|\bpronos?(tic)?s?\b/],
    ["match", /\bmatch\b|\bvs\b|\bcontre\b/],
    ["mise", /\bmises?\b|\bstake\b/],
    ["bankroll", /\bbankroll\b/],
    ["tirs cadrés", /\btirs? cadres?\b|\bshots? on target\b/],
    ["buteur", /\bbuteur\b|\bscorer\b/],
    ["plus de / moins de", /\bplus de \d|\bmoins de \d|\bover \d|\bunder \d/],
    ["combiné", /\bcombine\b|\bparlay\b|\baccumulator\b/],
    ["bilan", /\bbilan\b|\brecap\b|\bresults? of the week\b/],
    ["gagné", /✅|\bcote passee\b|\bgagne\b|\bwon\b|\bwin\b/],
    ["perdu", /❌|\bperdu\b|\blost\b/],
  ],
  dating: [
    ["rencontre", /\brencontres?\b|\bdating\b/],
    ["rendez-vous", /\brendez-vous\b|\bdate\b|\bpremier date\b/],
    ["profil", /\bprofils?\b|\bprofile\b/],
    ["célibataire", /\bcelibataires?\b|\bsingles?\b/],
    ["coucou", /\bcoucou\b|\bhello\b|\bhey\b/],
    ["soirée", /\bsoirees?\b|\bparty\b|\bspeed dating\b/],
    ["discuter", /\bdiscuter\b|\bchat\b|\bparler\b|\btalk\b/],
    ["photo", /\bphotos?\b|\bselfie\b|\bshooting\b/],
    ["bonne nuit", /\bbonne nuit\b|\bgood night\b/],
    ["conseil", /\bconseils?\b|\btips?\b|\badvice\b/],
  ],
};

const WON_RE = /✅|💚|\bcote passee\b|\bgagne\b|\bvalide\b|\bwon\b|\bwinner\b|\bcashed\b|\bgreen\b/;
const LOST_RE = /❌|\bperdu\b|\blost\b|\brate\b|\bred\b/;

function matchedTerms(norm: string, vocab: Vocab): string[] {
  return vocab.filter(([, re]) => re.test(norm)).map(([t]) => t);
}

function parseOdds(norm: string): number[] {
  const out: number[] = [];
  for (const m of norm.matchAll(ODDS_RE)) {
    const v = Number(m[1]!.replace(",", "."));
    if (v >= 1.01 && v <= 50) out.push(v);
  }
  return out;
}

/** Caractéristiques d'un post de référence (colonnes de `ReferencePost`). */
export function postFeatures(input: ReferencePostInput, universe: InspirationUniverse): ReferencePostColumns {
  const text = input.text?.trim() ? input.text.trim() : null;
  const t = text ?? "";
  const norm = vocabText(t);
  const letters = t.match(/\p{L}/gu) ?? [];
  const upper = t.match(/\p{Lu}/gu) ?? [];
  const odds = parseOdds(norm);
  const vip = matchedTerms(norm, VIP);
  const bonus = BONUS.test(norm);
  const promoCode = PROMO_CODE.test(norm);
  const free = FREE.test(norm);
  const paid = PAID.test(norm);
  const gainClaim = GAIN_CLAIM.test(norm);
  const won = WON_RE.test(norm);
  const lost = LOST_RE.test(norm);
  const betResult: ReferencePostExtra["betResult"] = universe === "sports" && won !== lost ? (won ? "won" : "lost") : null;
  const keywords = [
    ...new Set([
      ...matchedTerms(norm, UNIVERSE_VOCAB[universe]),
      ...vip,
      ...(bonus ? ["bonus"] : []),
      ...(promoCode ? ["code promo"] : []),
      ...(free ? ["gratuit"] : []),
      ...(paid ? ["payant"] : []),
    ]),
  ].slice(0, 20);
  const textLinks = (t.match(/https?:\/\/\S+|\bt\.me\/\S+|\b[a-z0-9-]+\.(?:com|fr|net|io|bet|casino|app|link|ly|me)\/\S*/gi) ?? []).length;
  const linkCount = Math.max(input.linkCount, textLinks);
  return {
    externalId: input.externalId,
    postedAt: input.postedAt,
    text,
    views: input.views,
    length: [...t].length,
    lines: t ? t.split("\n").filter((l) => l.trim()).length : 0,
    emojiCount: t ? countEmojis(t.replace(/</g, "‹")) : 0,
    mediaKind: input.mediaKind,
    hasLink: linkCount > 0,
    hasButton: input.hasButton,
    hasPrice: PRICE.test(norm),
    hasOdds: odds.length > 0,
    hasVipCall: vip.length > 0,
    keywords,
    features: {
      hashtags: (t.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length,
      mentions: (t.match(/(^|[\s(])@[A-Za-z][A-Za-z0-9_]{3,31}\b/g) ?? []).length,
      questions: (t.match(/\?+/g) ?? []).length,
      capsRatio: letters.length ? Math.round((upper.length / letters.length) * 100) / 100 : 0,
      linkCount,
      betResult,
      odds,
      bonus,
      promoCode,
      gainClaim,
      free,
      paid,
      urgency: URGENCY.test(norm),
    },
    textHash: text ? textHash(text) : null,
    shingles: text ? shingleHashes(text) : [],
  };
}

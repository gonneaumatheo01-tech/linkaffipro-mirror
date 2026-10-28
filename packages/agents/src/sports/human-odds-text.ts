/**
 * Paris par capture (28 octobre 2026), règles PURES et sans dépendance (lues aussi par `human/answer.ts`) : clé de la
 * demande au client, réponses reconnues, lecture de la cote écrite par l'équipe (« 1,85 », « @1.85 », « cote 2 »).
 */

/** Demande « capture et cote » d'un pari : `sports.human-odds.<identifiant du pari>`. */
export const HUMAN_ODDS_KEY_PREFIX = "sports.human-odds.";
/** Réponse écrite par le code quand la capture et la cote sont reçues (ferme la demande). */
export const HUMAN_ODDS_DONE = "capture et cote reçues";
/** Réponse « le pari n'est pas proposé sur le site ». */
export const HUMAN_ODDS_UNAVAILABLE = "pas dispo";
/** `BettingPick.oddsLevel` : cote attendue de l'équipe, puis cote donnée par l'équipe. */
export const ODDS_LEVEL_HUMAN_PENDING = "human-pending";
export const ODDS_LEVEL_HUMAN = "human";
/** Cotes décimales acceptées. */
export const HUMAN_ODDS_MIN = 1.01;
export const HUMAN_ODDS_MAX = 100;

export function humanOddsKey(pickId: string): string {
  return `${HUMAN_ODDS_KEY_PREFIX}${pickId}`;
}

export function isHumanOddsKey(key: string | null | undefined): boolean {
  return typeof key === "string" && key.startsWith(HUMAN_ODDS_KEY_PREFIX);
}

export function pickIdOfHumanOddsKey(key: string): string | null {
  return isHumanOddsKey(key) ? key.slice(HUMAN_ODDS_KEY_PREFIX.length) || null : null;
}

/** Pari dont la cote vient de l'équipe (attendue ou reçue). */
export function isHumanOddsPick(pick: { oddsLevel?: string | null }): boolean {
  return pick.oddsLevel === ODDS_LEVEL_HUMAN || pick.oddsLevel === ODDS_LEVEL_HUMAN_PENDING;
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[’‘ʼ]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** « pas dispo », « pas disponible », « indisponible », « n'existe pas », « pas trouvé », « pas proposé »… */
export function isUnavailableText(text: string): boolean {
  const n = fold(text);
  if (!n) return false;
  return /(^|[^\p{L}])(pas dispo|pas disponible|indispo|indisponible|n'existe pas|existe pas|introuvable|pas trouve|pas proposee?|pas de cote|pas sur le site|pas ce pari)([^\p{L}]|$)/u.test(n);
}

const NUMBER = /(?<![\d.,])(\d{1,3}(?:[.,]\d{1,3})?)(?![\d.,]*\d)/g;
const toNumber = (s: string) => Number(s.replace(",", "."));
const inRange = (n: number) => Number.isFinite(n) && n >= HUMAN_ODDS_MIN && n <= HUMAN_ODDS_MAX;

/**
 * Cote écrite par l'équipe (pur) : après « cote » ou « @ » d'abord ; sinon le seul nombre du texte ; sinon le seul
 * nombre à deux décimales (« plus de 7,5 à 1,85 » → 1,85). Ambigu ou hors de 1,01 à 100 → null.
 */
export function readOddsNumber(text: string): number | null {
  const n = fold(text);
  if (!n) return null;
  const marked = /(?:cote|@)\s*(?:de|a|:|=)?\s*(\d{1,3}(?:[.,]\d{1,3})?)/.exec(n);
  if (marked) {
    const v = toNumber(marked[1]!);
    return inRange(v) ? v : null;
  }
  const all = [...n.matchAll(NUMBER)].map((m) => m[1]!);
  if (all.length === 1) {
    const v = toNumber(all[0]!);
    return inRange(v) ? v : null;
  }
  const twoDecimals = all.filter((x) => /[.,]\d{2}$/.test(x));
  if (twoDecimals.length === 1) {
    const v = toNumber(twoDecimals[0]!);
    return inRange(v) ? v : null;
  }
  return null;
}

export type HumanOddsText = { kind: "odds"; odds: number } | { kind: "unavailable" } | null;

/** Message de l'équipe : « pas dispo », une cote, ou rien de reconnu (pur). */
export function parseHumanOddsText(text: string | null | undefined): HumanOddsText {
  if (!text || !text.trim()) return null;
  if (isUnavailableText(text)) return { kind: "unavailable" };
  const odds = readOddsNumber(text);
  return odds === null ? null : { kind: "odds", odds };
}

/** Cote à la française, deux décimales (« 1,85 »). */
export function frOddsText(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

/**
 * Contrôle codé des rapports rédigés par l'IA (phases 21 et 24) : tout nombre écrit par le modèle doit venir des
 * chiffres fournis, avec son signe. Un nombre absent, un signe contraire (« hausse » pour une baisse, « gains » pour
 * une perte), un multiplicateur (« 3 fois », « double ») ou un nombre en lettres (« douze mille », « 1,4 million »)
 * fait rejeter la rédaction (le code écrit les lignes à la place).
 *
 * Nombres permis : les VALEURS numériques des faits (parcours de l'objet), jamais les nombres pris dans les clés,
 * les dates ou les noms. Un texte des faits (nom de pub, date, phrase écrite par le code) peut être recopié tel quel :
 * il est retiré de la ligne avant le contrôle, ses nombres ne deviennent pas des nombres permis ailleurs.
 */

/** Nombres d'un texte (« 1 234,5 » → « 1234.5 » : séparateurs de milliers français retirés). */
export function numbersIn(s: string): string[] {
  return numberTokens(s).map((t) => t.abs);
}

type Sign = "+" | "-" | null;
type NumberToken = { abs: string; sign: Sign; start: number; end: number };

const GROUPED = /(\d)[\s\u00a0\u202f](?=\d{3}(?!\d))/g;

/** Nombres d'un texte avec leur signe écrit (« −35 », « -35 », « +12 » ; un tiret entre deux mots n'est pas un signe). */
function numberTokens(s: string): NumberToken[] {
  const joined = s.replace(GROUPED, "$1");
  const out: NumberToken[] = [];
  const re = /\d+(?:[.,]\d+)?/g;
  for (let m = re.exec(joined); m; m = re.exec(joined)) {
    const before = joined.slice(0, m.index);
    let sign: Sign = null;
    const sm = /([+\-\u2212\u2013])\s?$/.exec(before);
    if (sm) {
      const prev = before.slice(0, before.length - sm[0].length).slice(-1);
      // « 18-20 », « 18 h-20 h », « A-1 » : tiret d'intervalle, pas un signe.
      if (!prev || /[\s(:;«"'/]/.test(prev)) sign = sm[1] === "+" ? "+" : "-";
    }
    out.push({ abs: m[0].replace(",", "."), sign, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

export type AllowedNumbers = {
  /** Forme écrite (valeur absolue, arrondis usuels) → signes présents dans les faits. */
  values: Map<string, Set<"+" | "-">>;
  /** Textes des faits contenant un chiffre, retirés d'une ligne avant le contrôle (plus long d'abord). */
  texts: string[];
};

function variants(v: number): string[] {
  const a = Math.abs(v);
  return [String(a), String(Math.round(a)), a.toFixed(1), a.toFixed(2), String(Number(a.toFixed(1))), String(Number(a.toFixed(2)))];
}

/** Nombres permis : valeurs numériques des faits (avec leur signe) et textes recopiables des faits. */
export function allowedNumbers(facts: unknown): AllowedNumbers {
  const values = new Map<string, Set<"+" | "-">>();
  const texts = new Set<string>();
  const walk = (x: unknown) => {
    if (typeof x === "number") {
      if (!Number.isFinite(x)) return;
      const sign = x < 0 ? "-" : "+";
      for (const k of variants(x)) {
        const set = values.get(k) ?? new Set();
        set.add(sign);
        values.set(k, set);
      }
    } else if (typeof x === "string") {
      // Heure des faits (« 19:00 ») : « 19 h » s'écrit aussi.
      const hm = /^(\d{1,2}):(\d{2})$/.exec(x.trim());
      if (hm) walk(Number(hm[1]));
      if (x.trim().length >= 3 && /\d/.test(x)) texts.add(x.trim());
    } else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") Object.values(x).forEach(walk);
  };
  walk(facts);
  return { values, texts: [...texts].sort((a, b) => b.length - a.length) };
}

const L = "\\p{L}";
const word = (w: string) => new RegExp(`(?<![${L}\\d])(?:${w})(?![${L}])`, "iu");

/** Multiplicateurs et calculs que les faits ne donnent jamais. */
const MULTIPLIER = word("fois|double|doubl[ée]e?s?|doubler|triple|tripl[ée]e?s?|quadruple|moiti[ée]|tiers|quart");
/** Nombres en lettres et ordres de grandeur. */
const NUMBER_WORDS = word(
  "z[ée]ro|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingts?|trente|quarante|cinquante|soixante|cents?|mille|milles|millions?|milliards?|dizaines?|douzaines?|centaines?|milliers?",
);
const K_SUFFIX = /\d\s?[kK](?![\p{L}])/u;

const UP = /hausse|augment|progress|gagn|gains?|b[ée]n[ée]fice|mont[ée]|grimp|plus\s+de\s+gains/iu;
const DOWN = /baisse|recul|diminu|chute|pertes?|perd|d[ée]ficit|moins\s+de\s+gains|n[ée]gati/iu;
const CLAUSE = /[.;:!?()\n]/;

/** Sens annoncé autour d'un nombre : mot le plus proche avant (depuis le nombre précédent), sinon juste après. */
function direction(text: string, tokens: NumberToken[], i: number): "+" | "-" | null {
  const t = tokens[i]!;
  const from = i > 0 ? tokens[i - 1]!.end : 0;
  let before = text.slice(from, t.start);
  const cut = Math.max(...[...before.matchAll(new RegExp(CLAUSE, "g"))].map((m) => m.index + 1), 0);
  before = before.slice(cut);
  const near = (s: string, re: RegExp, last: boolean) => {
    const all = [...s.matchAll(new RegExp(re.source, "giu"))];
    if (!all.length) return -1;
    return last ? all[all.length - 1]!.index : all[0]!.index;
  };
  const up = near(before, UP, true);
  const down = near(before, DOWN, true);
  if (up >= 0 || down >= 0) return down > up ? "-" : "+";
  const to = i + 1 < tokens.length ? tokens[i + 1]!.start : text.length;
  let after = text.slice(t.end, to);
  const stop = after.search(CLAUSE);
  if (stop >= 0) after = after.slice(0, stop);
  after = after.slice(0, 30);
  const u2 = near(after, UP, false);
  const d2 = near(after, DOWN, false);
  if (u2 < 0 && d2 < 0) return null;
  if (u2 < 0) return "-";
  if (d2 < 0) return "+";
  return d2 < u2 ? "-" : "+";
}

/** Problèmes de la ligne (vide = texte accepté) : nombres absents des faits, signe contraire, multiplicateurs, lettres. */
export function inventedNumbers(text: string, allowed: AllowedNumbers): string[] {
  let t = text;
  for (const s of allowed.texts) t = t.split(s).join(" ");
  const problems: string[] = [];
  const mult = MULTIPLIER.exec(t);
  if (mult) problems.push(mult[0]);
  const words = NUMBER_WORDS.exec(t);
  if (words) problems.push(words[0]);
  const k = K_SUFFIX.exec(t);
  if (k) problems.push(k[0]);
  const tokens = numberTokens(t);
  const joined = t.replace(GROUPED, "$1");
  tokens.forEach((tok, i) => {
    const signs = allowed.values.get(tok.abs) ?? allowed.values.get(String(Number(tok.abs)));
    if (!signs) return void problems.push(tok.abs);
    // Signe écrit d'abord, sinon sens annoncé par les mots (« hausse », « pertes »…). Zéro n'a pas de sens.
    const want = tok.sign ?? direction(joined, tokens, i);
    if (Number(tok.abs) === 0 || !want) return;
    if (!signs.has(want)) problems.push(`${want}${tok.abs}`);
  });
  return problems;
}

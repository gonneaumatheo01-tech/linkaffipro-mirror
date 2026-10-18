// Détection d'un âge déclaré de moins de 18 ans (contrat §3.8, règle 3 du client), en 6 langues, faite par le code
// AVANT tout appel au modèle. Sans faux positif évident : « 16 ans d'expérience », « depuis 15 ans », « mon fils a 16
// ans », « I'm 15 minutes away » ne sont pas des âges.
import { foldText } from "./text-utils";

export const MINOR_AGE_MIN = 10;
export const MINOR_AGE_MAX = 17;

export type MinorDetection = { minor: boolean; age: number | null };

// Nombres écrits en toutes lettres (11 à 17) → chiffres.
const NUMBER_WORDS: [RegExp, string][] = [
  [/\bdix sept\b/g, "17"],
  [/\b(?:onze|eleven|undici)\b/g, "11"],
  [/\b(?:douze|twelve|doce|doze|zwolf|dodici)\b/g, "12"],
  [/\b(?:treize|thirteen|trece|treze|dreizehn|tredici)\b/g, "13"],
  [/\b(?:quatorze|fourteen|catorce|catorze|vierzehn|quattordici)\b/g, "14"],
  [/\b(?:quinze|fifteen|quince|funfzehn|quindici)\b/g, "15"],
  [/\b(?:seize|sixteen|dieciseis|dezesseis|dezasseis|sechzehn|sedici)\b/g, "16"],
  [/\b(?:seventeen|diecisiete|dezessete|dezassete|siebzehn|diciassette)\b/g, "17"],
];

/** Minuscules sans accents, apostrophes et traits d'union en espaces, nombres en lettres en chiffres. */
function minorForm(text: string): string {
  let s = foldText(text)
    .replace(/['’‘`´-]/g, " ")
    .replace(/[ \t\u00a0]+/g, " ");
  for (const [re, digits] of NUMBER_WORDS) s = s.replace(re, digits);
  return s;
}

/**
 * Mots d'âge après le nombre (« ans », « piges », « years old », « años », « anos », « Jahre », « anni », « yo »…).
 * Pas de « j » seul : « 15 j » veut dire 15 jours.
 */
const AGE_WORD =
  "(?:ans|an|piges|balais|berges|printemps|years old|year old|years|year|yrs old|yrs|yr|y\\/o|y\\.o|yo|anos|ano|anni|anno|jahre alt|jahre|jahren|jr)";

/** Suites qui montrent que ce n'est pas un âge (« ans d'expérience », « years ago », « anni fa », « ans de plus »…). */
const NOT_AGE_AFTER =
  "(?:d|de|des|du|of|di|da|del|do|dos|das|der|ago|fa|atras|zuruck|her|later|plus tard|apres|despues|depois|dopo|spater|danach|older|younger|plus|mas|mais|piu|alter|junger|experience|erfahrung|berufserfahrung|lang|ehe|en|em|in|into|dans|seit|depuis|since|que|than|ensemble|together|juntos|zusammen|insieme)";

/** Emojis (paires de substitution des plans 1F300-1FAFF, et symboles 2600-27BF) : « j'ai 16 😊 ». */
const EMOJI =
  "\\uD83C[\\uDF00-\\uDFFF]|\\uD83D[\\uDC00-\\uDEFF]|\\uD83E[\\uDD00-\\uDEFF]|[\\u2600-\\u27BF]";

/** Rires et mots de fin courants après un âge seul (« j'ai 16 mdr », « I'm 16 btw », « j'ai 15 ptdr »). */
const BARE_END_WORDS =
  "et|and|y|e|und|ed|mais|but|pero|mas|aber|ma|toi|you|u|tu|du|lol+|mdr+|x?ptdr+|(?:ha){2,}h?|(?:ah){2,}a?|(?:hi){2,}|(?:ja){2,}|k{3,}|xd+|lmao|bientot|soon|tho|though|aussi|too|also|tambien|tambem|auch|anche|perso|btw|now|rn|maintenant|mtn|hein|quoi";

/**
 * Ce qui peut suivre un nombre seul (« j'ai 16 », « I'm 16 and you? », « j'ai 16 😊 ») pour qu'il soit lu comme un âge :
 * fin du texte, ponctuation de phrase, émoticône, emoji ou mot de fin. Jamais « € », « % », « : », « h », « / » ni un
 * chiffre décimal (« j'ai 15 € », « 16 % de batterie », « 14:30 », « 16/20 », « 15.5 »).
 */
const BARE_NUMBER_END = `(?=\\s*(?:$|[!?;)(…]|\\.(?!\\d)|,(?!\\d)|:\\)|:\\(|:d\\b|:p\\b|;\\)|<3|${EMOJI})|\\s(?:${BARE_END_WORDS})\\b)`;

/** Déclarations à la première personne, par langue (« j'ai », « I'm », « tengo », « tenho », « ich bin », « ho »…). */
const FIRST_PERSON =
  "(?:j ai(?: eu)?|jai(?: eu)?|g|je viens d avoir|je vais avoir|je vais sur|j vais sur|j aurai|je suis age de|je suis agee de|mon age c est|mon age est|i m|im|i am|iam|i just turned|i turned|i ll be|ill be|i will be|i m turning|my age is|age|tengo|yo tengo|cumpli|voy a cumplir|mi edad es|tenho|eu tenho|fiz|vou fazer|minha idade e|ich bin|ich werde|ich wurde|mein alter ist|ho|io ho|ne ho|ho appena compiuto|ho compiuto|compio|la mia eta e)";

const NUMBER_PREFIX =
  "(?:(?:bientot|presque|deja|que|juste|seulement|only|just|almost|nearly|already|ya|casi|apenas|solo|quase|so|fast|erst|schon|gerade|quasi|appena|mes|my)\\s+)*";

const FIRST_PERSON_AGE = new RegExp(
  `\\b${FIRST_PERSON}[\\s:=]+${NUMBER_PREFIX}(\\d{1,2})(?:\\s*${AGE_WORD}\\b(?!\\s+${NOT_AGE_AFTER}\\b)|${BARE_NUMBER_END})`,
  "g",
);

/** Début de phrase (ou mot de remplissage) avant un âge seul : « 16 ans », « moi 16 ans », « bah 15 ans et toi ? ». */
const CLAUSE_START =
  "(?:^|[.!?,;:\\n(]\\s*|(?:^|\\s)(?:moi|me|perso|bah|ben|euh|alors|well|so|um|uh|bueno|pues|yo|eu|entao|io|allora|ich|also|ok|oui|yes|si|sim|ja|non|no|nope|haha|lol|mdr|jaja|kkk)\\s+)";

const BARE_AGE = new RegExp(
  `${CLAUSE_START}(\\d{1,2})\\s*${AGE_WORD}\\b(?!\\s+${NOT_AGE_AFTER}\\b)`,
  "g",
);

/** « 17yo », « 16 y/o » n'importe où (sauf s'il s'agit visiblement d'une autre personne). */
const SHORT_AGE = /(?:^|[^a-z0-9])(\d{1,2})\s*(?:yo|y\/o|y\.o)\b/g;

/** Un tiers juste avant (« ma sœur, 16 ans », « my brother 17yo ») : ce n'est pas l'âge de la personne. */
const THIRD_PARTY =
  /\b(?:soeur|frere|fils|fille|cousin|cousine|pote|copain|copine|ami|amie|il|elle|son|daughter|brother|sister|friend|he|she|hijo|hija|hermano|hermana|amigo|amiga|primo|prima|filho|filha|irmao|irma|sohn|tochter|bruder|schwester|freund|freundin|figlio|figlia|fratello|sorella|amico|amica|cugino|cugina|er|sie|lui|lei|ella|ele|ela|him|her)\b/;

/** Déclarations sans nombre : « je suis mineure », « I'm underage », « soy menor », « ich bin minderjährig »… */
const MINOR_PHRASES: readonly RegExp[] = [
  /\b(?:je suis|suis|chui|jsuis) mineure?\b/,
  /\b(?:je suis|suis|chui|jsuis) pas (?:encore )?majeure?\b/,
  /\b(?:j ai|jai|g) (?:pas|meme pas|pas encore|moins de) (?:encore )?18\b/,
  /\bje n ai (?:pas|meme pas) (?:encore )?18\b/,
  /\b(?:i m|im|i am) (?:a |still a |only a )?minor\b/,
  /\b(?:i m|im|i am) (?:still )?under ?age\b/,
  /\b(?:i m|im|i am) (?:still )?under 18\b/,
  /\b(?:i m|im|i am) not (?:even )?18(?: yet)?\b/,
  /\bnot 18 yet\b/,
  /\b(?:soy|yo soy) menor\b/,
  /\bno tengo (?:ni )?(?:los )?18\b/,
  /\btengo menos de 18\b/,
  /\b(?:sou|eu sou) (?:de )?menor\b/,
  /\bnao tenho 18\b/,
  /\btenho menos de 18\b/,
  /\b(?:ich bin|bin) (?:noch )?minderjahrig\b/,
  /\bich bin (?:noch )?(?:nicht|keine) 18\b/,
  /\bich bin unter 18\b/,
  /\bnoch nicht 18\b/,
  /\b(?:sono|io sono) (?:ancora )?minorenne\b/,
  /\bnon ho (?:ancora )?18 anni\b/,
  /\bho meno di 18 anni\b/,
];

const inRange = (n: number) => n >= MINOR_AGE_MIN && n <= MINOR_AGE_MAX;

/** Âge déclaré de moins de 18 ans dans un message de la personne (6 langues). */
export function detectMinor(text: string): MinorDetection {
  if (!text || !text.trim()) return { minor: false, age: null };
  const s = minorForm(text);

  for (const m of s.matchAll(FIRST_PERSON_AGE)) {
    const age = Number(m[1]);
    if (inRange(age)) return { minor: true, age };
  }
  for (const m of s.matchAll(BARE_AGE)) {
    const age = Number(m[1]);
    const before = s.slice(Math.max(0, (m.index ?? 0) - 30), m.index ?? 0);
    if (inRange(age) && !THIRD_PARTY.test(before.split(/[.!?\n]/).pop() ?? ""))
      return { minor: true, age };
  }
  for (const m of s.matchAll(SHORT_AGE)) {
    const age = Number(m[1]);
    const before = s.slice(Math.max(0, (m.index ?? 0) - 30), (m.index ?? 0) + 1);
    if (inRange(age) && !THIRD_PARTY.test(before.split(/[.!?\n]/).pop() ?? ""))
      return { minor: true, age };
  }
  if (MINOR_PHRASES.some((re) => re.test(s))) return { minor: true, age: null };
  return { minor: false, age: null };
}

/** Premier message d'une liste qui déclare un âge de moins de 18 ans. */
export function detectMinorIn(texts: readonly string[]): MinorDetection {
  for (const t of texts) {
    const r = detectMinor(t);
    if (r.minor) return r;
  }
  return { minor: false, age: null };
}

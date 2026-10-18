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

/**
 * Suites qui montrent que le nombre n'est PAS l'âge de la personne (« ans d'expérience », « years ago », « anni fa »,
 * « ans de plus que toi »…). Liste FERMÉE de tournures précises : un mot courant seul (« mais », « en », « du », « de »,
 * « que », « mas »…) ne suffit jamais, sinon « j'ai 16 ans mais je suis mature », « 16 ans en terminale », « j'ai 16 ans
 * du coup », « tenho 16 anos mas… » échapperaient à la détection.
 */
const NOT_AGE_AFTER_LIST = [
  // français
  "d experiences?",
  "d anciennete",
  "d ecarts?",
  "d etudes?",
  "d avance",
  "d affilee",
  "d existence",
  "de plus",
  "de moins",
  "de mariage",
  "de vie commune",
  "de couple",
  "de relation",
  "de carriere",
  "de metier",
  "de service",
  "de difference",
  "de travail",
  "de boulot",
  "de taf",
  "de boite",
  "de pratique",
  "de retard",
  "de prison",
  "de suite",
  "de credit",
  "plus tard",
  "plus tot",
  "plus vieux",
  "plus vieilles?",
  "plus agee?s?",
  "plus jeunes?",
  "plus grande?s?",
  "apres",
  "auparavant",
  "en arriere",
  "en couple",
  "depuis que",
  "ensemble",
  "dans (?:le|la|l|ce|cette|mon|ma|les) (?:metier|boite|domaine|entreprise|job|travail|milieu|secteur|business|armee|police)",
  // anglais
  "of experience",
  "of marriage",
  "of work",
  "of service",
  "of practice",
  "of difference",
  "ago",
  "later",
  "earlier",
  "older",
  "younger",
  "more",
  "less",
  "since",
  "together",
  "apart",
  "into",
  "in (?:the|this|my) (?:business|industry|field|job|army|game)",
  // espagnol
  "de experiencias?",
  "de casados",
  "de matrimonio",
  "de diferencia",
  "de carrera",
  "de servicio",
  "de trabajo",
  "atras",
  "despues",
  "mas que",
  "mas de",
  "menos que",
  "mayor(?:es)? que",
  "juntos",
  "juntas",
  // portugais
  "de casamento",
  "de diferenca",
  "de carreira",
  "de servico",
  "de trabalho",
  "depois",
  "mais velh[oa]s?",
  "mais nov[oa]s?",
  "a mais",
  "a menos",
  "mais (?:do )?que",
  // allemand
  "erfahrung",
  "berufserfahrung",
  "her",
  "spater",
  "danach",
  "alter",
  "junger",
  "lang",
  "ehe",
  "zusammen",
  "mehr",
  "fruher",
  "zuruck",
  "seit",
  // italien
  "di esperienza",
  "di matrimonio",
  "di differenza",
  "di carriera",
  "di servizio",
  "di lavoro",
  "fa",
  "dopo",
  "piu grandi?",
  "piu vecchi[oa]?",
  "piu giovani?",
  "piu di",
  "in piu",
  "insieme",
  "prima",
] as const;
const NOT_AGE_AFTER = `(?:${NOT_AGE_AFTER_LIST.join("|")})`;

/**
 * En plus, pour un âge sans « j'ai » devant (« 16 ans que je vis ici », « Bah 15 ans qu'on se connaît ») : une durée.
 * Jamais pour « j'ai 16 ans que… » (« j'ai 16 ans, que veux-tu »).
 */
const NOT_AGE_AFTER_BARE = `(?:${NOT_AGE_AFTER}|que (?:je|j|tu|t|on|nous|vous|il|elle|ils|elles|ca|c|y|l)|qu (?:on|il|elle|ils|elles))`;

/** Emojis (paires de substitution des plans 1F300-1FAFF, et symboles 2600-27BF) : « j'ai 16 😊 ». */
const EMOJI =
  "\\uD83C[\\uDF00-\\uDFFF]|\\uD83D[\\uDC00-\\uDEFF]|\\uD83E[\\uDD00-\\uDEFF]|[\\u2600-\\u27BF]";

/** Rires et mots de fin courants après un âge seul (« j'ai 16 mdr », « I'm 16 btw », « j'ai 15 ptdr »). */
const BARE_END_WORDS =
  "et|and|y|e|und|ed|mais|but|pero|mas|aber|ma|toi|you|u|tu|du|lol+|mdr+|x?ptdr+|(?:ha){2,}h?|(?:ah){2,}a?|(?:hi){2,}|(?:ja){2,}|k{3,}|xd+|lmao|bientot|soon|tho|though|aussi|too|also|tambien|tambem|auch|anche|perso|btw|now|rn|maintenant|mtn|hein|quoi|en fait|en vrai|in fact|actually|de toute facon|du coup|honnetement|franchement|serieux|serieusement|honestly|seriously";

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
  `${CLAUSE_START}(\\d{1,2})\\s*${AGE_WORD}\\b(?!\\s+${NOT_AGE_AFTER_BARE}\\b)`,
  "g",
);

/**
 * Présentation « prénom + âge » (« Lucas 16 ans », « moi c'est Lucas 16 ans », « je m'appelle Inès 15 ans ») : un seul mot
 * en début de message ou de phrase (ou après « moi c'est », « je m'appelle »…), puis l'âge. Le mot ne doit être ni un
 * mot de durée ou de lieu (« depuis 15 ans », « pendant 15 ans », « hace 15 años ») ni un proche (« fils 16 ans »).
 */
const NAME_INTRO =
  "moi c est|je m appelle|j m appelle|jm appelle|c est|my name is|my name s|i m|me llamo|mi nombre es|mi chiamo|ich heisse|meu nome e|eu me chamo";
const NAME_AGE = new RegExp(
  `(?:\\b(?:${NAME_INTRO})\\s+|(?:^|[.!?\\n]\\s*))([a-z]{2,20})\\s+(\\d{1,2})\\s*${AGE_WORD}\\b(?!\\s+${NOT_AGE_AFTER_BARE}\\b)`,
  "g",
);

/** Mots qui ne sont pas un prénom devant un âge (durée, lieu, possessif, article…), 6 langues. */
const NOT_A_NAME = new Set(
  (
    "depuis pendant durant environ apres avant encore plus moins pres vers il y a en de des du les la le un une et ou " +
    "mes mon ma ses son sa tes ton nos vos leurs leur pour par sur sous dans avec sans chez tous toutes tout toute fait " +
    "ca cela faut au aux quand jusqu jusque since for about around during ago over under at in on the my his her their " +
    "our your every after before than when until hace desde por durante hasta con sin mis sus los las el cuando ha faz " +
    "com sem os as meus seus quando seit vor fur nach mit ohne meine seine alle wenn als bis da per circa dopo prima " +
    "senza miei suoi tutti ogni ans an years anos anni jahre"
  ).split(" "),
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
  for (const m of s.matchAll(NAME_AGE)) {
    const name = m[1] ?? "";
    const age = Number(m[2]);
    if (!inRange(age) || NOT_A_NAME.has(name) || THIRD_PARTY.test(name)) continue;
    const before = s.slice(Math.max(0, (m.index ?? 0) - 30), m.index ?? 0);
    if (!THIRD_PARTY.test(before.split(/[.!?\n]/).pop() ?? "")) return { minor: true, age };
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

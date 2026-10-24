/**
 * Anonymisation des échantillons relus par l'IA (règle 5 du plan, pur et testé) : adresses mail, liens, @pseudos,
 * adresses postales, numéros (téléphone, codes, numéros dictés en lettres), adresses mail écrites en mots, pseudos
 * annoncés après un réseau (« mon snap c'est … »), lieux de vie (« j'habite … »), prénoms (de la personne, de la
 * persona, prénoms courants, suivis ou non de « _ » / chiffres, et prénoms annoncés « je m'appelle … », « je suis … »)
 * remplacés par un repère. Mieux vaut masquer un mot de trop qu'un prénom oublié.
 */

export const MASKS = {
  name: "[prénom]",
  phone: "[numéro]",
  email: "[mail]",
  link: "[lien]",
  handle: "[pseudo]",
  address: "[adresse]",
} as const;

/** Prénoms courants (France et international) masqués même s'ils ne sont pas ceux de la personne. */
export const COMMON_FIRST_NAMES: readonly string[] = [
  "Adam", "Adrien", "Alex", "Alexandre", "Alexis", "Ali", "Alice", "Alicia", "Amandine", "Amélie", "Anaïs", "Andréa",
  "Anthony", "Antoine", "Arthur", "Aurélie", "Axel", "Baptiste", "Bastien", "Benjamin", "Camille", "Carla", "Caroline",
  "Céline", "Charlotte", "Chloé", "Clara", "Claire", "Clément", "Coralie", "Damien", "David", "Dylan", "Elena", "Éléonore",
  "Elisa", "Élise", "Ellie", "Emma", "Emilie", "Émilie", "Enzo", "Eva", "Fanny", "Florian", "Gabriel", "Guillaume",
  "Hugo", "Inès", "Jade", "Jason", "Jean", "Jessica", "Jordan", "Julia", "Julie", "Julien", "Juliette", "Justine",
  "Karim", "Kevin", "Laura", "Laurie", "Léa", "Léna", "Léo", "Lina", "Lisa", "Lola", "Louis", "Louise", "Luca",
  "Lucas", "Lucie", "Manon", "Marie", "Marine", "Marion", "Mathieu", "Mathilde", "Mathis", "Matteo", "Maxime",
  "Mélanie", "Mia", "Mohamed", "Morgane", "Nathan", "Nicolas", "Noah", "Noémie", "Nina", "Océane", "Pauline",
  "Pierre", "Quentin", "Rayan", "Romain", "Romane", "Samuel", "Sarah", "Sofia", "Sophie", "Thomas", "Théo", "Valentin",
  "Victor", "Yanis", "Yasmine", "Zoé", "John", "Mike", "Michael", "Chris", "James", "Daniel", "Anna", "Maria", "Laure",
  "Vanessa", "Sabrina", "Nadia", "Sonia", "Kenza", "Sami", "Yassine", "Mehdi", "Karine", "Sandra", "Cindy", "Kelly",
];

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[a-z]{2,}/giu;
const URL_SCHEME = /\b(?:https?:\/\/|www\.)\S+/giu;
const URL_DOMAIN =
  /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|fr|net|org|io|me|app|link|ly|gg|tv|be|ch|eu|co|xyz|info|site|online|club)\b(?:\/\S*)?/giu;
const HANDLE = /(?<![\p{L}\p{N}_])@[A-Za-z0-9_]{3,}/gu;
const ADDRESS =
  /\b\d{1,4}\s*(?:bis|ter)?\s*,?\s*(?:rue|avenue|av\.|boulevard|bd|chemin|allée|allee|place|impasse|route|quai|street|st\.|road)\s+[^\n,.;!?]{1,40}/giu;
/** Suite de chiffres (avec espaces, points, tirets) : masquée dès 6 chiffres (téléphone, code, identifiant). */
const DIGITS = /(?:\+|00)?\d[\d\s.\-()]{4,}\d/gu;
/** Prénom annoncé : « je m'appelle Julie », « moi c'est Julie », « my name is John ». */
const INTRO =
  /\b(je m['’]appelle|mon pr[ée]nom c['’]est|mon pr[ée]nom est|my name is|call me|moi c['’]est(?=\s+\p{Lu}))(\s+)([\p{L}'’-]{2,30})/giu;

/** Pseudo annoncé après un réseau : « mon snap c'est bgdu93x », « ajoute moi sur snap julie_75 », « insta : x ». */
const SOCIAL_HANDLE =
  /(?<![\p{L}\p{N}_])(snap|snapchat|insta|instagram|ig|tiktok|tik tok|wa|whatsapp|whats app|telegram|tg|kik|discord|twitter|fb|facebook)(\s*(?::|=|->)?\s*(?:c['’]est|est)?\s*:?\s*)(?!\[)([\p{L}\p{N}._-]{2,40})/giu;
/** Mot de pseudo : lettres puis au moins 2 chiffres (« fred93 », « bgdu93x », « julie_75 »). */
const HANDLE_LIKE = /(?<![\p{L}\p{N}_])\p{L}{3,}[_.]?\p{N}{2,}[\p{L}\p{N}_]*(?![\p{L}\p{N}_])/gu;
/** Présentation : « je suis Fred », « c'est Fred » (mot à majuscule ; la majuscule n'est pas ignorée). */
const PRESENT = /(?<![\p{L}])([Jj]e suis|JE SUIS|[Cc]['’]est|C['’]EST)(\s+)(\p{Lu}[\p{L}'’-]{1,29})/gu;
/** Lieu de vie : « j'habite Montreuil », « je vis à Lyon », « je viens de Lille », « je suis de Marseille ». */
const PLACE =
  /(?<![\p{L}])((?:[Jj]['’] ?habite|[Jj]e vis|[Jj]e viens|[Jj]'?e? ?vis)(?:\s+(?:à|a|au|aux|en|sur|de|du|des|d['’]))?|(?:[Jj]e suis|[Jj]['’] ?suis|[Jj]suis)\s+(?:à|a|au|aux|en|sur|de|du|des|d['’]))(\s*)(\p{Lu}[\p{L}'’-]{1,40}(?:[\s-]+(?:sur|sous|en|les|la|le)?[\s-]*\p{Lu}[\p{L}'’-]{1,30})*)/gu;
const NUMBER_WORD =
  "z[ée]ro|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingts?|trente|quarante|cinquante|soixante|septante|octante|nonante|cents?|mille";
/** Numéro dicté en lettres : 4 nombres en lettres ou plus à la suite (« zero six douze trente quatre »). */
const SPELLED_DIGITS = new RegExp(`(?<![\\p{L}])(?:${NUMBER_WORD})(?:(?:[\\s,.-]+(?:et[\\s-]+)?)(?:${NUMBER_WORD})){3,}(?![\\p{L}])`, "giu");
/** Adresse mail écrite en mots : « fred at gmail point com », « fred arobase gmail . fr ». */
const SPELLED_EMAIL =
  /[\p{L}\p{N}._%+-]+\s*(?:\(?\s*(?:at|arobase|arobaz)\s*\)?|\[at\])\s*[\p{L}\p{N}-]+(?:\s*(?:point|dot|\.)\s*[\p{L}\p{N}-]+)*\s*(?:point|dot|\.)\s*(?:com|fr|net|org|be|ch|eu|io|me|co)(?![\p{L}])/giu;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "");
}

/** Expression de recherche des prénoms (avec et sans accents, du plus long au plus court). */
export function namesPattern(names: readonly string[]): RegExp | null {
  const all = new Set<string>();
  for (const raw of names) {
    // Prénom composé ou nom complet : chaque partie compte.
    for (const part of raw.split(/[\s]+/u)) {
      const n = part.trim().replace(/^@/, "");
      if (n.length < 2) continue;
      all.add(n);
      all.add(stripAccents(n));
    }
  }
  if (!all.size) return null;
  const alts = [...all].sort((a, b) => b.length - a.length).map(escapeRegExp);
  // « julie_75 », « fred93 » : un prénom suivi de « _ » ou de chiffres est masqué en entier.
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alts.join("|")})[_\\p{N}]*(?![\\p{L}\\p{N}_])`, "giu");
}

const COMMON_PATTERN = namesPattern(COMMON_FIRST_NAMES)!;

export type AnonymizeOptions = {
  /** Prénom, nom et pseudo de la personne, prénom de la persona… */
  names?: readonly (string | null | undefined)[];
};

/** Texte anonymisé (pur). */
export function anonymizeText(text: string, opts: AnonymizeOptions = {}): string {
  let s = text;
  s = s.replace(EMAIL, MASKS.email);
  s = s.replace(SPELLED_EMAIL, MASKS.email);
  s = s.replace(URL_SCHEME, MASKS.link);
  s = s.replace(URL_DOMAIN, MASKS.link);
  s = s.replace(HANDLE, MASKS.handle);
  s = s.replace(ADDRESS, MASKS.address);
  s = s.replace(DIGITS, (m) => ((m.match(/\d/g)?.length ?? 0) >= 6 ? MASKS.phone : m));
  s = s.replace(SPELLED_DIGITS, MASKS.phone);
  s = s.replace(SOCIAL_HANDLE, (_m, net: string, sep: string) => `${net}${sep}${MASKS.handle}`);
  s = s.replace(HANDLE_LIKE, MASKS.handle);
  s = s.replace(INTRO, (_m, intro: string, space: string) => `${intro}${space}${MASKS.name}`);
  s = s.replace(PLACE, (_m, verb: string, space: string) => `${verb}${space}${MASKS.address}`);
  s = s.replace(PRESENT, (_m, intro: string, space: string) => `${intro}${space}${MASKS.name}`);
  const own = namesPattern((opts.names ?? []).filter((n): n is string => typeof n === "string" && n.trim() !== ""));
  if (own) s = s.replace(own, MASKS.name);
  s = s.replace(COMMON_PATTERN, MASKS.name);
  return s;
}

/** Vrai si le texte contient encore une donnée que l'anonymisation retirerait (contrôle des sorties de l'IA). */
export function containsPersonalData(text: string, opts: AnonymizeOptions = {}): boolean {
  return anonymizeText(text, opts) !== text;
}

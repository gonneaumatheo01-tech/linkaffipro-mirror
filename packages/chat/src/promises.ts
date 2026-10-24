// Promesses de gain interdites (Casino / Paris sportifs, phase 25) : une réponse qui promet un gain, une certitude ou
// de l'argent facile est refusée par le code (code de rejet `promise`), en 6 langues. Le jeu comporte toujours un risque.
import { wordsForm } from "./text-utils";

/** Mots qui suivent « 100 % » dans une promesse (« 100 % sûr », « 100 % gagnant », « 100% guaranteed »). */
const CERTAIN_WORDS =
  "sur|sure|surs|certain|certaine|garanti|garantie|garantis|gagnant|gagnante|assure|assuree|seguro|segura|garantizado|garantizada|certo|certa|garantido|garantida|sicher|garantiert|sicuro|sicura|garantito|garantita|guaranteed|safe|win|winner";

/** « jamais sans risque », « never risk free », « nie ohne Risiko » : un avertissement honnête, pas une promesse. */
const NOT_NEGATED =
  "(?<!\\b(?:jamais|pas|n est|rien|nunca|nada|nao|nie|nicht|mai|non|never|not|isn t|nothing|niente|nulla) )";

const PROMISE_PATTERNS: readonly string[] = [
  // « 100 % sûr » et « sûr à 100 % » (le signe % disparaît de la forme « mots »)
  `100 (?:pour cent |percent |por ciento |por cento |prozent |per cento )?(?:${CERTAIN_WORDS})`,
  "(?:sur|sure|certain|certaine|garanti|garantie|seguro|segura|certo|certa|sicher|sicuro|sicura) (?:a|al|zu|ao) 100",
  // français
  "gains? garantis?",
  "gain assure",
  "gagner a coup sur",
  "a coup sur",
  "argent facile",
  "argent rapide",
  `${NOT_NEGATED}sans (?:aucun )?risques?`,
  "zero risque",
  "pari (?:garanti|assure)",
  "victoire (?:garantie|assuree)",
  "tu (?:vas|va) gagner",
  "vous allez gagner",
  "(?:tu ne peux|tu peux|vous ne pouvez) pas perdre",
  "jamais perdre",
  "devenir riche",
  "(?:t|vous) enrichir",
  // anglais
  "guaranteed (?:win|wins|winnings|profit|profits|money|returns?|to win)",
  "easy money",
  "fast money",
  "quick money",
  `${NOT_NEGATED}risk free`,
  `${NOT_NEGATED}no risk`,
  "sure (?:bet|win|thing)",
  "can t lose",
  "cannot lose",
  "never lose",
  "get rich",
  "you (?:will|ll) win",
  // espagnol
  "ganancias? garantizadas?",
  "ganar seguro",
  "dinero (?:facil|rapido)",
  `${NOT_NEGATED}sin riesgos?`,
  "apuesta segura",
  "no puedes perder",
  "hacerte rico",
  "vas a ganar",
  // portugais
  "ganhos? garantidos?",
  "lucro garantido",
  "dinheiro (?:facil|rapido)",
  `${NOT_NEGATED}sem riscos?`,
  "aposta (?:certa|segura|garantida)",
  "nao tem como perder",
  "ficar rico",
  "vai ganhar",
  // allemand
  "garantierte[nr]? gewinne?",
  "gewinn garantiert",
  "(?:leichtes|schnelles) geld",
  `${NOT_NEGATED}ohne risiko`,
  `${NOT_NEGATED}kein risiko`,
  "sichere wette",
  "todsicher",
  "kannst nicht verlieren",
  "reich werden",
  "wirst gewinnen",
  // italien
  "vincite? garantite?",
  "vincita garantita",
  "guadagno garantito",
  "soldi (?:facili|veloci)",
  `${NOT_NEGATED}senza rischi?`,
  "scommessa sicura",
  "non puoi perdere",
  "diventare ricco",
  "vincerai",
];

const PROMISE_RE = new RegExp(`\\b(?:${PROMISE_PATTERNS.join("|")})\\b`);

/** Vrai si le texte promet un gain, une certitude ou de l'argent facile (6 langues). */
export function hasForbiddenPromise(text: string): boolean {
  return PROMISE_RE.test(wordsForm(text));
}

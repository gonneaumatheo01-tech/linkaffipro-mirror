// Demande d'arrêt écrite sans la commande (« stop », « STOP », « arrête de m'écrire », « unsubscribe »), en 6 langues
// (règle 5 du client : pas de spam, respect des membres). Deux niveaux :
// - `isStopRequest` : le message ne contient QUE la demande d'arrêt (formules de politesse, ponctuation et emojis mis
//   à part) → traité exactement comme /stop par le bot (définitif) ;
// - `mentionsStopRequest` : le message contient une demande d'arrêt au milieu d'autre chose (« arrête de m'écrire,
//   j'en ai marre ») → l'assistante répond une dernière fois, aucune relance n'est programmée.
// Fonctions pures.
import { foldText } from "./text-utils";

/**
 * Demandes d'arrêt sans ambiguïté, reconnues même au milieu d'une phrase (forme « mots » : minuscules, sans accents,
 * apostrophes en espaces).
 */
const CLEAR_PHRASES: readonly string[] = [
  // français
  "arrete de m ecrire",
  "arretez de m ecrire",
  "arrete de m envoyer des messages",
  "arretez de m envoyer des messages",
  "ne m ecris plus",
  "ne m ecrivez plus",
  "laisse moi tranquille",
  "laissez moi tranquille",
  "desinscription",
  "desinscris moi",
  "desinscrivez moi",
  "desabonnement",
  "desabonne moi",
  "je ne veux plus de messages",
  "je veux plus recevoir de messages",
  "je ne veux plus recevoir de messages",
  // anglais
  "unsubscribe",
  "stop messaging me",
  "stop texting me",
  "stop writing to me",
  "stop writing me",
  "stop sending me messages",
  "leave me alone",
  "don t text me",
  "dont text me",
  "don t message me",
  "dont message me",
  "don t write to me",
  // espagnol
  "deja de escribirme",
  "dejad de escribirme",
  "no me escribas mas",
  "dejame en paz",
  "darme de baja",
  // portugais
  "para de me escrever",
  "pare de me escrever",
  "para de me mandar mensagem",
  "pare de me mandar mensagem",
  "nao me escreva mais",
  "nao me escreve mais",
  "me deixa em paz",
  "descadastrar",
  // allemand
  "lass mich in ruhe",
  "schreib mir nicht mehr",
  "schreiben sie mir nicht mehr",
  "abmelden",
  // italien
  "smettila di scrivermi",
  "non scrivermi piu",
  "lasciami in pace",
  "disiscrivimi",
  "cancellami",
];

/**
 * Mots courts reconnus SEULEMENT quand ils sont seuls dans le message (« STOP », « stop stp », « basta ») : au milieu
 * d'une phrase ils ont souvent un autre sens (« stop, t'es trop drôle », « para ti »). « Arrête » seul n'en fait pas
 * partie : c'est presque toujours une taquinerie.
 */
const ALONE_WORDS: readonly string[] = [
  "stop",
  "stopp",
  "stop les messages",
  "stop messages",
  "opt out",
  "optout",
  "basta",
  "para",
  "pare",
  "parar",
  "chega",
  "hor auf",
  "hoer auf",
  "horen sie auf",
  "smettila",
];

/** Formules de politesse autour de la demande (« stop stp », « please stop », « basta por favor, gracias »). */
const COURTESY = new Set(
  (
    "stp svp s il te plait s il vous plait please pls plz por favor porfa porfavor bitte per favore merci thanks " +
    "thank you thx gracias obrigado obrigada danke grazie ok okay maintenant now ahora agora jetzt adesso " +
    "vraiment really"
  ).split(" "),
);

/**
 * Emojis qui accompagnent une vraie demande d'arrêt (« STOP 🛑 », « stop ✋ », « stop 😡 ») ; tout autre emoji (« stop 😂 »,
 * « stop 🙈 », « stop 😘 ») en fait une taquinerie.
 */
const STOP_EMOJIS = new Set([
  "🛑",
  "✋",
  "🚫",
  "⛔",
  "🙅",
  "🤚",
  "❌",
  "😡",
  "😠",
  "🤬",
  "😤",
  "👋",
  "✖",
]);

function hasPlayfulEmoji(text: string): boolean {
  for (const m of text.matchAll(/\p{Extended_Pictographic}/gu))
    if (!STOP_EMOJIS.has(m[0])) return true;
  return false;
}
const LAUGH_WORDS =
  /\b(?:mdr+|ptdr+|lol+|(?:ha){2,}|(?:ah){2,}|(?:hi){2,}|(?:je){2,}|(?:ja){2,}|k{3,}|xd+|lmao)\b/;

/** Forme « mots » : minuscules sans accents, apostrophes, ponctuation et emojis en espaces. */
function stopWords(text: string): string {
  return foldText(text)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const ALONE_SET = new Set([...ALONE_WORDS, ...CLEAR_PHRASES]);
const CLEAR_RE = new RegExp(`\\b(?:${CLEAR_PHRASES.join("|")})\\b`);

function withoutCourtesy(words: string[]): string[] {
  const out = [...words];
  // Politesse en début et en fin (« stp », « s il te plait », « please », « merci »), une ou plusieurs fois.
  const trim = (fromStart: boolean): boolean => {
    for (const len of [4, 3, 2, 1]) {
      if (out.length < len) continue;
      const part = fromStart ? out.slice(0, len) : out.slice(out.length - len);
      if (COURTESY.has(part.join(" "))) {
        if (fromStart) out.splice(0, len);
        else out.splice(out.length - len, len);
        return true;
      }
    }
    return false;
  };
  while (out.length > 0 && (trim(true) || trim(false)));
  return out;
}

/**
 * Le message ne contient QUE une demande d'arrêt (« stop », « STOP !!! », « stop stp », « arrête de m'écrire »,
 * « unsubscribe », « basta », « hör auf », « smettila ») : à traiter comme /stop. Jamais quand la personne rit
 * (« stop 😂 », « arrête mdr ») ni quand la demande est noyée dans une phrase (« stop, t'es trop drôle »).
 */
export function isStopRequest(text: string | null | undefined): boolean {
  const raw = text ?? "";
  if (!raw.trim() || raw.trim().startsWith("/")) return false;
  if (hasPlayfulEmoji(raw)) return false;
  const words = stopWords(raw);
  if (!words || LAUGH_WORDS.test(words)) return false;
  const rest = withoutCourtesy(words.split(" "));
  if (rest.length === 0) return false;
  if (ALONE_SET.has(rest.join(" "))) return true;
  // « stop stop », « stop stop stop » : la même demande répétée.
  const unique = [...new Set(rest)];
  return unique.length === 1 && ALONE_SET.has(unique[0]!);
}

/**
 * Le message contient une demande d'arrêt (seule ou dans une phrase : « arrête de m'écrire, j'en ai marre »,
 * « please stop messaging me »). Les mots courts et ambigus (« stop », « para », « basta ») ne comptent que seuls.
 * Les rires ne comptent pas (« laisse-moi tranquille mdr »).
 */
export function mentionsStopRequest(text: string | null | undefined): boolean {
  if (isStopRequest(text)) return true;
  const words = stopWords(text ?? "");
  if (!words || LAUGH_WORDS.test(words)) return false;
  return CLEAR_RE.test(words);
}

/**
 * Vocal de l'admin (phase 20) : le texte transcrit est traité EXACTEMENT comme un message écrit (`handleAdminText` :
 * commandes, réponses aux demandes, choix numérotés, OUI / non), après une ligne « J'ai compris : "…". ». Un vocal
 * n'est jamais pris pour une clé : pendant une demande SECRET, ou si le texte ressemble à « clé … » / « bookmaker … »,
 * rien n'est enregistré et le texte n'est ni répété ni journalisé. La transcription elle-même est faite par l'appelant
 * (worker) ; ici, aucun réseau.
 */
import type { AgentsDeps } from "../types";
import { currentHumanRequest } from "../human/requests";
import { normalizeText } from "../human/answer";
import { isSecretCommandText, parseAdminCommand } from "./commands";
import { handleAdminText, VOICE_SECRET_REFUSAL } from "./handle";
import { agentEvent, esc } from "./journal";

export const VOICE_NOT_UNDERSTOOD = "🎧 Je n'ai pas compris ton vocal : réécris-le (ou renvoie un vocal plus près du micro).";
export const VOICE_UNHANDLED =
  "Je ne sais pas quoi faire de ce message : réécris-le, ou dis par exemple « agents », « pause dating », « ok 12 ».";

const NUMBER_WORDS: Record<string, string> = {
  zero: "0",
  un: "1",
  une: "1",
  premier: "1",
  premiere: "1",
  deux: "2",
  deuxieme: "2",
  second: "2",
  seconde: "2",
  trois: "3",
  troisieme: "3",
  quatre: "4",
  cinq: "5",
  six: "6",
  sept: "7",
  huit: "8",
  neuf: "9",
  dix: "10",
  onze: "11",
  douze: "12",
  treize: "13",
  quatorze: "14",
  quinze: "15",
  seize: "16",
  vingt: "20",
  cinquante: "50",
  cent: "100",
  "deux cents": "200",
};

const YES_HEADS = new Set(["oui", "ouais", "ok", "okay", "d'accord", "daccord", "yes", "vas-y", "go"]);
const NUMBER_FILLERS = new Set(["le", "la", "l'", "numero", "n°", "choix", "option", "reponse"]);
const NUMBERED_COMMANDS = new Set(["ok", "non", "niveau", "budget"]);

/**
 * Remet la transcription à la forme d'un message écrit : guillemets et ponctuation d'élocution retirés (« Pause,
 * dating. » → « Pause dating »), nombre dit en lettres → chiffre (« le deux » → « 2 », « ok douze » → « ok 12 »),
 * « Oui, vas-y » → « oui ». Une adresse (https://…) n'est pas abîmée.
 */
export function voiceToAdminText(transcript: string): string {
  let t = transcript
    .trim()
    .replace(/^[\s"«»“”'’]+|[\s"«»“”'’]+$/g, "")
    .replace(/[,;](?=\s|$)/g, " ")
    .replace(/:(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?…]+$/u, "")
    .trim();
  if (!t) return "";
  const words = t.split(" ");
  const norm = words.map((w) => normalizeText(w));

  // « deux cents » en un seul nombre.
  for (let i = 0; i < norm.length - 1; i++)
    if (norm[i] === "deux" && (norm[i + 1] === "cents" || norm[i + 1] === "cent")) {
      words.splice(i, 2, "200");
      norm.splice(i, 2, "200");
    }

  // Réponse « le deux », « numéro 3 », « trois » → le chiffre seul.
  const core = norm.filter((w, i) => !(i < norm.length - 1 && NUMBER_FILLERS.has(w)));
  if (core.length === 1) {
    const only = core[0]!;
    const digit = NUMBER_WORDS[only] ?? (/^\d{1,6}$/.test(only) ? only : null);
    if (digit && (core.length !== norm.length || NUMBER_WORDS[only])) return digit;
  }

  // Commande à numéro (« ok douze », « niveau dating deux ») : nombres en lettres → chiffres.
  if (NUMBERED_COMMANDS.has(norm[0]!) && words.length >= 2)
    t = words.map((w, i) => (i > 0 && NUMBER_WORDS[norm[i]!] ? NUMBER_WORDS[norm[i]!]! : w)).join(" ");
  else t = words.join(" ");

  // « Oui, vas-y » / « Non merci » (4 mots au plus, sans chiffre : sinon c'est « ok 12 » ou « non 12 … »).
  if (words.length > 1 && words.length <= 4 && !/\d/.test(t)) {
    if (YES_HEADS.has(norm[0]!)) return "oui";
    if (norm[0] === "non") return "non";
  }
  return t;
}

/** Au moins deux lettres : sinon le vocal n'a rien donné d'exploitable. */
function hasWords(text: string): boolean {
  return text.replace(/[^\p{L}\p{N}]/gu, "").length >= 2 || /^\d$/.test(text);
}

/** Un long morceau sans espace mêlant lettres et chiffres ressemble à une clé dictée : jamais traité. */
function looksLikeKey(text: string): boolean {
  return text.split(/\s+/).some((w) => w.length >= 20 && /\d/.test(w) && /[a-z]/i.test(w) && !/^https?:\/\//i.test(w));
}

export type AdminVoiceInput = {
  /** Texte rendu par le transcripteur ; null = rien d'exploitable. */
  transcript: string | null;
  messageId: number;
  replyToMessageId?: number | null;
};

export type AdminVoiceOutcome = "not-understood" | "secret-refused" | "handled" | "unhandled";

/**
 * Traite un vocal transcrit. `say` envoie un message à l'admin (dans l'ordre : « J'ai compris … », puis la réponse) ;
 * la question suivante d'une demande close part après (comme pour un texte).
 */
export async function handleAdminVoice(
  deps: AgentsDeps,
  input: AdminVoiceInput,
  say: (html: string) => Promise<void>,
): Promise<{ outcome: AdminVoiceOutcome }> {
  const text = input.transcript ? voiceToAdminText(input.transcript) : "";
  const done = async (outcome: AdminVoiceOutcome, extra: Record<string, unknown> = {}) => {
    await agentEvent(deps, "agents.admin.voice", { messageId: input.messageId, outcome, chars: text.length, ...extra });
    return { outcome };
  };
  if (!text || !hasWords(text)) {
    await say(VOICE_NOT_UNDERSTOOD);
    return done("not-understood");
  }

  // Jamais une clé par vocal : ni enregistrée, ni répétée, ni journalisée.
  let secretContext = isSecretCommandText(text) || looksLikeKey(text);
  if (!secretContext && input.replyToMessageId) {
    const target = await deps.prisma.humanRequest.findFirst({
      where: { telegramMessageId: input.replyToMessageId, status: { in: ["QUEUED", "PENDING"] } },
    });
    secretContext = target?.kind === "SECRET";
  }
  if (!secretContext) {
    const current = await currentHumanRequest(deps);
    // Pendant une demande de clé, seule une commande connue (« plus tard », « agents », « pause dating »…) passe.
    if (current?.kind === "SECRET" && parseAdminCommand(text) === null) secretContext = true;
  }
  if (secretContext) {
    await say(VOICE_SECRET_REFUSAL);
    return done("secret-refused");
  }

  await say(`🎧 J'ai compris : "${esc(text)}".`);
  const r = await handleAdminText(deps, {
    text,
    messageId: input.messageId,
    replyToMessageId: input.replyToMessageId ?? null,
    source: "voice",
  });
  if (!r.handled) {
    await say(VOICE_UNHANDLED);
    return done("unhandled", { text: text.slice(0, 200) });
  }
  if (r.reply) await say(r.reply);
  if (r.followUp) await r.followUp();
  return done("handled", r.secret ? {} : { text: text.slice(0, 200) });
}

// Profil Telegram d'un bot assistant de conversation (phase 17, contrat § 0 règle 2 et § 4) : description, description
// courte et commandes, par langue de la persona. Règles pures (testées) ; les appels à Telegram sont dans service.ts.
import {
  assistantRole,
  chatLangOf,
  CHAT_LANGS,
  deniesBeingAssistant,
  type ChatLang,
} from "@linkaffipro/chat";

/** Bornes de Telegram : description ≤ 512 caractères, description courte ≤ 120. */
export const BOT_DESCRIPTION_MAX = 512;
export const BOT_SHORT_DESCRIPTION_MAX = 120;

/** Le texte dit-il que c'est un assistant (« assistant », « assistante », « asistente », « Assistentin »…) ? */
export function mentionsAssistant(text: string | null | undefined): boolean {
  return /assist[ae]nt|asistent/i.test(text ?? "");
}

/**
 * Texte de profil acceptable (règle 2 du client) : il dit « assistant(e) » ET ne prétend pas être une vraie personne ni
 * ne nie être une IA (« je ne suis pas une assistante, juste une vraie fille » est refusé), même règle que les réponses.
 */
export function assistantProfileTextOk(text: string | null | undefined): boolean {
  return mentionsAssistant(text) && !deniesBeingAssistant(text ?? "");
}

const DESCRIPTIONS: Record<ChatLang, { long: string; short: string }> = {
  fr: {
    long: "Moi c'est {name}, {role} du canal : une IA, pas une vraie personne. Écris-moi quand tu veux ! /stop pour arrêter, /reset pour tout effacer.",
    short: "{name}, {role} du canal (une IA)",
  },
  en: {
    long: "I'm {name}, {role} of the channel: an AI, not a real person. Message me anytime! /stop to stop, /reset to erase everything.",
    short: "{name}, {role} of the channel (an AI)",
  },
  es: {
    long: "Soy {name}, {role} del canal: una IA, no una persona real. ¡Escríbeme cuando quieras! /stop para parar, /reset para borrarlo todo.",
    short: "{name}, {role} del canal (una IA)",
  },
  pt: {
    long: "Eu sou {name}, {role} do canal: uma IA, não uma pessoa real. Me escreva quando quiser! /stop para parar, /reset para apagar tudo.",
    short: "{name}, {role} do canal (uma IA)",
  },
  de: {
    long: "Ich bin {name}, {role} des Kanals: eine KI, keine echte Person. Schreib mir, wann du willst! /stop zum Beenden, /reset um alles zu löschen.",
    short: "{name}, {role} des Kanals (eine KI)",
  },
  it: {
    long: "Sono {name}, {role} del canale: un'IA, non una persona reale. Scrivimi quando vuoi! /stop per fermare, /reset per cancellare tutto.",
    short: "{name}, {role} del canale (un'IA)",
  },
};

const COMMANDS: Record<ChatLang, { start: string; stop: string; reset: string }> = {
  fr: {
    start: "Commencer la conversation",
    stop: "Arrêter la conversation",
    reset: "Tout effacer et recommencer",
  },
  en: {
    start: "Start the conversation",
    stop: "Stop the conversation",
    reset: "Erase everything and start over",
  },
  es: {
    start: "Empezar la conversación",
    stop: "Detener la conversación",
    reset: "Borrarlo todo y empezar de nuevo",
  },
  pt: { start: "Começar a conversa", stop: "Parar a conversa", reset: "Apagar tudo e recomeçar" },
  de: {
    start: "Unterhaltung beginnen",
    stop: "Unterhaltung beenden",
    reset: "Alles löschen und neu beginnen",
  },
  it: {
    start: "Iniziare la conversazione",
    stop: "Interrompere la conversazione",
    reset: "Cancellare tutto e ricominciare",
  },
};

function fill(template: string, name: string, role: string): string {
  return template
    .replace("{name}", () => name)
    .replace("{role}", () => role)
    .replace(/\s+/g, " ")
    .trim();
}

/** Persona telle que la lit le profil du bot. */
export type ProfilePersona = {
  name: string;
  gender: string | null;
  languages: readonly string[];
  botDescription: string | null;
  botShortDescription: string | null;
};

/** Textes et commandes d'une langue (`languageCode` null = valeur par défaut de Telegram, toutes langues). */
export type ProfileEntry = {
  languageCode: ChatLang | null;
  description: string;
  shortDescription: string;
  commands: Array<{ command: "start" | "stop" | "reset"; description: string }>;
};

export type AssistantProfilePlan = {
  entries: ProfileEntry[];
  /** Langues posées (pour les retirer si le bot redevient un bot normal). */
  languages: ChatLang[];
  /** Textes de la persona refusés (trop longs, ou qui ne disent pas « assistant(e) ») : texte par défaut utilisé. */
  warnings: string[];
};

/** Langues de la persona parmi les 6 du bot (sans doublon), français si aucune. */
export function personaChatLangs(languages: readonly string[]): ChatLang[] {
  const out: ChatLang[] = [];
  for (const l of languages) {
    const c = chatLangOf(l);
    if (c && !out.includes(c)) out.push(c);
  }
  return out.length > 0 ? out : ["fr"];
}

/**
 * Texte de la persona accepté seulement s'il dit « assistant(e) », ne nie pas être une IA ni ne prétend être une vraie
 * personne, et tient dans la borne de Telegram.
 */
function customText(
  value: string | null,
  max: number,
  label: string,
  warnings: string[],
): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  if (text.length > max) {
    warnings.push(
      `${label} de la persona trop longue (${max} caractères au plus) : texte par défaut utilisé.`,
    );
    return null;
  }
  if (!mentionsAssistant(text)) {
    warnings.push(
      `${label} de la persona refusée : elle doit dire que c'est l'assistante ou l'assistant du canal. Texte par défaut utilisé.`,
    );
    return null;
  }
  if (deniesBeingAssistant(text)) {
    warnings.push(
      `${label} de la persona refusée : elle ne doit jamais laisser croire à une vraie personne ni nier être une IA. Texte par défaut utilisé.`,
    );
    return null;
  }
  return text;
}

/**
 * Profil d'un bot assistant : pour chaque langue de la persona (et par défaut, dans sa première langue), description
 * et description courte qui DISENT que c'est l'assistante / l'assistant du canal (une IA), et les commandes `/start`,
 * `/stop`, `/reset` traduites. Les textes écrits dans la fiche de la persona remplacent ceux de sa première langue (et
 * la valeur par défaut) s'ils disent « assistant(e) » et respectent les bornes ; sinon ils sont refusés.
 */
export function assistantProfilePlan(persona: ProfilePersona): AssistantProfilePlan {
  const warnings: string[] = [];
  const langs = personaChatLangs(persona.languages);
  const longCustom = customText(
    persona.botDescription,
    BOT_DESCRIPTION_MAX,
    "Description",
    warnings,
  );
  const shortCustom = customText(
    persona.botShortDescription,
    BOT_SHORT_DESCRIPTION_MAX,
    "Description courte",
    warnings,
  );
  const name = persona.name.trim() || "Léa";
  const entryFor = (
    lang: ChatLang,
    languageCode: ChatLang | null,
    first: boolean,
  ): ProfileEntry => {
    const role = assistantRole(lang, persona.gender);
    const d = DESCRIPTIONS[lang];
    const c = COMMANDS[lang];
    return {
      languageCode,
      description: (first && longCustom) || fill(d.long, name, role).slice(0, BOT_DESCRIPTION_MAX),
      shortDescription:
        (first && shortCustom) || fill(d.short, name, role).slice(0, BOT_SHORT_DESCRIPTION_MAX),
      commands: [
        { command: "start", description: c.start },
        { command: "stop", description: c.stop },
        { command: "reset", description: c.reset },
      ],
    };
  };
  const entries: ProfileEntry[] = [entryFor(langs[0]!, null, true)];
  langs.forEach((lang, i) => entries.push(entryFor(lang, lang, i === 0)));
  return { entries, languages: langs, warnings };
}

/** Toutes les langues que le bot connaît (remise à vide d'un profil posé par nous). */
export const PROFILE_LANGS: readonly ChatLang[] = CHAT_LANGS;

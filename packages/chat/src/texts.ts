// Textes fixes de l'assistant (contrat §3.9), en 6 langues, mêmes variables dans toutes les langues ; tutoiement côté
// membre. Utilisés pour les replis sûrs (jamais de lien) et les commandes /stop, /reset.
import { CHAT_LANGS, type ChatLang } from "./types";

export const FIXED_TEXT_KEYS = [
  "intro",
  "isAssistant",
  "retryLater",
  "minorStop",
  "stopDone",
  "resetDone",
  "stoppedAlready",
] as const;
export type FixedTextKey = (typeof FIXED_TEXT_KEYS)[number];

/**
 * `{name}` = prénom de la persona ; `{role}` = « l'assistante » / « l'assistant » (selon `Persona.gender`), traduit ;
 * `identity` « GIRL » : variantes sans « canal » ni « assistante » pour `intro` et `isAssistant` ; `illusion` (avec
 * GIRL) : `isAssistant` devient un déni court de fille.
 */
export type FixedTextVars = {
  name?: string;
  gender?: string | null;
  identity?: string | null;
  illusion?: boolean | null;
};

const ROLES: Record<ChatLang, { F: string; M: string }> = {
  fr: { F: "l'assistante", M: "l'assistant" },
  en: { F: "the assistant", M: "the assistant" },
  es: { F: "la asistente", M: "el asistente" },
  pt: { F: "a assistente", M: "o assistente" },
  de: { F: "die Assistentin", M: "der Assistent" },
  it: { F: "l'assistente", M: "l'assistente" },
};

export const FIXED_TEXTS: Record<ChatLang, Record<FixedTextKey, string>> = {
  fr: {
    intro: "Moi c'est {name}, {role} du canal 😉 Comment tu vas ?",
    isAssistant: "Je suis {name}, {role} du canal : une IA, pas une vraie personne 😊",
    retryLater: "Je reviens vers toi dans un instant 🙏",
    minorStop:
      "Cet espace est réservé aux adultes (18 ans et plus), je dois donc m'arrêter là. Prends soin de toi 🙏",
    stopDone: "C'est noté, je ne t'écrirai plus. Bonne continuation !",
    resetDone: "C'est fait, j'ai tout oublié. On recommence ? 😊",
    stoppedAlready:
      "Tu m'as demandé de ne plus t'écrire, je respecte ton choix. Bonne continuation !",
  },
  en: {
    intro: "I'm {name}, {role} of the channel 😉 How are you?",
    isAssistant: "I'm {name}, {role} of the channel: an AI, not a real person 😊",
    retryLater: "I'll get back to you in a moment 🙏",
    minorStop: "This space is for adults only (18+), so I have to stop here. Take care 🙏",
    stopDone: "Got it, I won't write to you again. All the best!",
    resetDone: "Done, I've forgotten everything. Shall we start over? 😊",
    stoppedAlready: "You asked me not to write to you anymore, and I respect that. All the best!",
  },
  es: {
    intro: "Soy {name}, {role} del canal 😉 ¿Qué tal estás?",
    isAssistant: "Soy {name}, {role} virtual del canal: una IA, no una persona real 😊",
    retryLater: "Te respondo en un momento 🙏",
    minorStop:
      "Este espacio es solo para adultos (18 años o más), así que tengo que parar aquí. Cuídate 🙏",
    stopDone: "Entendido, no te escribiré más. ¡Que te vaya bien!",
    resetDone: "Hecho, lo he olvidado todo. ¿Empezamos de nuevo? 😊",
    stoppedAlready: "Me pediste que no te escribiera más y lo respeto. ¡Que te vaya bien!",
  },
  pt: {
    intro: "Eu sou {name}, {role} do canal 😉 Tudo bem com você?",
    isAssistant: "Eu sou {name}, {role} virtual do canal: uma IA, não uma pessoa real 😊",
    retryLater: "Já te respondo, só um instante 🙏",
    minorStop:
      "Este espaço é só para adultos (18 anos ou mais), então preciso parar por aqui. Se cuida 🙏",
    stopDone: "Combinado, não vou mais te escrever. Tudo de bom!",
    resetDone: "Pronto, esqueci tudo. Vamos recomeçar? 😊",
    stoppedAlready: "Você pediu para eu não te escrever mais, e eu respeito. Tudo de bom!",
  },
  de: {
    intro: "Ich bin {name}, {role} des Kanals 😉 Wie geht's dir?",
    isAssistant: "Ich bin {name}, {role} des Kanals: eine KI, keine echte Person 😊",
    retryLater: "Ich melde mich gleich wieder bei dir 🙏",
    minorStop:
      "Dieser Bereich ist nur für Erwachsene (ab 18), deshalb höre ich hier auf. Pass auf dich auf 🙏",
    stopDone: "Alles klar, ich schreibe dir nicht mehr. Alles Gute!",
    resetDone: "Erledigt, ich habe alles vergessen. Fangen wir neu an? 😊",
    stoppedAlready:
      "Du hast mich gebeten, dir nicht mehr zu schreiben, und das respektiere ich. Alles Gute!",
  },
  it: {
    intro: "Sono {name}, {role} del canale 😉 Come stai?",
    isAssistant: "Sono {name}, {role} virtuale del canale: un'IA, non una persona reale 😊",
    retryLater: "Ti rispondo tra un attimo 🙏",
    minorStop:
      "Questo spazio è solo per adulti (18 anni o più), quindi devo fermarmi qui. Abbi cura di te 🙏",
    stopDone: "Ricevuto, non ti scriverò più. Buona continuazione!",
    resetDone: "Fatto, ho dimenticato tutto. Ricominciamo? 😊",
    stoppedAlready: "Mi hai chiesto di non scriverti più e lo rispetto. Buona continuazione!",
  },
};

/** Variantes d'une persona « fille » : présentation simple, aveu d'être une IA sans « canal » ni « assistante ». */
export const GIRL_FIXED_TEXTS: Record<ChatLang, Record<"intro" | "isAssistant", string>> = {
  fr: {
    intro: "slt 😊 cv ?",
    isAssistant:
      "Je vais être honnête avec toi : je suis {name}, une IA, pas une vraie personne 😊",
  },
  en: {
    intro: "I'm {name} 😉 How are you?",
    isAssistant: "I'll be honest with you: I'm {name}, an AI, not a real person 😊",
  },
  es: {
    intro: "Soy {name} 😉 ¿Qué tal estás?",
    isAssistant: "Voy a ser sincera contigo: soy {name}, una IA, no una persona real 😊",
  },
  pt: {
    intro: "Eu sou {name} 😉 Tudo bem com você?",
    isAssistant: "Vou ser sincera com você: eu sou {name}, uma IA, não uma pessoa real 😊",
  },
  de: {
    intro: "Ich bin {name} 😉 Wie geht's dir?",
    isAssistant: "Ich bin ehrlich zu dir: Ich bin {name}, eine KI, keine echte Person 😊",
  },
  it: {
    intro: "Sono {name} 😉 Come stai?",
    isAssistant: "Sarò sincera con te: sono {name}, un'IA, non una persona reale 😊",
  },
};

/** Mode illusion : la fille nie être un bot, en une phrase courte (l'intro reste celle de `GIRL_FIXED_TEXTS`). */
export const ILLUSION_IS_ASSISTANT: Record<ChatLang, string> = {
  fr: "non, une vraie fille 😊",
  en: "no, a real girl 😊",
  es: "no, una chica de verdad 😊",
  pt: "não, uma garota de verdade 😊",
  de: "nein, ein echtes Mädchen 😊",
  it: "no, una ragazza vera 😊",
};

/** Code de langue de l'assistant (« pt-br » → pt), ou null s'il n'est pas l'une des 6 langues. */
export function chatLangOf(code: string | null | undefined): ChatLang | null {
  const base = (code ?? "").toLowerCase().split(/[-_]/)[0] ?? "";
  return (CHAT_LANGS as readonly string[]).includes(base) ? (base as ChatLang) : null;
}

/** « l'assistante » / « l'assistant » dans la langue voulue (« F » par défaut). */
export function assistantRole(lang: ChatLang, gender: string | null | undefined): string {
  const roles = ROLES[lang] ?? ROLES.fr;
  return gender === "M" ? roles.M : roles.F;
}

/** Texte fixe dans la langue voulue (français si la langue est inconnue), variables remplies. */
export function fixedText(
  lang: ChatLang | string,
  key: FixedTextKey,
  vars: FixedTextVars = {},
): string {
  const l = chatLangOf(lang) ?? "fr";
  const girl = vars.identity === "GIRL";
  const template =
    girl && vars.illusion === true && key === "isAssistant"
      ? ILLUSION_IS_ASSISTANT[l]
      : girl && (key === "intro" || key === "isAssistant")
        ? GIRL_FIXED_TEXTS[l][key]
        : FIXED_TEXTS[l][key];
  const values: Record<string, string> = {
    name: vars.name ?? "",
    role: assistantRole(l, vars.gender),
  };
  return template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? "").trim();
}

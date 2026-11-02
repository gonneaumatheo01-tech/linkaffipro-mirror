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
  // Passage à un humain (Casino / Paris sportifs, phase 25) : réponse neutre, sans promesse ni délai chiffré.
  "handoff",
  // Repli en pleine conversation quand le modèle n'a rien donné d'envoyable : neutre et naturel.
  "midConv",
  // Série de photos : relance unique et courte quand le lien vient de partir et qu'il ne répond pas.
  "linkNudge",
  // Série de photos : réaction à une photo reçue (elle ne la regarde pas, consigne du client).
  "photoReaction",
  // Passage à l'équipe déjà annoncé au message d'avant : on ne répète pas la même phrase.
  "handoffAgain",
  // Gérant du VIP : dépôt confirmé mais lien du canal VIP introuvable, l'équipe l'envoie.
  "vipPending",
  // Série de photos : petite phrase qui amène le lien quand il ne reste rien de la réponse (jamais balancé seul).
  "linkLead",
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
  /** Gérant du VIP (Paris sportifs) : « le gérant du VIP » au lieu de « l'assistant ». */
  vipManager?: boolean | null;
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
    retryLater: "attends je reviens 2 sec",
    minorStop:
      "Cet espace est réservé aux adultes (18 ans et plus), je dois donc m'arrêter là. Prends soin de toi 🙏",
    stopDone: "C'est noté, je ne t'écrirai plus. Bonne continuation !",
    resetDone: "C'est fait, j'ai tout oublié. On recommence ? 😊",
    stoppedAlready:
      "Tu m'as demandé de ne plus t'écrire, je respecte ton choix. Bonne continuation !",
    handoff: "Je transmets ta demande à l'équipe : quelqu'un te répond ici dès que possible 🙏",
    midConv: "ah une seconde jreviens",
    linkNudge: "t la ?",
    photoReaction: "t'es mignon hihi",
    handoffAgain: "C'est noté, l'équipe a bien ta demande : quelqu'un te répond ici dès que possible.",
    vipPending: "C'est validé de mon côté : l'équipe t'envoie ton accès au VIP ici dès que possible.",
    linkLead: "tiens viens me voir la bas 😏",
  },
  en: {
    intro: "I'm {name}, {role} of the channel 😉 How are you?",
    isAssistant: "I'm {name}, {role} of the channel: an AI, not a real person 😊",
    retryLater: "I'll get back to you in a moment 🙏",
    minorStop: "This space is for adults only (18+), so I have to stop here. Take care 🙏",
    stopDone: "Got it, I won't write to you again. All the best!",
    resetDone: "Done, I've forgotten everything. Shall we start over? 😊",
    stoppedAlready: "You asked me not to write to you anymore, and I respect that. All the best!",
    handoff: "I'm passing your request on to the team: someone will reply here as soon as possible 🙏",
    midConv: "one sec, brb",
    linkNudge: "you there?",
    photoReaction: "you're cute hihi",
    handoffAgain: "Noted, the team has your request: someone will reply here as soon as possible.",
    vipPending: "All good on my side: the team will send you your VIP access here as soon as possible.",
    linkLead: "here, come see me there 😏",
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
    handoff: "Paso tu solicitud al equipo: alguien te responderá aquí lo antes posible 🙏",
    midConv: "un segundo, ya vuelvo",
    linkNudge: "¿estás?",
    photoReaction: "eres mono jiji",
    handoffAgain: "Anotado, el equipo ya tiene tu solicitud: alguien te responderá aquí lo antes posible.",
    vipPending: "Todo bien por mi parte: el equipo te enviará tu acceso al VIP aquí lo antes posible.",
    linkLead: "toma, ven a verme allí 😏",
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
    handoff: "Vou passar o seu pedido para a equipe: alguém te responde aqui o quanto antes 🙏",
    midConv: "um segundo, já volto",
    linkNudge: "tá aí?",
    photoReaction: "você é fofo hihi",
    handoffAgain: "Anotado, a equipe já tem o seu pedido: alguém te responde aqui o quanto antes.",
    vipPending: "Tudo certo da minha parte: a equipe te envia o acesso ao VIP aqui o quanto antes.",
    linkLead: "toma, vem me ver lá 😏",
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
    handoff: "Ich gebe deine Anfrage an das Team weiter: Jemand antwortet dir hier so schnell wie möglich 🙏",
    midConv: "eine Sekunde, bin gleich wieder da",
    linkNudge: "bist du da?",
    photoReaction: "du bist süß hihi",
    handoffAgain: "Notiert, das Team hat deine Anfrage: Jemand antwortet dir hier so schnell wie möglich.",
    vipPending: "Von meiner Seite passt alles: Das Team schickt dir deinen VIP-Zugang hier so schnell wie möglich.",
    linkLead: "hier, komm mich dort besuchen 😏",
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
    handoff: "Passo la tua richiesta al team: qualcuno ti risponderà qui il prima possibile 🙏",
    midConv: "un secondo, torno subito",
    linkNudge: "ci sei?",
    photoReaction: "sei carino hihi",
    handoffAgain: "Ricevuto, il team ha la tua richiesta: qualcuno ti risponderà qui il prima possibile.",
    vipPending: "Tutto ok da parte mia: il team ti invierà l'accesso al VIP qui il prima possibile.",
    linkLead: "tieni, vieni a trovarmi là 😏",
  },
};

/** Variantes d'une persona « fille » : présentation simple, aveu d'être une IA sans « canal » ni « assistante ». */
export const GIRL_FIXED_TEXTS: Record<ChatLang, Record<"intro" | "isAssistant", string>> = {
  fr: {
    intro: "coucou 😊",
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

/**
 * Gérant du VIP (Paris sportifs) : ses textes fixes dans son registre (comme un pote, minuscules, zéro emoji). Les autres
 * clés gardent les textes communs ; jamais « je reviens » : le gérant du VIP ne fait pas patienter.
 */
export const VIP_FIXED_TEXTS: Record<
  ChatLang,
  Record<"isAssistant" | "handoff" | "handoffAgain" | "vipPending" | "minorStop", string>
> = {
  fr: {
    isAssistant:
      "je vais être honnête avec toi, je suis une IA, {role} du canal. dis-moi ce que tu veux savoir sur le vip",
    handoff:
      "ça je préfère que l'équipe te réponde direct, je leur fais remonter et quelqu'un te répond ici",
    handoffAgain: "c'est bon l'équipe a ton message, quelqu'un te répond ici",
    vipPending: "c'est validé de mon côté, l'équipe t'envoie ton accès au vip ici",
    minorStop:
      "le vip c'est réservé aux majeurs (18 ans et plus), donc je peux pas aller plus loin avec toi. prends soin de toi",
  },
  en: {
    isAssistant:
      "to be honest with you, I'm an AI, {role} of the channel. tell me what you want to know about the VIP",
    handoff:
      "I'd rather the team answers you on that, I'm passing it on and someone will reply here",
    handoffAgain: "the team has your message, someone will reply here",
    vipPending: "all good on my side, the team will send you your VIP access here",
    minorStop:
      "the VIP is for adults only (18+), so I can't go any further with you. take care",
  },
  es: {
    isAssistant:
      "para ser sincero contigo, soy una IA, {role} del canal. dime qué quieres saber del VIP",
    handoff:
      "eso prefiero que te lo responda el equipo, se lo paso y alguien te responde aquí",
    handoffAgain: "el equipo ya tiene tu mensaje, alguien te responde aquí",
    vipPending: "todo bien por mi parte, el equipo te envía tu acceso al VIP aquí",
    minorStop:
      "el VIP es solo para mayores de edad (18 años o más), así que no puedo seguir contigo. cuídate",
  },
  pt: {
    isAssistant:
      "pra ser sincero contigo, eu sou uma IA, {role} do canal. me diz o que você quer saber do VIP",
    handoff:
      "isso eu prefiro que a equipe te responda, vou passar pra eles e alguém te responde aqui",
    handoffAgain: "a equipe já tem a sua mensagem, alguém te responde aqui",
    vipPending: "tudo certo da minha parte, a equipe te manda o acesso ao VIP aqui",
    minorStop:
      "o VIP é só para maiores de idade (18 anos ou mais), então não posso continuar contigo. se cuida",
  },
  de: {
    isAssistant:
      "ich bin ehrlich zu dir: ich bin eine KI, {role} des Kanals. sag mir, was du über den VIP wissen willst",
    handoff:
      "das soll dir lieber das Team beantworten, ich gebe es weiter und jemand antwortet dir hier",
    handoffAgain: "das Team hat deine Nachricht, jemand antwortet dir hier",
    vipPending: "von meiner Seite passt alles, das Team schickt dir deinen VIP-Zugang hier",
    minorStop:
      "der VIP ist nur für Erwachsene (ab 18), deshalb kann ich hier nicht weitermachen. pass auf dich auf",
  },
  it: {
    isAssistant:
      "per essere sincero con te, sono un'IA, {role} del canale. dimmi cosa vuoi sapere del VIP",
    handoff:
      "su questo preferisco che ti risponda il team, lo passo a loro e qualcuno ti risponde qui",
    handoffAgain: "il team ha il tuo messaggio, qualcuno ti risponde qui",
    vipPending: "tutto ok da parte mia, il team ti manda l'accesso al VIP qui",
    minorStop:
      "il VIP è solo per maggiorenni (18 anni o più), quindi non posso andare avanti con te. abbi cura di te",
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

const VIP_ROLES: Record<ChatLang, { F: string; M: string }> = {
  fr: { F: "la gérante du VIP", M: "le gérant du VIP" },
  en: { F: "the VIP manager", M: "the VIP manager" },
  es: { F: "la gestora del VIP", M: "el gestor del VIP" },
  pt: { F: "a gerente do VIP", M: "o gerente do VIP" },
  de: { F: "die VIP-Managerin", M: "der VIP-Manager" },
  it: { F: "la gestrice del VIP", M: "il gestore del VIP" },
};

/** « le gérant du VIP » / « la gérante du VIP » dans la langue voulue (« F » par défaut). */
export function vipManagerRole(lang: ChatLang, gender: string | null | undefined): string {
  const roles = VIP_ROLES[lang] ?? VIP_ROLES.fr;
  return gender === "M" ? roles.M : roles.F;
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
  const vip: Partial<Record<FixedTextKey, string>> = vars.vipManager ? VIP_FIXED_TEXTS[l] : {};
  const template =
    girl && vars.illusion === true && key === "isAssistant"
      ? ILLUSION_IS_ASSISTANT[l]
      : girl && (key === "intro" || key === "isAssistant")
        ? GIRL_FIXED_TEXTS[l][key]
        : (vip[key] ?? FIXED_TEXTS[l][key]);
  const values: Record<string, string> = {
    name: vars.name ?? "",
    role: vars.vipManager ? vipManagerRole(l, vars.gender) : assistantRole(l, vars.gender),
  };
  return template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? "").trim();
}

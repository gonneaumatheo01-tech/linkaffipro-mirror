// Contrôles faits par le code après chaque réponse du modèle (contrat §3.3, règles 2 à 4 du client). Une réponse non
// conforme est rejetée avec des codes stables ; le moteur la refait une fois avec une consigne de correction.
import type { TurnOutput } from "./schema";
import type { PersonaIdentity } from "./turn-types";
import { MAX_TURN_MESSAGES, MIN_TURN_MESSAGES } from "./schema";
import { escapeRegExp, foldText, matchesAny, visibleLength, wordsForm } from "./text-utils";

export const MAX_MESSAGE_CHARS = 300;
export const MAX_TURN_CHARS = 700;

/** Codes de rejet stables (journal `rejected`, consignes de correction, statistiques). */
export const REJECT_CODES = [
  "invalid_output",
  "truncated",
  "empty",
  "too_many_messages",
  "too_long",
  "markdown",
  "link",
  "explicit",
  "denies_assistant",
  "missing_assistant_admission",
  "intro_missing",
  "invented_number",
  "leak",
] as const;
export type RejectCode = (typeof REJECT_CODES)[number];

export type ValidationContext = {
  /** Prénom de la persona (exigé dans le premier message). */
  personaName: string;
  /** Fiche de l'offre : seuls chiffres permis, avec ceux écrits par la personne. */
  offerPitch: string;
  /** Tout ce que la personne a écrit (historique et tour) : ses chiffres peuvent être repris. */
  memberTexts: readonly string[];
  /** Messages de la personne de ce tour : la question « bot / IA / vraie personne ? » y est cherchée. */
  turnInboundTexts: readonly string[];
  /** Faits retenus (dits par la personne elle-même). */
  facts?: readonly string[];
  /** Premier message de l'assistant dans cette conversation : prénom + « assistant(e) » exigés. */
  isFirstAssistantMessage: boolean;
  /**
   * Textes internes de la persona que la personne ne doit jamais lire (consignes complémentaires de l'équipe,
   * personnalité et ton écrits) : une reprise de 8 mots d'affilée est refusée (`leak`). La fiche de l'offre n'en fait
   * pas partie (elle peut être dite).
   */
  privateTexts?: readonly (string | null | undefined)[];
  /**
   * « GIRL » : la persona est une fille ; à la première question « t'es un bot ? » elle peut répondre que non, mais
   * quand la personne insiste (`botInsists`) l'aveu d'être une IA est exigé. Absent = ASSISTANT (phase 17).
   */
  identity?: PersonaIdentity;
  /** Mode illusion (avec GIRL) : la fille se dit vraie ; ni déni refusé ni aveu exigé, même si la personne insiste. */
  illusion?: boolean;
  /** La personne redemande si c'est un bot (voir `botQuestionInsists`) ; utile seulement en GIRL. */
  botInsists?: boolean;
};

export type ValidationResult =
  | { ok: true; messages: string[] }
  | { ok: false; codes: RejectCode[]; details: string[]; messages: string[] };

// ------------------------------------------------------------------
// Mise en forme (markdown, balises)
// ------------------------------------------------------------------

const MARKDOWN_PATTERNS: readonly RegExp[] = [
  /\*\*/, // gras
  /__/, // gras
  /`/, // code
  /^\s*#/m, // titre
  /\[[^\]\n]*\]\([^)\n]*\)/, // lien [x](y)
  /^\s*[-*•+]\s+\S/m, // liste à puces
  /^\s*\d{1,2}[.)]\s+\S/m, // liste numérotée
  /(^|[\s(])\*[^*\s][^*\n]*\*(?=$|[\s).,!?:;])/m, // *italique* ou *action*
  /(^|\s)_[^_\s][^_\n]*_(?=$|[\s.,!?:;])/m, // _italique_
  /<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?>/i, // balise HTML
];

/** Vrai si le texte contient de la mise en forme (markdown ou balise) : le message doit être en texte brut. */
export function hasMarkdown(text: string): boolean {
  return matchesAny(text, MARKDOWN_PATTERNS);
}

// ------------------------------------------------------------------
// Liens, domaines, @pseudos
// ------------------------------------------------------------------

/**
 * Extensions de domaine reconnues : TOUS les domaines de pays (2 lettres, liste IANA : « rencontres.ca », « goo.gl »,
 * « is.gd », « rb.gy », « shorturl.at », « site.to »…) et les extensions génériques courantes. Telegram rend cliquable
 * toute adresse dont l'extension existe, même dans un texte brut.
 */
const CC_TLDS =
  "ac ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bm bn bo bq br bs bt bv bw by bz " +
  "ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg eh er es et eu fi fj fk fm fo " +
  "fr ga gb gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it je jm " +
  "jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mg mh mk ml mm mn mo mp mq mr " +
  "ms mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro " +
  "rs ru rw sa sb sc sd se sg sh si sj sk sl sm sn so sr ss st su sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt " +
  "tv tw tz ua ug uk us uy uz va vc ve vg vi vn vu wf ws ye yt za zm zw";
const GENERIC_TLDS =
  "com net org info biz name pro mobi tel travel jobs asia cat coop aero museum xxx post int edu gov mil " +
  "app dev page site online website web store shop shopping club live love life world today tech technology space " +
  "fun xyz top vip bet casino poker games game win bingo lotto dating date singles sexy sex porn adult cam chat " +
  "social network media news blog wiki link click download stream video icu cyou buzz ooo one plus email mail " +
  "cloud host hosting digital agency company business ltd inc llc group team work works zone center city town guru " +
  "expert solutions services support help care health fit fitness beauty hair fashion style clothing shoes jewelry " +
  "watch tube movie film music band rocks lol wtf fail fyi ninja cool cash money bank finance loan credit insurance " +
  "tax trade market markets exchange deals sale discount coupons gift gifts red blue pink black gold art design " +
  "photo photos pics pictures gallery studio events party wedding family kids baby pet pets house home homes realty " +
  "estate rent property farm garden earth eco bio global international systems software tools codes academy school " +
  "college university education courses training institute boutique bar pub cafe restaurant pizza beer wine vin " +
  "paris berlin london nyc tokyo moscow madrid barcelona amsterdam brussels wien swiss quebec bzh alsace corsica eus " +
  "gal scot wales africa men gay lgbt girl girls boy boys meet friends fan fans best review reviews press report " +
  "now new free promo bio ink lat kim moe onl rip run vote vin wang xin";
const TLDS = [...new Set(`${CC_TLDS} ${GENERIC_TLDS}`.split(/\s+/).filter(Boolean))].join("|");
const LINK_PATTERNS: readonly RegExp[] = [
  /https?:\/\//i,
  /\bwww\./i,
  /\bt\.me\b/i,
  /\btelegram\.(?:me|dog)\b/i,
  /\btg:\/\//i,
  new RegExp(`\\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.(?:${TLDS})\\b`, "i"),
  // « mot.mot/quelque chose » : une adresse avec un chemin, quelle que soit son extension (pas « 9.5/10 »)
  /(?:^|[^\p{L}\p{N}_@.])[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]*\p{L}[\p{L}\p{N}-]*)+\/[^\s/]/iu,
  // adresse e-mail
  /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/iu,
  /(^|[^\p{L}\p{N}_])@[a-z0-9_]{3,}/iu,
];

/** Vrai si le texte contient un lien, un nom de domaine ou un @pseudo (le seul lien permis est le bouton). */
export function hasLink(text: string): boolean {
  return matchesAny(text, LINK_PATTERNS);
}

// ------------------------------------------------------------------
// « Es-tu un bot / une IA / une vraie personne ? » (6 langues)
// ------------------------------------------------------------------

const BOT_WORDS = "bot|bots|robot|robo|roboter|chatbot|chatgpt|gpt";
const AI_FULL =
  "intelligence artificielle|artificial intelligence|inteligencia artificial|kunstliche intelligenz|intelligenza artificiale";
// « l'IA » mais jamais « je l'ai » : l'article élidé ne vaut que pour « ia ».
const AI_WITH_ARTICLE =
  "(?:une|un|an|una|uma|um|eine|ein|einer|la|el|the) (?:ia|ai|ki|i a|a i)|(?:l|a) ia";
const MACHINE_WORDS =
  "machine|maquina|maschine|macchina|programme|program|programa|programm|programma|automatique|automated|automatic|automatico|automatica|automatisch|automatizzato|virtuel|virtuelle|virtual|virtuell|virtuale";
const PERSON_WORDS =
  "personne|person|persona|pessoa|mensch|humain|humaine|human|humano|humana|umano|umana";

/**
 * Forme « propositions » : minuscules sans accents, « ? » et « : » gardés comme mots, toute autre ponctuation (emoji,
 * retour à la ligne compris) remplacée par « | » (frontière de proposition). « Non, une IA » → « non | une ia » ; « Bot? Never! »
 * → « bot ? never | ». Sert au déni et à l'aveu, où la ponctuation change le sens (« non un'IA » ≠ « Non, une IA »).
 */
function clauseForm(text: string): string {
  return foldText(text)
    .replace(/['’‘`´-]/g, " ")
    .replace(/\?+/g, " ? ")
    .replace(/:+/g, " : ")
    .replace(/[^a-z0-9?:\s]+|\n+/g, " | ")
    .replace(/\s+/g, " ")
    .trim();
}

const ASKS_PATTERNS: readonly RegExp[] = [
  new RegExp(`\\b(?:${BOT_WORDS})\\b`),
  new RegExp(`\\b(?:${AI_FULL})\\b`),
  new RegExp(`\\b(?:${AI_WITH_ARTICLE})\\b`),
  /\b(?:vraie?|reelle?) (?:personne|fille|femme|meuf|nana|humaine?|mec|gars|homme)\b/,
  /\bpersonne (?:reelle|vraie)\b/,
  /\b(?:real|actual) (?:person|human|girl|woman|guy|man|people)\b/,
  /\bhuman being\b/,
  /\b(?:persona|chica|mujer|chico) (?:real|de verdad)\b/,
  /\b(?:pessoa|mulher|menina|garota) (?:real|de verdade)\b/,
  /\b(?:echte|echter|echtes|reale|realer) (?:person|mensch|frau|madchen|mann)\b/,
  /\b(?:persona|ragazza|donna) (?:vera|reale)\b/,
  /\b(?:une|un|a|an|una|uma|um|eine|ein|ser) (?:humain|humaine|human|humano|humana|mensch|umano|umana)\b/,
  /\b(?:chair et en os|flesh and blood|carne y hueso|carne e osso|fleisch und blut|carne e ossa)\b/,
  /\b(?:tu es|t es|es tu|tes|vous etes|etes vous) (?:bien |vraiment |une |un )?(?:vraie?|reelle?|humaine?)\b/,
  /\b(?:are you|r u|are u|you re|youre|u re|ur) (?:a |an )?(?:real|human|for real)\b/,
  /\b(?:eres|sos) (?:real|humana|humano|de verdad)\b/,
  /\b(?:voce e|vc e|tu e|tu es) (?:real|humana|humano|de verdade)\b/,
  /\b(?:bist du|sind sie) (?:echt|real|ein mensch|eine echte|ein echter)\b/,
  /\bsei (?:vera|vero|reale|umana|umano)\b/,
  new RegExp(
    `\\b(?:tu es|t es|es tu|c est|ce sont|are you|you re|is this|is it|this is|eres|es|voce e|vc e|bist du|ist das|sei|sono) (?:un |une |a |an |una |um |uma |ein |eine )?(?:${MACHINE_WORDS})\\b`,
  ),
  /\b(?:message automatique|messages automatiques|automated message|auto reply|reponse automatique|respuesta automatica|resposta automatica|automatische antwort|risposta automatica)\b/,
  // « quelqu'un de vrai ? », « someone real », « y a quelqu'un derrière ? »
  /\b(?:someone real|somebody real|a real one|quelqu un de (?:vrai|reel)|quelqu un derriere|une personne derriere|un humain derriere|someone behind|a human behind|alguien real|alguien detras|alguem real|alguem por tras|alguem de verdade|jemand echtes|ein mensch dahinter|qualcuno di vero|qualcuno dietro)\b/,
  // « tu existes ? », « do you exist? », « ¿existes? », « você existe? », « existierst du? », « esisti? »
  /\b(?:tu existes|t existes|vous existez|do you exist|you exist|existes|tu existe|voce existe|vc existe|existierst du|gibt es dich|esisti)\b/,
  // « c'est une vraie personne qui répond ? », « is it a person who answers? »
  /\b(?:une|un|a|una|uma|eine|ein) (?:vraie |real |echte )?(?:personne|person|persona|pessoa|mensch|humain|human) (?:qui|who|que|die|der|che) (?:me |m )?(?:repond|ecrit|answers|replies|writes|is writing|is answering|is replying|responde|escribe|escreve|antwortet|schreibt|risponde|scrive)\b/,
  // « c'est un vrai compte ? », « is this a real account? »
  /\b(?:(?:real|fake|vrai|faux|reel|echtes|falsches|vero|falso) (?:account|compte|profil|profile|perfil|konto|profilo)|(?:compte|perfil|profilo|konto) (?:reel|vrai|fake|real|falso|vero|echt))\b/,
];

// Sur la forme « propositions » : « t'es une personne ? », « are you a person? », « bist du eine Person? », « eres una
// persona? » ; seulement en question (« tu es une personne formidable » n'en est pas une).
const ASKS_CLAUSE_PATTERNS: readonly RegExp[] = [
  new RegExp(
    `\\b(?:tu es|t es|es tu|tes|vous etes|etes vous|est ce que tu es|are you|r u|are u|eres|sos|sei|voce e|vc e|tu e|bist du|sind sie|is this|is it|c est) (?:bien |vraiment |really |actually |realmente |de verdad |wirklich |davvero |echt |even )?(?:une |un |a |an |una |uma |um |eine |ein )?(?:vraie |real |echte |vera |reale )?(?:${PERSON_WORDS})(?: (?:reelle|vraie|real|reale|vera|de verdad|de verdade|echt))?(?:(?: [|:])* \\?| (?:ou|or|o|oder|oppure)\\b|$)`,
  ),
];

// Questions sans mot « bot » ni « personne » : « c'est (bien) toi en vrai ? », « y a quelqu'un ? », « is anyone there? »
// (forme « propositions », « ? » exigé).
const ASKS_REAL_PATTERNS: readonly RegExp[] = [
  /\bc est (?:bien |vraiment |really )?toi (?:en vrai|pour de vrai)(?: [|:])* \?/,
  /\b(?:y a|il y a|ya|y aurait|il y aurait) (?:t il )?(?:quelqu un|qqn|qn)(?: de vivant| de vrai)?(?: (?:la|ici|derriere))?(?: [|:])* \?/,
  /\b(?:anyone|anybody|someone|somebody) (?:there|here|home|real)(?: [|:])* \?/,
  /\b(?:hay alguien|tem alguem|ist da jemand|c e qualcuno)(?: (?:ahi|ai|ali|da|li))?(?: [|:])* \?/,
];

/** Vrai si la personne demande (ou se demande) si elle parle à un bot, une IA ou une vraie personne. */
export function asksIfBot(text: string): boolean {
  const clauses = clauseForm(text);
  return (
    matchesAny(wordsForm(text), ASKS_PATTERNS) ||
    matchesAny(clauses, ASKS_CLAUSE_PATTERNS) ||
    matchesAny(clauses, ASKS_REAL_PATTERNS)
  );
}

// ------------------------------------------------------------------
// Aveu et déni d'être un assistant
// ------------------------------------------------------------------

const ASSISTANT_WORD = /\b(?:assistante?|assistants|asistente|assistente|assistentin|assistent)\b/;
const ASSIST_TARGET = "assistante?|asistente|assistente|assistentin|assistent";
const VIRTUAL_WORDS = "virtuel|virtuelle|virtual|virtuell|virtueller|virtuale";

/** Négations (forme « mots ») : bloquent un aveu et forment un déni (« pas une IA », « not a bot », « keine KI »). */
const NEG_WORDS =
  "pas|not|no|nao|non|kein|keine|keinen|keiner|nicht|ni|jamais|never|nunca|ne|n|isn|aren|ain|wasn";
const NEG_BLOCK = `(?!(?:${NEG_WORDS})\\b)`;
/** Un mot (sauf une négation) ou une frontière de proposition (« | », « : »). */
const WIN_TOKEN = `${NEG_BLOCK}(?:[a-z0-9]+|[|:])`;
/** IA, bot, robot, virtuel(le) : l'aveu franc attendu quand la personne demande. « ai » seulement avec un article
 * (l'italien « sono ai giardini » n'est pas un aveu). */
const AI_TARGET = `(?:${AI_FULL}|ia|ki|(?:an|a|un|une|una|uma|um) ai|bot|chatbot|robot|robo|roboter|${VIRTUAL_WORDS})`;
/** Première personne : « je suis », « I'm », « soy », « sou », « ich bin », « sono »… */
const SELF_ADMIT =
  "je suis|j suis|jsuis|chui|moi c est|i m|im|i am|soy|yo soy|sou|eu sou|ich bin|sono|io sono";
/** Tournures impersonnelles, avec une fenêtre plus courte : « c'est une IA », « it's an AI », « this is a bot ». */
const IT_ADMIT = "c est|ici c est|it s|it is|this is|aqui e|qui e|hier ist|hier spricht";
/** Ce qui précède une première personne qui n'avoue rien : « tu crois que je suis un bot ? ». */
const NOT_ASSERTED_BEFORE =
  "(?<!\\b(?:que|qu|that|if|whether|ob|dass|se|si|como|comme|like|wie|crois|penses|think)\\s)";
/** La cible n'est pas suivie d'un « ? » (« je suis un bot ? » est une question, pas un aveu). */
const NOT_QUESTIONED = "(?! \\?)";
const YES_WORDS =
  "oui|ouais|yes|yep|yeah|yup|si|sim|ja|jep|bien sur|of course|claro|certo|genau|exactement|exactly|exacto|exatamente|esatto|en effet|indeed|effectivement|tout a fait|bien vu|gagne|bingo|absolument|absolutely|totally";
const ART = "(?:une|un|an|a|una|uma|um|eine|ein)";

/** Aveux d'être une IA (forme « propositions »). */
const ADMIT_AI_PATTERNS: readonly RegExp[] = [
  // « je suis une IA », « I'm an AI », « sono un'IA », « ich bin eine KI », « je suis l'assistante virtuelle »
  new RegExp(
    `${NOT_ASSERTED_BEFORE}\\b(?:${SELF_ADMIT}) (?:${WIN_TOKEN} ){0,5}${AI_TARGET}\\b${NOT_QUESTIONED}`,
  ),
  // « c'est une IA qui te répond », « it's an AI », « this is a bot »
  new RegExp(`\\b(?:${IT_ADMIT}) (?:${WIN_TOKEN} ){0,2}${AI_TARGET}\\b${NOT_QUESTIONED}`),
  // « assistante virtuelle », « virtual assistant », « IA du canal »
  new RegExp(
    `(?<!\\b(?:${NEG_WORDS}) (?:[a-z0-9]+ )?)\\b(?:assistante? virtuel(?:le)?|virtual assistant|ai assistant|asistente virtual|assistente virtual|virtuelle assistentin|virtueller assistent|ki assistentin|ki assistent|assistente virtuale|(?:ia|ai|ki) (?:du|of the|del|do|des|della|dello) (?:canal|channel|kanals|canale)|channel s ai)\\b${NOT_QUESTIONED}`,
  ),
  // « tu parles à une IA », « you're talking to an AI », « stai parlando con un'IA »
  new RegExp(
    `\\b(?:tu parles|tu discutes|tu ecris|tu chattes|you re talking|you are talking|you re chatting|you are chatting|you re texting|you are texting|estas hablando|hablas|estas chateando|voce esta falando|vc ta falando|tu estas a falar|falas|du sprichst|du schreibst|du chattest|stai parlando|parli|stai chattando|stai scrivendo) (?:${WIN_TOKEN} ){0,3}${AI_TARGET}\\b${NOT_QUESTIONED}`,
  ),
  // « Oui, une IA 😊 », « Yes, an AI », « Sì, un'IA » (ponctuation exigée après « oui » : « si fuera un bot » = « si »
  // conditionnel, pas un aveu)
  new RegExp(`\\b(?:${YES_WORDS}) [|:] (?:${WIN_TOKEN} ){0,2}${AI_TARGET}\\b${NOT_QUESTIONED}`),
  // « Une IA, oui 😊 »
  new RegExp(
    `(?:^|[|:] )${ART} (?:ia|ki|ai|${AI_FULL}|bot|chatbot|robot)(?: [|:])? (?:${YES_WORDS})\\b`,
  ),
  // Apposition après « : » ou « non, » : « …du canal : une IA, pas une vraie personne », « Un bot ? Non, une IA »
  // (« Ah, une IA ! Tu regardes trop de films » n'est pas un aveu)
  new RegExp(
    `(?:: |\\b(?:non|no|nein|nao|plutot|rather|eher|piuttosto) [|:] )${ART} (?:ia|ki|ai|${AI_FULL}|bot|chatbot|robot)(?= [|:]|$)`,
  ),
];

/** Aveux d'être l'assistant(e) (sans forcément dire « IA ») : « je suis Léa, l'assistante du canal ». */
const ADMIT_ASSISTANT_PATTERNS: readonly RegExp[] = [
  new RegExp(
    `${NOT_ASSERTED_BEFORE}\\b(?:${SELF_ADMIT}|${IT_ADMIT}) (?:${WIN_TOKEN} ){0,5}(?:${ASSIST_TARGET})\\b${NOT_QUESTIONED}`,
  ),
  new RegExp(
    `(?<!\\b(?:${NEG_WORDS}) (?:[a-z0-9]+ )?)\\b(?:l|the|la|el|a|o|die|der|your|ton|ta|tua|tu|sua) (?:${ASSIST_TARGET}) (?:du|of the|del|do|des|della|dello) (?:canal|channel|kanals|canale)\\b`,
  ),
  /\bchannel s assistant\b/,
];

/**
 * Vrai si le texte affirme franchement être une IA, un bot ou un personnage virtuel (6 langues) : première personne
 * (« je suis une IA », « I'm an AI »), « assistante virtuelle », « tu parles à une IA », « Oui, une IA ». Un simple
 * écho du mot (« un bot ? », « pas une IA », « ton programme ce soir ») n'en est pas un.
 */
export function admitsBeingAi(text: string): boolean {
  return matchesAny(clauseForm(text), ADMIT_AI_PATTERNS);
}

/** Vrai si le texte dit être une IA (voir `admitsBeingAi`) ou l'assistant(e) du canal (6 langues). */
export function admitsBeingAssistant(text: string): boolean {
  const c = clauseForm(text);
  return matchesAny(c, ADMIT_AI_PATTERNS) || matchesAny(c, ADMIT_ASSISTANT_PATTERNS);
}

const SELF_NEG =
  "je ne suis pas|je suis pas|j suis pas|jsuis pas|chui pas|suis pas|i m not|im not|i am not|i m no|i am no|no soy|yo no soy|nao sou|eu nao sou|ich bin kein|ich bin keine|ich bin nicht|non sono|io non sono";
/** Programmé(e), scripté(e), automatisé(e) : toutes les formes (« je suis pas programmée »). */
const PROGRAMMED_WORDS =
  "programmee?s?|programmes|programado|programada|programmato|programmata|programmiert|programmed|scriptee?s?|scripted|automatisee?s?|automated|automatico|automatica|automatisiert|automatizzat[oa]";
const DENIED_WHAT = `${BOT_WORDS}|ia|ai|ki|i a|a i|${AI_FULL}|machine|maschine|macchina|maquina|program|programa|programm|programma|${PROGRAMMED_WORDS}|assistante?|asistente|assistente|assistentin|assistent|${VIRTUAL_WORDS}`;
const SELF = "je suis|chui|jsuis|j suis|i m|im|i am|soy|yo soy|sou|eu sou|ich bin|sono|io sono";
const ADV_WORDS =
  "bien|vraiment|totalement|tout a fait|really|totally|definitely|absolutely|realmente|totalmente|de verdad|de verdade|wirklich|ganz|davvero|proprio|100";
const ADV = `(?:(?:${ADV_WORDS}) )*`;
const SELF_ART = "(?:(?:une|un|a|an|una|uma|um|ein|eine|einen) )?";
const CLEAR_HUMAN = "reelle|reel|humaine|humain|human|humana|humano|umana|umano|reale|mensch";
const AMBIG_HUMAN = "vraie|vrai|real|echt|echte|vera|vero";
const PERSON_NOUN =
  "personne|fille|femme|meuf|nana|mec|gars|homme|person|girl|woman|guy|man|lady|persona|chica|mujer|chico|hombre|pessoa|mulher|menina|garota|homem|frau|madchen|mann|ragazza|donna|ragazzo|uomo|humaine|humain|human|humana|humano|mensch";
const AI_AFTER =
  "assistante?|asistente|assistente|assistentin|assistent|assistant|ia|ai|ki|bot|robot|virtuelle?|virtual|virtuell|virtuale|intelligence|intelligenza|inteligencia|programme|program";
const HUMAN_PHRASES =
  "vraie personne|vrai personne|personne reelle|real person|real human|actual person|persona real|persona de verdad|pessoa real|pessoa de verdade|echte person|echter mensch|persona vera|persona reale|en chair et en os|flesh and blood|carne y hueso|carne e osso|fleisch und blut|carne e ossa";

// Déni dans la forme « mots » (sans ponctuation).
const DENY_WORD_PATTERNS: readonly RegExp[] = [
  // « je ne suis pas un bot », « I'm not an AI », « no soy una IA », « ich bin keine KI »…
  new RegExp(
    `\\b(?:${SELF_NEG}) (?:vraiment |really |realmente |wirklich |davvero |du tout |at all )?(?:un |une |a |an |una |um |uma |ein |eine )?(?:${DENIED_WHAT})\\b`,
  ),
  // « je suis une vraie fille », « I'm a real person », « ich bin eine echte Frau »
  new RegExp(
    `\\b(?:${SELF}) ${ADV}${SELF_ART}(?:${AMBIG_HUMAN}|${CLEAR_HUMAN}) (?:${PERSON_NOUN})\\b`,
  ),
  // « soy una chica real », « sono una ragazza vera », « je suis une personne réelle »
  new RegExp(
    `\\b(?:${SELF}) ${ADV}${SELF_ART}(?:${PERSON_NOUN}) (?:real|reale|vera|vero|de verdad|de verdade|reelle|vraie)\\b`,
  ),
  // « je suis humaine », « I'm human », « sono umana », « ich bin ein Mensch » (sauf « … assistante », « … IA »)
  new RegExp(`\\b(?:${SELF}) ${ADV}${SELF_ART}(?:${CLEAR_HUMAN})\\b(?! (?:${AI_AFTER})\\b)`),
  // « 100 % humaine », « 100% human »
  /\b100 (?:pour cent |percent |por ciento |por cento |prozent |per cento )?(?:humaine?|human|humana|humano|umana|umano|mensch)\b/,
  // « je suis bien vivante », « I'm alive »
  new RegExp(`\\b(?:${SELF}) ${ADV}(?:vivante?|alive|viva|vivo|lebendig)\\b`),
  // « c'est moi en vrai qui t'écris », « c'est bien moi pour de vrai », « it's me for real »
  /\b(?:c est moi|it s me|its me|soy yo|sou eu|sono io|ich bin es) (?:bien |vraiment |really )?(?:en vrai|pour de vrai|for real|de verdad|de verdade|davvero|wirklich)\b/,
  // « je suis là pour de vrai », « I'm here for real », « je suis vraie en vrai de vrai »
  new RegExp(
    `\\b(?:${SELF}) (?:(?:la|ici|here|bien|vraiment|really|aqui|aca|qui|hier|vraie?|real|echt|vera|vero) )*(?:pour de vrai|en vrai de vrai|for real|de verdad|de verdade|per davvero)\\b`,
  ),
];

/** Négation directement suivie d'un mot d'IA (sans ponctuation entre les deux : « Non, une IA » n'est pas un déni). */
const NEG_DENY =
  "pas|not|no|nao|non|kein|keine|keinen|keiner|nicht|ni|jamais|never|nunca|isn t|aren t|ain t|wasn t";
const NEG_ADV =
  "(?:(?:du tout|at all|vraiment|really|realmente|wirklich|davvero|even|meme|simplement|einfach|nem|nemmeno) )?";
const NEG_ART =
  "(?:(?:une|un|a|an|una|uma|um|eine|ein|einer|einen|de|d|el|la|le|l|the|o|die|der) )?";
const DENY_TARGET = `${BOT_WORDS}|ia|ki|${AI_FULL}|machine|maschine|macchina|maquina|${ASSIST_TARGET}|${VIRTUAL_WORDS}`;

// Déni dans la forme « propositions ».
const DENY_CLAUSE_PATTERNS: readonly RegExp[] = [
  // « Je suis Léa, pas une IA », « not an AI », « no una IA », « non un'IA », « não uma IA », « keine KI », « pas un bot »
  new RegExp(`\\b(?:${NEG_DENY}) ${NEG_ADV}${NEG_ART}(?:${DENY_TARGET})\\b`),
  new RegExp(`\\b(?:${NEG_DENY}) ${NEG_ADV}(?:an|a|un|une|una|uma|um) ai\\b`),
  /\b(?:not|no) ai\b/,
];

/** « aucun robot ici », « aucune IA », « zéro bot », « ningún bot » : déni, sauf si le texte avoue être une IA (« Je suis
 * une IA : aucune IA ne remplace une vraie rencontre »). */
const DENY_NONE = new RegExp(
  `\\b(?:aucun|aucune|zero|nul|nulle|ningun|ninguna|ninguno|nenhum|nenhuma|nessun|nessuna|nessuno|keinerlei|no hay|nao ha|nao tem) ${NEG_ADV}(?:${DENY_TARGET}|ai)\\b`,
);

/** « Moi un bot ? Pas du tout », « Bot? Never! », « Eine KI? Quatsch » : déni sauf si le texte avoue être une IA. */
const LAUGH = "(?:ha|ah|he|hi|ja|je|k){2,}h?|mdr|lol|ptdr|xd|lmao";
const Q_FILLER = `moi|me|io|yo|eu|ich|ah|oh|euh|bah|ben|well|um|uh|pf+|${LAUGH}`;
const Q_INTERJ =
  "non|nan|nope|no|nao|nein|pas du tout|absolument pas|certainement pas|surement pas|jamais|never|no way|not at all|of course not|hell no|para nada|claro que no|claro que nao|de jeito nenhum|nada disso|nunca|niemals|quatsch|auf keinen fall|keineswegs|figurati|macche|ma no|assolutamente no|per niente|n importe quoi|tu rigoles|you wish";
const DENY_QUESTION = new RegExp(
  `\\b(?:${DENY_TARGET}|ai) \\?(?: (?:[|:?]|${Q_FILLER}))* (?:${Q_INTERJ})\\b`,
);

// « je suis vraie. », « I'm real! », « sono vera 😊 » : mot ambigu en fin de phrase seulement (« ich bin echt müde » n'est pas un déni).
const DENY_SENTENCE_PATTERN = new RegExp(
  `\\b(?:${SELF})\\s+(?:(?:${ADV_WORDS})\\s+)*(?:${AMBIG_HUMAN})(?=\\s*(?:$|[^a-z0-9\\s])|\\s(?:et|and|y|e|und|ed|ma|mais|but|pero|mas|aber|haha|lol|mdr|promis|promise)\\b)`,
);

const NEGATION_BEFORE =
  /\b(?:pas|not|no|nao|kein|keine|keinen|nicht|non|ni|jamais|never|nunca|nie|mai|n)\b/;

/**
 * « une vraie fille », « une vraie meuf », « a real girl », « una chica de verdad », « eine echte Frau »… : prétendre
 * qu'une vraie personne écrit, même sans « je suis » devant (« derrière l'écran il y a une vraie fille »).
 */
const REAL_ADJ = "vraie|vrai|reelle|reel|real|actual|echte|echter|echtes|vera|vero";
const GIRL_NOUN =
  "fille|femme|meuf|nana|mec|gars|homme|girl|woman|guy|man|lady|chica|mujer|chico|hombre|menina|mulher|garota|homem|frau|madchen|mann|ragazza|donna|ragazzo|uomo";
const REAL_PERSON_PHRASES = `(?:${REAL_ADJ}) (?:${GIRL_NOUN})|(?:fille|femme|meuf|chica|mujer|menina|mulher|garota|ragazza|donna|girl|woman) (?:reelle|real|reale|vera|de verdad|de verdade)|vivante en vrai|en vrai de vrai`;
/** Compliment adressé à la personne (« t'es une vraie fille de la nuit ») : ce n'est pas l'assistante qui parle d'elle. */
const SECOND_PERSON_BEFORE =
  /\b(?:tu es|t es|tes|es tu|tu as l air|t as l air|tu sembles|you re|you are|ur|u r|you look like|you seem like|eres|sos|pareces|voce e|vc e|sei|sembri|bist du|du bist)\b/;

/** Vrai si le texte prétend être une vraie personne ou nie être un assistant / une IA / un bot (6 langues). */
export function deniesBeingAssistant(text: string): boolean {
  const words = wordsForm(text);
  if (matchesAny(words, DENY_WORD_PATTERNS)) return true;
  const clauses = clauseForm(text);
  if (matchesAny(clauses, DENY_CLAUSE_PATTERNS)) return true;
  const light = foldText(text)
    .replace(/['’‘`´-]/g, " ")
    .replace(/[ \t]+/g, " ");
  if (DENY_SENTENCE_PATTERN.test(light)) return true;
  if ((DENY_QUESTION.test(clauses) || DENY_NONE.test(clauses)) && !admitsBeingAi(text)) return true;
  // « vraie personne », « real person », « une vraie fille »… sans négation juste avant, dans un texte qui ne dit pas
  // être un assistant.
  if (admitsBeingAssistant(text)) return false;
  for (const m of words.matchAll(new RegExp(`\\b(?:${HUMAN_PHRASES})\\b`, "g"))) {
    const before = words.slice(Math.max(0, (m.index ?? 0) - 25), m.index ?? 0);
    if (!NEGATION_BEFORE.test(before)) return true;
  }
  for (const m of words.matchAll(new RegExp(`\\b(?:${REAL_PERSON_PHRASES})\\b`, "g"))) {
    const before = words.slice(Math.max(0, (m.index ?? 0) - 25), m.index ?? 0);
    if (!NEGATION_BEFORE.test(before) && !SECOND_PERSON_BEFORE.test(before)) return true;
  }
  return false;
}

/** Vrai si le texte contient le prénom de la persona (présentation d'une fille : ni « assistante » ni « canal »). */
export function hasNameIntro(text: string, personaName: string): boolean {
  const name = wordsForm(personaName);
  if (!name)
    return Boolean(personaName.trim()) && foldText(text).includes(foldText(personaName.trim()));
  return new RegExp(` ${escapeRegExp(name)} `).test(` ${wordsForm(text)} `);
}

/** Vrai si le texte contient le prénom de la persona et un mot « assistant(e) » (6 langues). */
export function hasIntro(text: string, personaName: string): boolean {
  const words = ` ${wordsForm(text)} `;
  if (!ASSISTANT_WORD.test(words)) return false;
  const name = wordsForm(personaName);
  // Prénom sans lettre latine (ex. alphabet cyrillique) : simple présence, sans tenir compte de la casse.
  if (!name)
    return Boolean(personaName.trim()) && foldText(text).includes(foldText(personaName.trim()));
  return new RegExp(` ${escapeRegExp(name)} `).test(words);
}

// ------------------------------------------------------------------
// Contenu explicite (flirt léger permis : « sexy », « bisou », « un baiser », « coquine » ne sont pas refusés)
// ------------------------------------------------------------------

const EXPLICIT_WORDS = [
  // plusieurs langues
  "porn",
  "porno",
  "pornographie",
  "pornografia",
  "xxx",
  "nsfw",
  "nude",
  "nudes",
  "sexting",
  "sextape",
  "sex tape",
  "masturb\\w*",
  "orgasm\\w*",
  "ejacul\\w*",
  "eyacul\\w*",
  "eiakul\\w*",
  "sodom\\w*",
  "fellation",
  "blowjob\\w*",
  "handjob\\w*",
  "cunnilingus",
  "gangbang",
  "sexe anal",
  "sexo anal",
  "anal sex",
  // français
  "(?:ma|ta|sa|une|la|grosse|ma grosse|ta grosse) bites?",
  "penis",
  "vagin",
  "clito\\w*",
  "te sucer",
  "me sucer",
  "suce moi",
  "je te suce",
  "branler",
  "branle",
  "branlette",
  "branlettes",
  "baise",
  "baise moi",
  "(?:te|me|nous|vous|se|on) baise\\w*",
  "niquer",
  "niquee",
  "je te nique",
  "nique moi",
  "levrette",
  "sperme",
  "gode",
  "godemiche",
  "partouze",
  "plan cul",
  "plan q",
  "a poil",
  "toute nue",
  "tout nu",
  "photo nue",
  "photos nues",
  "nichons",
  "seins nus",
  "coucher avec (?:toi|moi|lui|elle|eux|quelqu un)",
  "faire l amour",
  "je bande",
  "tu bandes",
  "(?:te|me|vous|se|je te|tu me) lecher",
  "lecher partout",
  "leche moi",
  "je te leche",
  "lecher (?:ton|ta|tes|mon|ma|mes)",
  "je mouille",
  "tu mouilles",
  "me fait mouiller",
  "te faire mouiller",
  "toute mouillee",
  "(?:mes|tes|ses|vos|tes beaux|tes gros|mes gros|gros) seins",
  "(?:ta|ma|sa|grosse) queue(?! de (?:cheval|poisson|pie|billard|comete|rat))",
  "(?:ma|ta|sa) (?:petite )?chatte (?:mouillee|trempee|humide|chaude)",
  "(?:lecher|caresser|toucher) (?:ta|ma|sa) chatte",
  "(?:ton|mon|son|ce) (?:petit |joli |beau |gros )?cul(?! de sac| sec)",
  "tu m excites",
  "(?<!meme )sexe(?! (?:oppose|feminin|masculin))",
  // anglais
  "fuck\\w*",
  "cock",
  "cocks",
  "dick",
  "dicks",
  "pussy",
  "cum",
  "cumming",
  "horny",
  "naked",
  "boobs",
  "tits",
  "titties",
  "slut",
  "whore",
  "suck my",
  "deepthroat",
  "jerk off",
  "jerking off",
  "have sex",
  "sex with",
  "make love",
  "(?<!same )sex(?! (?:appeal|opposite))",
  // espagnol
  "follar\\w*",
  "follame",
  "polla",
  "pollas",
  "verga",
  "tetas",
  "mamada",
  "chupamela",
  "chupartela",
  "desnuda",
  "desnudo",
  "desnudas",
  "cachond\\w*",
  "correrse",
  "me corro",
  "hacer el amor",
  "(?<!mismo )sexo(?! (?:opuesto|oposto|femenino|masculino|feminino))",
  "excitada",
  "excitado",
  "puta",
  "putas",
  // portugais
  "foder",
  "fode",
  "fodendo",
  "buceta",
  "piroca",
  "tesao",
  "tesuda",
  "tesudo",
  "punheta",
  "siririca",
  "boquete",
  "transar",
  "fazer amor",
  "nua",
  "nuas",
  // allemand
  "fick",
  "ficke",
  "ficken",
  "fickt",
  "fickst",
  "fick dich",
  "schwanz",
  "muschi",
  "titten",
  "nackt",
  "(?:mit dir|dich|will|wollen|lass uns|wir) vogeln",
  "(?:bist du|ich bin|bin so|bin total|macht mich|machst mich) geil",
  "geil auf",
  "bumsen",
  "wichs\\w*",
  "fotze",
  "liebe machen",
  "hure",
  "nutte",
  // italien
  "scopare",
  "scopami",
  "scoparti",
  "scopiamo",
  "pompino",
  "tette",
  "nuda",
  "(?:sono|sei|tutto|tutta) nud[oa]",
  "nudo integrale",
  "(?<!stesso )sesso(?! (?:opposto|femminile|maschile))",
  "eccitata",
  "eccitato",
  "(?:sono|tutta) bagnata",
  "arrapat\\w*",
  "troia",
  "puttana",
  "fare l amore",
];
const EXPLICIT_RE = new RegExp(`\\b(?:${EXPLICIT_WORDS.join("|")})\\b`);

/** Vrai si le texte contient un contenu sexuel explicite ou un mot cru (6 langues). */
export function hasExplicitContent(text: string): boolean {
  return EXPLICIT_RE.test(wordsForm(text));
}

// ------------------------------------------------------------------
// Chiffres inventés (règle 4)
// ------------------------------------------------------------------

/** Multiplicateurs après un nombre (« 1 million », « 2 millions », « 5k », « 3 mil », « 2x plus ») : texte sans accents. */
const MULTIPLIERS =
  "k|mille|milles|million|millions|milliard|milliards|thousand|thousands|billion|billions|mil|millon|millones|milhao|milhoes|milhares|tausend|millionen|milliarde|milliarden|mila|milione|milioni|miliardo|miliardi|x";
// 1 : nombre (séparateurs de milliers compris) ; 2 : « % » ; 3 : multiplicateur.
const NUMBER_RE = new RegExp(
  `(\\d+(?:[.,\\u00a0\\u202f ]\\d+)*)(\\s*%)?(?:\\s*(${MULTIPLIERS})\\b)?`,
  "g",
);

function numberMatches(text: string): RegExpMatchArray[] {
  return [...foldText(text).matchAll(NUMBER_RE)];
}

/**
 * Chiffres connus : nombre entier (séparateurs retirés), chaque groupe de chiffres, « 1* » pour un chiffre suivi d'un
 * multiplicateur (« 1 million »), et « 25% » pour un pourcentage, seulement s'il est écrit avec « % » dans
 * `percentSources`.
 */
function knownNumbers(sources: readonly string[], percentSources: readonly string[]): Set<string> {
  const known = new Set<string>();
  for (const s of sources)
    for (const m of numberMatches(s)) {
      const digits = (m[1] ?? "").replace(/\D/g, "");
      known.add(digits);
      for (const g of m[1]?.match(/\d+/g) ?? []) known.add(g);
      if (m[3]) known.add(`${digits}*`);
    }
  for (const s of percentSources)
    for (const m of numberMatches(s)) if (m[2]) known.add(`${(m[1] ?? "").replace(/\D/g, "")}%`);
  return known;
}

/**
 * Nombres d'un texte absents des sources (fiche de l'offre, messages de la personne) : au moins 2 chiffres, un chiffre
 * suivi d'un multiplicateur (« 1 million », « 2x »), ou un pourcentage. Un pourcentage n'est permis que s'il figure
 * avec « % » dans `percentSources` (la fiche de l'offre pour la validation ; toutes les sources par défaut) : « j'ai 25
 * ans » n'autorise pas « 25 % ». « 18 » seul est permis (mention « réservé aux 18 ans et plus »).
 */
export function inventedNumbers(
  text: string,
  sources: readonly string[],
  opts: { percentSources?: readonly string[] } = {},
): string[] {
  const known = knownNumbers(sources, opts.percentSources ?? sources);
  const out: string[] = [];
  for (const m of numberMatches(text)) {
    const digits = (m[1] ?? "").replace(/\D/g, "");
    if (m[2]) {
      if (!known.has(`${digits}%`)) out.push(m[0].trim());
      continue;
    }
    if (digits.length < 2) {
      if (m[3] && !known.has(`${digits}*`)) out.push(m[0].trim());
      continue;
    }
    if (digits === "18") continue;
    if (!known.has(digits)) out.push(m[0].trim());
  }
  return out;
}

// ------------------------------------------------------------------
// Consignes internes (jamais montrées à la personne)
// ------------------------------------------------------------------

/** Repères du prompt système et du format de sortie (forme « mots ») : leur présence trahit une fuite des consignes. */
const LEAK_MARKERS =
  /\b(?:send offer|minor suspected|note interne|style update|memory facts|consignes complementaires|consignes de l equipe|fiche de l offre|regles prioritaires|prompt systeme|system prompt|mes consignes|mes instructions|my instructions|my system prompt|mis instrucciones|minhas instrucoes|meine anweisungen|le mie istruzioni)\b/;
/** Reprise mot pour mot d'un texte interne : 8 mots d'affilée. */
export const LEAK_NGRAM = 8;

/**
 * Vrai si le texte dévoile les consignes internes : repères du prompt ou du format de sortie (« send_offer »,
 * « consignes complémentaires de l'équipe », « fiche de l'offre »…), ou 8 mots d'affilée repris d'un texte interne
 * (consignes de l'équipe, personnalité, ton).
 */
export function leaksInstructions(
  text: string,
  privateTexts: readonly (string | null | undefined)[] = [],
): boolean {
  const words = wordsForm(text);
  if (LEAK_MARKERS.test(words)) return true;
  const out = words.split(" ").filter(Boolean);
  if (out.length < LEAK_NGRAM) return false;
  const grams = new Set<string>();
  for (const t of privateTexts) {
    const w = wordsForm(t ?? "")
      .split(" ")
      .filter(Boolean);
    for (let i = 0; i + LEAK_NGRAM <= w.length; i++)
      grams.add(w.slice(i, i + LEAK_NGRAM).join(" "));
  }
  if (grams.size === 0) return false;
  for (let i = 0; i + LEAK_NGRAM <= out.length; i++)
    if (grams.has(out.slice(i, i + LEAK_NGRAM).join(" "))) return true;
  return false;
}

/**
 * Question « bot / IA / vraie personne ? » restée sans aveu dans l'historique : la plus récente des 6 derniers messages de
 * la personne qui la pose, si aucun message envoyé ensuite ne dit franchement être une IA (sinon null). L'aveu reste
 * exigé au tour suivant (« sûr ? », « banane » après une question posée pendant la reprise par l'équipe…).
 */
export function openBotQuestion(
  history: ReadonlyArray<{ direction: "IN" | "OUT"; text: string }>,
): string | null {
  let seenIn = 0;
  for (let i = history.length - 1; i >= 0 && seenIn < 6; i--) {
    const h = history[i]!;
    if (h.direction !== "IN") continue;
    seenIn++;
    if (!asksIfBot(h.text)) continue;
    const admitted = history
      .slice(i + 1)
      .some((o) => o.direction === "OUT" && admitsBeingAi(o.text));
    return admitted ? null : h.text;
  }
  return null;
}

/**
 * La personne insiste : elle demande à ce tour si c'est un bot, et l'a déjà demandé (plus tôt dans l'historique ou dans
 * un autre message du même tour). Une persona « fille » doit alors avouer être une IA.
 */
export function botQuestionInsists(
  history: ReadonlyArray<{ direction: "IN" | "OUT"; text: string }>,
  turnTexts: readonly string[],
): boolean {
  const now = turnTexts.filter(asksIfBot).length;
  if (now === 0) return false;
  const before = history.filter((h) => h.direction === "IN" && asksIfBot(h.text)).length;
  return now + before >= 2;
}

// ------------------------------------------------------------------
// Validation d'une réponse
// ------------------------------------------------------------------

function orderCodes(codes: Set<RejectCode>): RejectCode[] {
  return REJECT_CODES.filter((c) => codes.has(c));
}

/** Contrôle toutes les règles ; renvoie les messages nettoyés (espaces autour retirés) ou les codes de rejet. */
export function validateTurnOutput(output: TurnOutput, ctx: ValidationContext): ValidationResult {
  const messages = output.messages.map((m) => m.text.replace(/\r\n?/g, "\n").trim());
  const codes = new Set<RejectCode>();
  const details: string[] = [];
  const reject = (code: RejectCode, detail: string) => {
    codes.add(code);
    details.push(detail);
  };

  if (messages.length < MIN_TURN_MESSAGES || messages.length > MAX_TURN_MESSAGES)
    reject("too_many_messages", `${messages.length} messages (1 à 3 attendus).`);
  if (messages.some((m) => !m)) reject("empty", "Message vide.");

  let total = 0;
  messages.forEach((m, i) => {
    const len = visibleLength(m);
    total += len;
    if (len > MAX_MESSAGE_CHARS)
      reject("too_long", `Message ${i + 1} : ${len} caractères (maximum ${MAX_MESSAGE_CHARS}).`);
    if (hasMarkdown(m))
      reject("markdown", `Message ${i + 1} : mise en forme (markdown ou balise).`);
    if (hasLink(m)) reject("link", `Message ${i + 1} : lien, nom de domaine ou @pseudo.`);
  });
  if (total > MAX_TURN_CHARS)
    reject("too_long", `${total} caractères au total (maximum ${MAX_TURN_CHARS}).`);

  const joined = messages.join("\n");
  const girl = ctx.identity === "GIRL";
  // Illusion : « non, une vraie fille » est la réponse voulue, à la première question comme à l'insistance.
  const illusion = girl && ctx.illusion === true;
  if (hasExplicitContent(joined)) reject("explicit", "Contenu explicite.");
  // Une fille parle d'elle comme d'une fille : le déni n'est refusé que si la personne insiste.
  if (!illusion && (!girl || ctx.botInsists) && deniesBeingAssistant(joined))
    reject("denies_assistant", "Prétend être une vraie personne ou nie être un assistant.");
  // Question posée : l'aveu doit dire « IA », « bot » ou « virtuel(le) » (« l'assistante du canal » seule peut passer
  // pour une personne). Une fille ne le doit qu'à l'insistance.
  const mustAdmit = illusion
    ? false
    : girl
      ? Boolean(ctx.botInsists)
      : ctx.turnInboundTexts.some(asksIfBot);
  if (mustAdmit && !admitsBeingAi(joined))
    reject(
      "missing_assistant_admission",
      "La personne demande si c'est un bot : l'aveu franc d'être une IA manque.",
    );
  if (leaksInstructions(joined, ctx.privateTexts ?? []))
    reject("leak", "Dévoile les consignes internes (règles, consignes de l'équipe, format).");
  if (
    ctx.isFirstAssistantMessage &&
    !(girl ? hasNameIntro(joined, ctx.personaName) : hasIntro(joined, ctx.personaName))
  )
    reject(
      "intro_missing",
      girl
        ? "Premier message : prénom de la persona manquant."
        : "Premier message : prénom de la persona ou mot « assistant(e) » manquant.",
    );

  const invented = inventedNumbers(
    joined,
    [ctx.offerPitch, ...ctx.memberTexts, ...(ctx.facts ?? [])],
    { percentSources: [ctx.offerPitch] },
  );
  if (invented.length > 0)
    reject(
      "invented_number",
      `Chiffre(s) absent(s) de la fiche de l'offre : ${invented.join(", ")}.`,
    );

  if (codes.size > 0) return { ok: false, codes: orderCodes(codes), details, messages };
  return { ok: true, messages };
}

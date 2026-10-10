import type { Vertical } from "@linkaffipro/core";

/**
 * Textes du bot, par langue puis par clé. Le français est la langue par défaut.
 * Six langues : fr, en, es, pt, de, it. Toute clé présente en français doit exister dans chaque langue
 * avec les mêmes variables `{x}` (vérifié par `i18n.test.ts`).
 *
 * Placeholders des textes d'adhésion : {prenom} {canal} {liste_canaux} {delai} {bot} (voir join-flow/texts.ts).
 */
export const MESSAGES = {
  fr: {
    verticalName: { CASINO: "casino", SPORTS: "paris sportifs", DATING: "dating" },
    welcome: "Bonjour, je suis {botName}, le bot {vertical}.",
    adminLinked: "Votre compte Telegram est maintenant lié à LinkAffi Pro, {name}.",
    adminLinkInvalid: "Ce lien de connexion est invalide ou a expiré.",
    forwardUnknownUser: "Je ne reconnais pas votre compte.",
    // Flux d'adhésion
    joinRequestGate:
      "Salut {prenom} ! Pour rejoindre <b>{canal}</b>, rejoins d'abord nos canaux partenaires ci-dessous, puis appuie sur ✅ J'ai rejoint. Ton accès est validé {delai}.",
    joinRequestSoft:
      "Salut {prenom} ! Ta demande pour <b>{canal}</b> est bien reçue : elle sera validée {delai}. En attendant, découvre aussi nos autres canaux ci-dessous.",
    joinRequestPlain:
      "Salut {prenom} ! Ta demande pour <b>{canal}</b> est bien reçue : elle sera validée {delai}.",
    gateSatisfied: "C'est bon {prenom}, tu seras accepté dans <b>{canal}</b> {delai}.",
    gateMissing:
      "Il te manque encore : {liste_canaux}. Rejoins-les puis appuie à nouveau sur ✅ J'ai rejoint.",
    gateReminder:
      "{prenom}, ta demande pour <b>{canal}</b> attend encore : rejoins {liste_canaux} puis appuie sur ✅ J'ai rejoint.",
    approved: "Bienvenue dans <b>{canal}</b>, {prenom} ! Tu es accepté.",
    unknownCode:
      "Je ne retrouve pas ta demande. Refais une demande d'adhésion au canal, puis réessaie.",
    joinedLabel: "✅ J'ai rejoint",
    joinLabel: "Rejoindre",
    // Offres
    offerReply: "Voici ton lien personnel, {prenom} 👇",
    offerButton: "Ouvrir l'offre",
    offerInvalid: "Ce lien n'est plus valable.",
    // Délais (« dans 10 minutes »)
    delayNow: "immédiatement",
    delayIn: "dans {n} {unit}",
    unitDay: "jour",
    unitDays: "jours",
    unitHour: "heure",
    unitHours: "heures",
    unitMinute: "minute",
    unitMinutes: "minutes",
    unitSecond: "seconde",
    unitSeconds: "secondes",
  },
  en: {
    verticalName: { CASINO: "casino", SPORTS: "sports betting", DATING: "dating" },
    welcome: "Hello, I am {botName}, the {vertical} bot.",
    adminLinked: "Your Telegram account is now linked to LinkAffi Pro, {name}.",
    adminLinkInvalid: "This login link is invalid or has expired.",
    forwardUnknownUser: "I don't recognize your account.",
    joinRequestGate:
      "Hi {prenom}! To join <b>{canal}</b>, first join our partner channels below, then tap ✅ I joined. Your access is confirmed {delai}.",
    joinRequestSoft:
      "Hi {prenom}! Your request for <b>{canal}</b> is received and will be confirmed {delai}. Meanwhile, check out our other channels below.",
    joinRequestPlain:
      "Hi {prenom}! Your request for <b>{canal}</b> is received and will be confirmed {delai}.",
    gateSatisfied: "All good {prenom}, you'll be accepted into <b>{canal}</b> {delai}.",
    gateMissing: "Still missing: {liste_canaux}. Join them, then tap ✅ I joined again.",
    gateReminder:
      "{prenom}, your request for <b>{canal}</b> is still pending: join {liste_canaux} then tap ✅ I joined.",
    approved: "Welcome to <b>{canal}</b>, {prenom}! You're in.",
    unknownCode: "I can't find your request. Please request to join the channel again, then retry.",
    joinedLabel: "✅ I joined",
    joinLabel: "Join",
    offerReply: "Here is your personal link, {prenom} 👇",
    offerButton: "Open the offer",
    offerInvalid: "This link is no longer valid.",
    delayNow: "immediately",
    delayIn: "in {n} {unit}",
    unitDay: "day",
    unitDays: "days",
    unitHour: "hour",
    unitHours: "hours",
    unitMinute: "minute",
    unitMinutes: "minutes",
    unitSecond: "second",
    unitSeconds: "seconds",
  },
  es: {
    verticalName: { CASINO: "casino", SPORTS: "apuestas deportivas", DATING: "citas" },
    welcome: "Hola, soy {botName}, el bot de {vertical}.",
    adminLinked: "Tu cuenta de Telegram ya está vinculada a LinkAffi Pro, {name}.",
    adminLinkInvalid: "Este enlace de conexión no es válido o ha caducado.",
    forwardUnknownUser: "No reconozco tu cuenta.",
    joinRequestGate:
      "¡Hola {prenom}! Para unirte a <b>{canal}</b>, únete primero a nuestros canales asociados aquí abajo y luego pulsa ✅ Ya me uní. Tu acceso se confirma {delai}.",
    joinRequestSoft:
      "¡Hola {prenom}! Hemos recibido tu solicitud para <b>{canal}</b>: se confirmará {delai}. Mientras tanto, descubre también nuestros otros canales aquí abajo.",
    joinRequestPlain:
      "¡Hola {prenom}! Hemos recibido tu solicitud para <b>{canal}</b>: se confirmará {delai}.",
    gateSatisfied: "Perfecto {prenom}, serás aceptado en <b>{canal}</b> {delai}.",
    gateMissing: "Todavía te falta: {liste_canaux}. Únete y vuelve a pulsar ✅ Ya me uní.",
    gateReminder:
      "{prenom}, tu solicitud para <b>{canal}</b> sigue pendiente: únete a {liste_canaux} y pulsa ✅ Ya me uní.",
    approved: "¡Bienvenido a <b>{canal}</b>, {prenom}! Ya estás dentro.",
    unknownCode:
      "No encuentro tu solicitud. Vuelve a solicitar unirte al canal y luego inténtalo de nuevo.",
    joinedLabel: "✅ Ya me uní",
    joinLabel: "Unirse a",
    offerReply: "Aquí tienes tu enlace personal, {prenom} 👇",
    offerButton: "Abrir la oferta",
    offerInvalid: "Este enlace ya no es válido.",
    delayNow: "inmediatamente",
    delayIn: "en {n} {unit}",
    unitDay: "día",
    unitDays: "días",
    unitHour: "hora",
    unitHours: "horas",
    unitMinute: "minuto",
    unitMinutes: "minutos",
    unitSecond: "segundo",
    unitSeconds: "segundos",
  },
  pt: {
    verticalName: { CASINO: "casino", SPORTS: "apostas desportivas", DATING: "encontros" },
    welcome: "Olá, eu sou {botName}, o bot de {vertical}.",
    adminLinked: "A tua conta Telegram está agora ligada ao LinkAffi Pro, {name}.",
    adminLinkInvalid: "Este link de ligação é inválido ou expirou.",
    forwardUnknownUser: "Não reconheço a sua conta.",
    joinRequestGate:
      "Olá {prenom}! Para entrar em <b>{canal}</b>, entra primeiro nos nossos canais parceiros abaixo e depois toca em ✅ Já entrei. O teu acesso é confirmado {delai}.",
    joinRequestSoft:
      "Olá {prenom}! Recebemos o teu pedido para <b>{canal}</b>: será confirmado {delai}. Entretanto, descobre também os nossos outros canais abaixo.",
    joinRequestPlain:
      "Olá {prenom}! Recebemos o teu pedido para <b>{canal}</b>: será confirmado {delai}.",
    gateSatisfied: "Tudo certo {prenom}, serás aceite em <b>{canal}</b> {delai}.",
    gateMissing: "Ainda falta: {liste_canaux}. Entra e depois toca novamente em ✅ Já entrei.",
    gateReminder:
      "{prenom}, o teu pedido para <b>{canal}</b> ainda está pendente: entra em {liste_canaux} e toca em ✅ Já entrei.",
    approved: "Bem-vindo a <b>{canal}</b>, {prenom}! Já estás dentro.",
    unknownCode:
      "Não encontro o teu pedido. Pede novamente para entrar no canal e tenta outra vez.",
    joinedLabel: "✅ Já entrei",
    joinLabel: "Entrar em",
    offerReply: "Aqui está o teu link pessoal, {prenom} 👇",
    offerButton: "Abrir a oferta",
    offerInvalid: "Este link já não é válido.",
    delayNow: "imediatamente",
    delayIn: "em {n} {unit}",
    unitDay: "dia",
    unitDays: "dias",
    unitHour: "hora",
    unitHours: "horas",
    unitMinute: "minuto",
    unitMinutes: "minutos",
    unitSecond: "segundo",
    unitSeconds: "segundos",
  },
  de: {
    verticalName: { CASINO: "Casino", SPORTS: "Sportwetten", DATING: "Dating" },
    welcome: "Hallo, ich bin {botName}, der {vertical}-Bot.",
    adminLinked: "Dein Telegram-Konto ist jetzt mit LinkAffi Pro verknüpft, {name}.",
    adminLinkInvalid: "Dieser Anmeldelink ist ungültig oder abgelaufen.",
    forwardUnknownUser: "Ich erkenne dein Konto nicht.",
    joinRequestGate:
      "Hallo {prenom}! Um <b>{canal}</b> beizutreten, tritt zuerst unseren Partnerkanälen unten bei und tippe dann auf ✅ Beigetreten. Dein Zugang wird {delai} bestätigt.",
    joinRequestSoft:
      "Hallo {prenom}! Deine Anfrage für <b>{canal}</b> ist angekommen und wird {delai} bestätigt. Schau dir in der Zwischenzeit auch unsere anderen Kanäle unten an.",
    joinRequestPlain:
      "Hallo {prenom}! Deine Anfrage für <b>{canal}</b> ist angekommen und wird {delai} bestätigt.",
    gateSatisfied: "Alles klar {prenom}, du wirst {delai} in <b>{canal}</b> aufgenommen.",
    gateMissing:
      "Es fehlt noch: {liste_canaux}. Tritt bei und tippe dann erneut auf ✅ Beigetreten.",
    gateReminder:
      "{prenom}, deine Anfrage für <b>{canal}</b> wartet noch: tritt {liste_canaux} bei und tippe dann auf ✅ Beigetreten.",
    approved: "Willkommen in <b>{canal}</b>, {prenom}! Du bist drin.",
    unknownCode:
      "Ich finde deine Anfrage nicht. Bitte stelle erneut eine Beitrittsanfrage an den Kanal und versuche es dann noch einmal.",
    joinedLabel: "✅ Beigetreten",
    joinLabel: "Beitreten:",
    offerReply: "Hier ist dein persönlicher Link, {prenom} 👇",
    offerButton: "Angebot öffnen",
    offerInvalid: "Dieser Link ist nicht mehr gültig.",
    delayNow: "sofort",
    delayIn: "in {n} {unit}",
    unitDay: "Tag",
    unitDays: "Tagen",
    unitHour: "Stunde",
    unitHours: "Stunden",
    unitMinute: "Minute",
    unitMinutes: "Minuten",
    unitSecond: "Sekunde",
    unitSeconds: "Sekunden",
  },
  it: {
    verticalName: { CASINO: "casinò", SPORTS: "scommesse sportive", DATING: "incontri" },
    welcome: "Ciao, sono {botName}, il bot {vertical}.",
    adminLinked: "Il tuo account Telegram è ora collegato a LinkAffi Pro, {name}.",
    adminLinkInvalid: "Questo link di accesso non è valido o è scaduto.",
    forwardUnknownUser: "Non riconosco il tuo account.",
    joinRequestGate:
      "Ciao {prenom}! Per entrare in <b>{canal}</b>, unisciti prima ai nostri canali partner qui sotto, poi tocca ✅ Mi sono unito. Il tuo accesso è confermato {delai}.",
    joinRequestSoft:
      "Ciao {prenom}! Abbiamo ricevuto la tua richiesta per <b>{canal}</b>: sarà confermata {delai}. Nel frattempo, scopri anche gli altri nostri canali qui sotto.",
    joinRequestPlain:
      "Ciao {prenom}! Abbiamo ricevuto la tua richiesta per <b>{canal}</b>: sarà confermata {delai}.",
    gateSatisfied: "Perfetto {prenom}, sarai accettato in <b>{canal}</b> {delai}.",
    gateMissing: "Manca ancora: {liste_canaux}. Unisciti e poi tocca di nuovo ✅ Mi sono unito.",
    gateReminder:
      "{prenom}, la tua richiesta per <b>{canal}</b> è ancora in attesa: unisciti a {liste_canaux} e poi tocca ✅ Mi sono unito.",
    approved: "Benvenuto in <b>{canal}</b>, {prenom}! Sei dentro.",
    unknownCode:
      "Non trovo la tua richiesta. Richiedi di nuovo di entrare nel canale, poi riprova.",
    joinedLabel: "✅ Mi sono unito",
    joinLabel: "Unisciti a",
    offerReply: "Ecco il tuo link personale, {prenom} 👇",
    offerButton: "Apri l'offerta",
    offerInvalid: "Questo link non è più valido.",
    delayNow: "subito",
    delayIn: "tra {n} {unit}",
    unitDay: "giorno",
    unitDays: "giorni",
    unitHour: "ora",
    unitHours: "ore",
    unitMinute: "minuto",
    unitMinutes: "minuti",
    unitSecond: "secondo",
    unitSeconds: "secondi",
  },
} as const;

export type Lang = keyof typeof MESSAGES;
export const LANGS = Object.keys(MESSAGES) as Lang[];
export const DEFAULT_LANG: Lang = "fr";

/** Clés de texte simples (toutes sauf le dictionnaire des univers). */
export type MessageKey = Exclude<keyof (typeof MESSAGES)["fr"], "verticalName">;

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && value in MESSAGES;
}

/** Langue de base d'un code Telegram (`pt-br` → pt, `en-US` → en, inconnu → fr). */
export function pickLang(languageCode: string | undefined | null): Lang {
  const base = (languageCode ?? "").toLowerCase().split(/[-_]/)[0];
  return isLang(base) ? base : DEFAULT_LANG;
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}

export function t(
  lang: Lang,
  key: "welcome",
  vars: { botName: string; vertical: Vertical },
): string;
export function t(lang: Lang, key: "adminLinked", vars: { name: string }): string;
export function t(lang: Lang, key: "delayIn", vars: { n: string; unit: string }): string;
export function t(lang: Lang, key: MessageKey, vars?: Record<string, string>): string;
export function t(lang: Lang, key: string, vars: Record<string, string> = {}): string {
  const dict = MESSAGES[lang] ?? MESSAGES[DEFAULT_LANG];
  if (key === "welcome") {
    const v = vars.vertical as Vertical;
    return fill(dict.welcome, { botName: vars.botName ?? "", vertical: dict.verticalName[v] ?? v });
  }
  const template = (dict as Record<string, unknown>)[key];
  return typeof template === "string" ? fill(template, vars) : key;
}

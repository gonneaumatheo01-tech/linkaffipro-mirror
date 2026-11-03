// Gérant du VIP (Paris sportifs, phase 36) : règles codées propres à cette persona, jamais appliquées à une autre (les
// filles des comptes réels et leur série de photos n'en voient rien). Relecture du texte du modèle : phrases qui font
// patienter, lien d'inscription ou accès au VIP annoncés, bookmaker nommé, dépôt confirmé par la personne, emojis.
// Fonctions pures.
import { foldText } from "./text-utils";
import type { PersonaBookmakerInput, PersonaInput } from "./turn-types";

/** Gérant du VIP : Paris sportifs et identité VIP_MANAGER (champ `vipManager` posé par l'appelant). */
export function isVipManagerPersona(p: Pick<PersonaInput, "vipManager" | "universe">): boolean {
  return p.vipManager === true && p.universe === "sports";
}

// ------------------------------------------------------------------
// Script du client (3 novembre 2026), mot pour mot, en français
// ------------------------------------------------------------------

/** Premier message : ce que sont les tirs cadrés et la seule condition du VIP. */
export const VIP_SCRIPT_PITCH =
  "Salut, dcp je t'explique en gros les tir cadrés ils sont dispo que sur nos book partenaires (ya pas sur wina ect), et pour avoir accès au vip il faut uniquement que tu sois joueur sur un de nos book. C'est bon pour toi ?";

/** Question sur un bookmaker (le premier de la liste, puis le suivant s'il a déjà un compte). */
export function vipScriptAskBook(label: string): string {
  return `Tu connais ${label} ? t'as un compte dessus ?`;
}

/** Envoi du lien d'inscription (le lien part tout seul juste après ce message). */
export const VIP_SCRIPT_LINK =
  "Ok attend je t'envoie le lien, inscrit toi fait un dépôt le montant que tu veux et quand c'est fait je t'envoi le lien du vip, t'auras accès au bet tir cadré.";

/** Le texte parle du VIP, des bookmakers ou des tirs cadrés (premier message : le script le remplace alors). */
export function talksAboutVip(texts: readonly string[]): boolean {
  return texts.some((t) => /\b(?:vip|book|books|bookmakers?|tirs?)\b/.test(norm(t)));
}

/** Minuscules sans accents, apostrophes typographiques ramenées à « ' ». */
function norm(text: string): string {
  return foldText(text).replace(/[’‘`´]/g, "'");
}

/** Phrases d'un texte (coupées sur . ! ? et retours à la ligne), avec leur ponctuation finale. */
function sentences(text: string): { body: string; question: boolean }[] {
  const out: { body: string; question: boolean }[] = [];
  for (const m of norm(text).matchAll(/[^.!?\n]+[.!?]*/g)) {
    const raw = m[0];
    const body = raw.replace(/[.!?]+$/, "").trim();
    if (body) out.push({ body, question: raw.includes("?") });
  }
  return out;
}

// ------------------------------------------------------------------
// Phrases qui font patienter
// ------------------------------------------------------------------

/** Sujet devant « attend(s) » : ce n'est plus un ordre (« on attend », « qui attend »). */
const ATTENDS_SUBJECTS = new Set(["je", "j", "tu", "t", "on", "il", "elle", "nous", "vous", "ils", "elles", "qui", "ca"]);

/** Juste après « attend » : « je t'envoie le lien » (mots déjà découpés, sans apostrophe). */
const SENDS_LINK_NOW =
  /^(?:je t|je te|jt|jte|j t|j te) (?:envoie|envoi|envois|mets|met|file|passe|balance) (?:le |ton )?lien\b/;

const WAITING_PATTERNS: readonly RegExp[] = [
  // « je reviens », « jreviens », « j'reviens », « je reviens vers toi », « je te reviens »
  /\b(?:je |j'|j)reviens\b/,
  /\bje te reviens\b/,
  // « 2 sec », « 2sec », « une seconde », « deux secondes »
  /\b(?:\d+|une?|deux|trois|cinq|dix|quelques)\s?(?:sec|secs|seconde|secondes|scd)\b/,
  // « dans 5 min », « encore deux minutes »
  /\b(?:dans|encore)\s(?:\d+|une?|deux|trois|cinq|dix|quelques)\s?(?:min|mins|minute|minutes)\b/,
  /\bun (?:petit )?instant\b/,
  // « j'arrive » (pas « j'arrive pas à »)
  /\bj'? ?arrive\b(?!\s+pas\b)/,
  /\bbouge pas\b/,
  /\bpatiente\b/,
  /\bsois patient/,
  /\blaisse[- ]?moi (?:voir|regarder|checker|check|verifier|demander|deux|2)\b/,
  /\bje (?:te )?(?:redis|tiens au courant|recontacte|reecris)\b/,
  /\bje (?:regarde|check|checke|verifie|demande|vois)\b[^.!?\n]{0,40}\bet je (?:te )?(?:dis|redis|reviens)\b/,
  /\bje vais (?:voir|regarder|checker|verifier|demander)\b/,
  // Action de lui remise à plus tard (« je t'envoie ça plus tard », « je regarde ça tout à l'heure ») ; pas un passé
  // (« je t'ai dit tout à l'heure ») ni l'action d'un autre (« je pense que tu pourras le faire plus tard »).
  /\bje (?:te |t')?(?:l'|le |la |les )?(?!ai\b|avais\b|etais\b)[a-z]+\b(?!')(?:(?!\b(?:tu|il|elle|on|vous)\b)[^.!?\n]){0,25}\b(?:plus tard|tout a l'heure|dans un moment|dans pas longtemps|d'ici peu)\b/,
  // Anglais
  /\b(?:hold on|one sec|1 sec|a sec|one moment|a moment|be right back|brb|let me check|i'll get back to you|i will get back to you)\b/,
  /\b(?:wait|just) a (?:sec|second|minute|moment)\b/,
  /\bgive me (?:a|one|1|two|2) (?:sec|second|minute|moment)s?\b/,
];

/**
 * Vrai si le texte fait patienter la personne (« attends », « je reviens », « 2 sec », « je regarde et je te dis »…) :
 * le gérant du VIP répond toujours tout de suite, ou passe la main à l'équipe. « j'attends », « t'attends quoi » et
 * « attendre » ne comptent pas, ni « attend je t'envoie le lien » du script (le lien annoncé part forcément à ce
 * message : une annonce qui ne peut pas partir est refusée à part).
 */
export function hasWaitingPhrase(text: string): boolean {
  const t = norm(text);
  const tokens = t.split(/[^a-z0-9]+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i];
    if (w !== "attends" && w !== "attend") continue;
    if (ATTENDS_SUBJECTS.has(tokens[i - 1] ?? "")) continue;
    if (SENDS_LINK_NOW.test(tokens.slice(i + 1, i + 6).join(" "))) continue;
    return true;
  }
  return WAITING_PATTERNS.some((re) => re.test(t));
}

// ------------------------------------------------------------------
// Lien d'inscription et accès au VIP annoncés
// ------------------------------------------------------------------

/**
 * Condition ou suite AVANT l'annonce, dans la même phrase (« si t'as pas de compte je t'envoie le lien », « après je
 * te file l'accès ») : ce n'est pas un envoi maintenant.
 */
const CONDITION_BEFORE =
  /\b(?:si|s'il|s'ils|sinon|quand|lorsque|des que|une fois que|une fois|apres|ensuite|puis|avant|if|when|once|after|as soon as|before)\b/;

/**
 * Démarche demandée à la personne AVANT l'annonce (« fais ton dépôt et je t'envoie le lien du vip », « tu t'inscris,
 * tu déposes et je te file l'accès ») : l'annonce décrit la suite, pas un envoi maintenant.
 */
const STEPS_BEFORE =
  /\b(?:tu (?:t'inscris|t inscris|te inscris|deposes|fais (?:ton|un|une|le|ta|tes)|crees (?:ton|un|une)|valides|recharges)|inscris[- ]toi|fais (?:ton|un|une|le|ta|tes)|cree (?:ton|un|une)|valide (?:ton|ta)|depose (?:un|ton|au moins|\d)|envoie[- ]moi|montre[- ]moi|you (?:sign up|register|deposit|make)|sign up|make (?:a|your) (?:first )?deposit)\b/;

/**
 * Condition ou report juste APRÈS l'annonce, dans la même proposition (« je t'envoie le lien du vip dès que c'est
 * fait », « je t'ajoute au vip après ton dépôt », « je t'envoie le lien si tu veux ») ; une virgule ouvre une autre
 * proposition (« je t'envoie le lien, une fois inscrit tu déposes » reste une annonce).
 */
const CONDITION_AFTER =
  /\b(?:si|s'il|s'ils|quand|lorsque|des que|une fois|sous reserve|apres (?:ton|ta|tes|le|la|les|l'|avoir|que|qu'|un|une|verif|verification|validation|ca)|plus tard|tout a l'heure|demain|if|when|once|as soon as|after|later|tomorrow)\b|\bapres\s*$/;

/** Proposition qui suit une annonce : jusqu'à la virgule, au point-virgule, aux deux-points ou au tiret. */
function clauseAfter(body: string, end: number): string {
  const rest = body.slice(end);
  const cut = rest.search(/[,;:]| - /);
  return cut >= 0 ? rest.slice(0, cut) : rest;
}

/** Annonce au présent : ni condition ni démarche avant elle dans la phrase, ni condition juste après. */
function firm(body: string, at: number, end: number): boolean {
  const before = body.slice(0, at);
  if (CONDITION_BEFORE.test(before) || STEPS_BEFORE.test(before)) return false;
  return !CONDITION_AFTER.test(clauseAfter(body, end));
}

/** « je t'envoie », « jte mets », « je vais te filer », « je te renvoie »… (envoi par lui, au présent). */
const SEND_VERB =
  "(?:je t'|j't'|jt'|je te |jte |j'te |je vais te |j'vais te |jvais te |je vais t'|j'vais t'|jvais t')(?:envoyer|envoie|renvoyer|renvoie|send|mettre|mets|met|remets|filer|file|refile|passer|passe|repasse|balancer|balance|donner|donne|redonne|partager|partage|lacher|lache|drop)";

/** Envoi annoncé en anglais (« i'll send you », « let me drop »). */
const SEND_VERB_EN =
  "(?:i'll|i will|ill|i'm gonna|im gonna|i am going to|i'm going to|let me|lemme|i'm|im) (?:send|drop|give|share|pass|sending|dropping|giving|sharing)(?: you| u| ya)?";

/** Après « lien » / « link » : c'est le lien du VIP, pas celui de l'inscription. */
const VIP_AFTER_LINK =
  /^\s*(?:du |de |d'|pour |pour le |pour ton |au |d'acces |d acces |to the |for the |of the )?(?:vip|canal|acces|groupe|channel|access|group)/;

/** Après « lien » : un lien déjà envoyé (« le lien au-dessus », « le lien que je t'ai envoyé »), pas un nouvel envoi. */
const OLD_LINK_AFTER =
  /^[^.!?\n]{0,30}?\b(?:au[- ]dessus|plus haut|que je t'ai|que jt'ai|que j't'ai|que je t'avais|d'avant|de tout a l'heure|precedent|deja envoye|que t'as recu|above|i sent|already sent)\b/;

const LINK_PATTERNS: readonly RegExp[] = [
  new RegExp(`\\b${SEND_VERB}\\b[^.!?\\n]{0,30}?\\blien\\b`, "g"),
  /\b(?:voila|voici|tiens)\b[^.!?\n]{0,20}?\blien\b/g,
  /\blien\b(?=[^.!?\n]{0,25}\b(?:juste en dessous|en dessous|ci-dessous|ci dessous|juste apres|juste en bas|arrive)\b)/g,
  new RegExp(`\\b${SEND_VERB_EN}\\b[^.!?\\n]{0,30}?\\blink\\b`, "g"),
  /\b(?:here's|heres|here is|here you go)\b[^.!?\n]{0,20}?\blink\b/g,
  /\blink\b(?=[^.!?\n]{0,25}\b(?:below|right below|coming)\b)/g,
];

type LinkMention = { at: number; end: number; vip: boolean; old: boolean };

/** Liens annoncés dans une phrase : position, nature (lien du VIP ou d'inscription), lien déjà envoyé. */
function linkMentions(body: string): LinkMention[] {
  const out: LinkMention[] = [];
  for (const re of LINK_PATTERNS) {
    re.lastIndex = 0;
    for (const m of body.matchAll(re)) {
      const at = m.index ?? 0;
      const word = m[0].lastIndexOf("lien") >= 0 ? "lien" : "link";
      // Juste après « lien » : la suite dit si c'est le lien du VIP (« le lien du vip ») ou un ancien lien.
      const lienEnd = at + m[0].lastIndexOf(word) + word.length;
      const next = body.slice(lienEnd);
      out.push({
        at,
        end: lienEnd,
        vip: VIP_AFTER_LINK.test(next.slice(0, 25)),
        old: OLD_LINK_AFTER.test(next),
      });
    }
  }
  return out;
}

/**
 * Vrai si le texte annonce, au présent, l'envoi du lien d'inscription (« je t'envoie le lien », « voilà le lien »,
 * « le lien juste en dessous ») : jamais une question, une annonce sous condition, un lien déjà envoyé ni le lien du VIP.
 */
export function announcesRegistrationLink(texts: readonly string[]): boolean {
  return texts.some((text) =>
    sentences(text).some(
      (s) =>
        !s.question &&
        linkMentions(s.body).some((l) => !l.vip && !l.old && firm(s.body, l.at, l.end)),
    ),
  );
}

const VIP_ACCESS_PATTERNS: readonly RegExp[] = [
  new RegExp(
    `\\b(?:${SEND_VERB}|je t'ajoute|jt'ajoute|je te rajoute|je t'ouvre|jt'ouvre|je te fais rentrer|je te fais entrer)\\b[^.!?\\n]{0,30}?\\b(?:vip|acces|canal|groupe)\\b`,
    "g",
  ),
  /\b(?:voila|voici|tiens)\b[^.!?\n]{0,25}?\b(?:vip|acces)\b/g,
  /\bje t'ai (?:ajoute|rajoute)\b/g,
  new RegExp(`\\b(?:${SEND_VERB_EN}|i'll add you|i will add you|i'm adding you)\\b[^.!?\\n]{0,30}?\\b(?:vip|access|channel|group)\\b`, "g"),
  /\b(?:here's|heres|here is)\b[^.!?\n]{0,25}?\b(?:vip|access)\b/g,
  /\bi(?:'ve| have) added you\b/g,
];

/**
 * Vrai si le texte donne, au présent, l'accès au VIP (« voilà l'accès au vip », « je t'envoie le lien du vip », « je
 * t'ajoute au vip ») : jamais une question, une annonce sous condition (« dès que t'as déposé », « après ton dépôt »)
 * ou qui décrit la démarche (« fais ton dépôt et je te file l'accès »), ni une phrase qui envoie aussi le lien
 * d'inscription (« je t'envoie le lien, tu déposes et je te file le vip » décrit la suite).
 */
export function announcesVipAccess(texts: readonly string[]): boolean {
  return texts.some((text) =>
    sentences(text).some((s) => {
      if (s.question) return false;
      const links = linkMentions(s.body);
      if (links.some((l) => !l.vip && !l.old && firm(s.body, l.at, l.end))) return false;
      if (links.some((l) => l.vip && !l.old && firm(s.body, l.at, l.end))) return true;
      return VIP_ACCESS_PATTERNS.some((re) => {
        re.lastIndex = 0;
        return [...s.body.matchAll(re)].some((m) =>
          firm(s.body, m.index ?? 0, (m.index ?? 0) + m[0].length),
        );
      });
    }),
  );
}

// ------------------------------------------------------------------
// Dépôt confirmé par la personne
// ------------------------------------------------------------------

/** Dépôt dit clairement (passé), même dans une question (« j'ai déposé, c'est bon ? »). */
const DEPOSIT_DONE: readonly RegExp[] = [
  /\b(?:j'ai|jai|j ai|g|ja|c'est|cest|c est) ?(?:bien |deja |enfin |juste )?depose\b/,
  /\b(?:j'ai|jai|j ai|g) (?:bien |deja |enfin |juste )?(?:fait|mis|effectue|valide|envoye|realise) (?:mon |le |un |ma |une |les |mes )?(?:premier |1er |petit )?(?:depot|depo|versement)\b/,
  /\b(?:depot|depo|premier depot|1er depot|versement)\b[^.!?\n]{0,15}\b(?:fait|ok|effectue|valide|passe|good|envoye|reussi|termine|recu)\b/,
  /\b(?:j'ai|jai|j ai|g) (?:bien |deja )?(?:mis|recharge|verse|charge) (?:\d|les |mes |un |une |des )/,
  /\bi(?:'ve| have| just)? ?(?:deposited|made (?:a|my|the) (?:first )?deposit)\b/,
  /\bdeposit (?:done|made|sent|complete|completed|ok)\b/,
];

/** « déposé » seul (« ok déposé », « voilà déposé ») : hors question, ni nié, ni à venir. */
const DEPOSIT_BARE =
  /(?<!\b(?:pas|encore|jamais|je|tu|vais|vas|va|dois|doit|faut|peux|peut|veux|veut|comment|ou|quand|si|il|elle|on) )\bdepose\b/;

/** Confirmation sans le mot « dépôt » (« c'est bon », « c'est fait ») : vaut dépôt seulement s'il venait d'en parler. */
const GENERIC_DONE =
  /\b(?:c'est|cest|c|c'|ca|c est) (?:bon|fait|good|ok|valide|regle)\b|\bca y est\b|\b(?:done|all set|it's done)\b|^(?:fait|voila|ok fait|bon fait)$/;

/** Inscription sans dépôt (« c'est bon je suis inscrit ») : ce n'est pas un dépôt. */
const SIGNUP_ONLY =
  /\b(?:inscrit|inscrite|inscription|inscris|compte cree|cree mon compte|cree un compte|j'ai un compte|j'ai mon compte|signed up|registered|created (?:my|an) account)\b/;

/** Négation qui annule la confirmation (« pas encore », « toujours pas »). */
const NOT_YET = /\b(?:pas encore|toujours pas|pas fait|pas depose|j'ai pas|jai pas|g pas|not yet|haven't|didn't)\b/;

/**
 * Vrai si la personne dit avoir fait son dépôt (« c bon j'ai déposé », « dépôt fait », « j'ai mis 20 € »). Une simple
 * confirmation (« c'est bon », « c'est fait », « ça y est ») ne compte que si l'assistant venait de lui parler du dépôt
 * (`askedDeposit`), et jamais quand elle ne parle que de son inscription (« c'est bon je suis inscrit »).
 */
export function confirmsDeposit(
  texts: readonly string[],
  opts: { askedDeposit?: boolean } = {},
): boolean {
  return texts.some((text) => {
    const n = norm(text);
    if (NOT_YET.test(n)) return false;
    if (DEPOSIT_DONE.some((re) => re.test(n))) return true;
    return sentences(text).some((s) => {
      if (s.question) return false;
      if (DEPOSIT_BARE.test(s.body)) return true;
      return opts.askedDeposit === true && !SIGNUP_ONLY.test(s.body) && GENERIC_DONE.test(s.body);
    });
  });
}

/** Vrai si ces messages de l'assistant parlent du dépôt (« tu fais ton premier dépôt et tu me dis quand c'est bon »). */
export function mentionsDeposit(texts: readonly string[]): boolean {
  return texts.some((t) => /\b(?:depot|depo|deposer|depose|deposes|deposit)\b/.test(norm(t)));
}

// ------------------------------------------------------------------
// Bookmakers nommés
// ------------------------------------------------------------------

/** Lettres et chiffres seulement (« Bet Portal » → « betportal »). */
function compact(text: string): string {
  return foldText(text).replace(/[^a-z0-9]+/g, "");
}

/** Formes reconnues d'un bookmaker : clé, nom, premier mot du nom s'il est assez long (« celsius »). */
function bookAliases(b: PersonaBookmakerInput): string[] {
  const first = compact(b.label.split(/\s+/)[0] ?? "");
  return [...new Set([compact(b.bookmakerKey), compact(b.label), first.length >= 5 ? first : ""])].filter(
    (a) => a.length >= 4,
  );
}

/** Clés des bookmakers nommés dans les textes, de la moins récente à la plus récente mention. */
export function booksMentioned(
  texts: readonly string[],
  books: readonly PersonaBookmakerInput[],
): string[] {
  const text = compact(texts.join(" "));
  const found: { key: string; at: number }[] = [];
  for (const b of books) {
    let at = -1;
    for (const a of bookAliases(b)) at = Math.max(at, text.lastIndexOf(a));
    if (at >= 0) found.push({ key: b.bookmakerKey, at });
  }
  return found.sort((x, y) => x.at - y.at).map((f) => f.key);
}

/** Clé d'un bookmaker de la persona (clé exacte, nom ou forme compacte), ou null. */
export function normalizeBookKey(
  value: string | null | undefined,
  books: readonly PersonaBookmakerInput[],
): string | null {
  const v = compact(value ?? "");
  if (!v) return null;
  return books.find((b) => b.bookmakerKey === value?.trim() || bookAliases(b).includes(v))?.bookmakerKey ?? null;
}

/** Positions des bookmakers nommés dans un texte déjà normalisé (`norm`), par forme reconnue. */
function bookPositions(
  body: string,
  books: readonly PersonaBookmakerInput[],
): { key: string; at: number }[] {
  const out: { key: string; at: number }[] = [];
  for (const b of books)
    for (const a of bookAliases(b)) {
      // La forme compacte (« betportal ») se cherche aussi en plusieurs mots (« bet portal »).
      const re = new RegExp(a.split("").join("[^a-z0-9]{0,2}"), "g");
      for (const m of body.matchAll(re)) out.push({ key: b.bookmakerKey, at: m.index ?? 0 });
    }
  return out.sort((x, y) => x.at - y.at);
}

/** Juste après « lien » : mots de liaison avant le nom du bookmaker (« le lien d'inscription de Betportal »). */
const LINK_BOOK_LEAD =
  /^\s*(?:d'inscription\s*|d inscription\s*)?(?:(?:de|du|pour|sur|chez|vers)\s+|d')?(?:la\s+|le\s+|ton\s+)?/;

/**
 * Bookmaker nommé juste après l'annonce du lien d'inscription (« je t'envoie le lien Betportal », « voilà le lien de
 * Sportaza », « le lien d'inscription Bet Portal »). Un bookmaker nommé ailleurs dans la phrase ne compte pas (« t'as
 * déjà Celsius, je t'envoie le lien » parle d'un autre). Null si aucun.
 */
export function announcedBook(
  texts: readonly string[],
  books: readonly PersonaBookmakerInput[],
): string | null {
  let found: string | null = null;
  for (const text of texts)
    for (const s of sentences(text)) {
      if (s.question) continue;
      for (const l of linkMentions(s.body)) {
        if (l.vip || l.old || !firm(s.body, l.at, l.end)) continue;
        const next = s.body.slice(l.end, l.end + 60);
        const lead = LINK_BOOK_LEAD.exec(next)?.[0].length ?? 0;
        const named = bookPositions(next, books).find((p) => p.at <= lead);
        if (named) found = named.key;
      }
    }
  return found;
}

/**
 * Bookmaker où la personne dit avoir déposé : le premier nommé après le dernier mot du dépôt (« j'avais Celsius mais
 * j'ai déposé sur Betportal » → Betportal), sinon le dernier nommé. Null si aucun.
 */
export function depositBook(
  texts: readonly string[],
  books: readonly PersonaBookmakerInput[],
): string | null {
  const body = texts.map(norm).join(" \n ");
  const pos = bookPositions(body, books);
  if (pos.length === 0) return null;
  let word = -1;
  for (const m of body.matchAll(/\b(?:depose|depot|depo|deposit|deposited|mis|recharge|verse)\b/g))
    word = m.index ?? word;
  const after = word >= 0 ? pos.find((p) => p.at > word) : undefined;
  return (after ?? pos[pos.length - 1])!.key;
}

// ------------------------------------------------------------------
// Emojis
// ------------------------------------------------------------------

const EMOJI =
  "(?:[\\p{Extended_Pictographic}\\p{Emoji_Presentation}\\u{1F1E6}-\\u{1F1FF}](?:\\u{FE0F}|\\u{200D}|[\\u{1F3FB}-\\u{1F3FF}])*)+";
const HAS_EMOJI = new RegExp(EMOJI, "u");
/** Emoji collé à une virgule ou un point qui suit (« frero 😉, t la ») : retiré avec ses espaces. */
const EMOJI_BEFORE_PUNCT = new RegExp(`[ \\t]*${EMOJI}[ \\t]*(?=[,.;:])`, "gu");
const EMOJI_ANY = new RegExp(`[ \\t]*${EMOJI}[ \\t]*`, "gu");

/**
 * Texte sans emoji (le gérant du VIP n'en met jamais). Un texte sans emoji reste tel quel (ponctuation et espaces du
 * modèle gardés) ; sinon chaque emoji et ses espaces deviennent une seule espace.
 */
export function stripEmojis(text: string): string {
  if (!HAS_EMOJI.test(text)) return text;
  return text
    .replace(EMOJI_BEFORE_PUNCT, "")
    .replace(EMOJI_ANY, " ")
    .replace(/[\u{FE0F}\u{200D}]/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

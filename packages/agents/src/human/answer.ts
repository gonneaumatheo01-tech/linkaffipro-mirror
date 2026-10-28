/**
 * Interprétation PURE d'une réponse du client à une demande (`HumanRequest`), selon son type. Aucun accès base :
 * testé seul, partagé par Telegram et le site.
 */

import { HUMAN_ODDS_DONE, HUMAN_ODDS_UNAVAILABLE, isHumanOddsKey, isUnavailableText } from "../sports/human-odds-text";

export type HumanRequestKindName = "SECRET" | "TEXT" | "CHOICE" | "MEDIA" | "CONFIRM";

export type AnswerTarget = {
  kind: HumanRequestKindName;
  key: string;
  options?: string[];
  expected?: { count?: number; tags?: string[]; received?: number };
};

export type InterpretedAnswer =
  | { type: "skip" }
  | { type: "answer"; value: string; summary: string }
  | { type: "invalid"; message: string };

/** Minuscules, sans accents, espaces réduits, ponctuation finale retirée. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?…]+$/u, "")
    .trim();
}

const SKIP_WORDS = new Set(["plus tard", "plustard", "passe", "passer", "later", "skip"]);

export function isSkipText(text: string): boolean {
  const n = normalizeText(text).replace(/^["«»\s]+|["«»\s]+$/g, "");
  return SKIP_WORDS.has(n);
}

const YES = new Set(["oui", "o", "yes", "y", "ok", "d'accord", "daccord", "ouais", "oui oui", "👍", "✅"]);
const NO = new Set(["non", "n", "no", "nope", "pas question", "👎", "❌"]);

/** « oui » / « non » / null. */
export function parseYesNo(text: string): "oui" | "non" | null {
  const n = normalizeText(text);
  if (YES.has(n)) return "oui";
  if (NO.has(n)) return "non";
  return null;
}

/**
 * Confirmation stricte (« vrai <équipe> », changement de niveau) : exactement « oui » (casse, accents et ponctuation
 * finale ignorés). « ok », « o », « d'accord », un emoji ne suffisent pas.
 */
export function isStrictYes(text: string): boolean {
  return normalizeText(text).replace(/^["«»\s]+|["«»\s]+$/g, "") === "oui";
}

/**
 * Un texte ressemble-t-il à une clé (un seul mot de 16 caractères ou plus, lettres et chiffres mêlés) ? Sert à
 * reconnaître une clé collée SANS « répondre » au message de la question : « fait », « Parfait! » n'en sont pas.
 */
export function looksLikeSecretValue(text: string): boolean {
  const t = text.trim();
  return t.length >= 16 && !/\s/.test(t) && /\p{L}/u.test(t) && /\d/.test(t) && !/^https?:\/\//i.test(t);
}

/** Accusés courts (« fait », « merci », « ok », « c'est bon »…) : jamais une réponse ni un secret. */
const ACK_WORDS = new Set([
  "fait", "c'est fait", "cest fait", "merci", "merci beaucoup", "ok", "okay", "oki", "okk", "d'accord", "daccord", "dac",
  "c'est bon", "cest bon", "super", "parfait", "top", "nickel", "cool", "genial", "bien", "tres bien", "bien recu",
  "recu", "vu", "yes", "oui", "non", "ouais", "attends", "attend", "une seconde", "2 sec", "je regarde", "je cherche",
  "bravo", "trop bien", "lol", "mdr", "hello", "salut", "bonjour", "bonsoir", "coucou", "ca marche", "ça marche",
]);

/** Le texte n'est-il fait que d'emojis (et d'espaces) ? */
export function isEmojiOnly(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // Alternatives (et non une classe) : les modificateurs et liants d'emojis ne se combinent pas dans une classe.
  const rest = t.replace(/\p{Extended_Pictographic}|\p{Emoji_Modifier}|\uFE0F|\u200D|\u20E3|\s/gu, "");
  return rest === "" && /\p{Extended_Pictographic}/u.test(t);
}

/** Accusé court ou emojis seuls (pur) : « fait », « merci », « ok », « c'est bon », « super », « 👍🎉 ». */
export function isAckText(text: string): boolean {
  if (isEmojiOnly(text)) return true;
  const n = normalizeText(text).replace(/^["«»\s]+|["«»\s]+$/g, "").replace(/[\s\p{Extended_Pictographic}\u{FE0F}!.]+$/gu, "").trim();
  return ACK_WORDS.has(n);
}

/** Mots seuls qui sont des commandes du dialogue (jamais pris pour un secret collé). */
const SINGLE_WORD_COMMANDS = new Set(["agents", "agent", "demandes", "demande", "rapport", "rapports", "aide", "help", "menu", "commencer", "annule", "annuler", "stop", "/start", "/aide", "/help", "?"]);

/** Formes « c'est <valeur> », « voici <valeur> », « le voici : <valeur> » (2 ou 3 mots) : la valeur. */
const INTRO_VALUE = /^(?:c'est|c’est|voici|voila|voilà|tiens|la voici|le voici|la voila|le voila)\s*:?\s+(\S+)$/iu;
/** « mot de passe / mdp / password / pass / identifiant / login » puis la valeur (mots de liaison sautés). */
const HINT_HEAD = /(?<![\p{L}\p{N}])(?:mots?\s+de\s+passe|mdp|passwords?|pass|identifiants?|logins?)(?![\p{L}\p{N}])/giu;
const HINT_FILLERS = new Set(["c'est", "c’est", "cest", "est", "ce", "sera", "du", "de", "des", "d'", "pour", "le", "la", "les", "mon", "ma", "ton", "ta", "sur", "chez", "fal", "cotes", "odds", "magichour", "sportaza", "bookmaker", "bookmakers", "=", ":", "->", "→", "-", "–", "est-ce"]);

/**
 * Valeur d'un secret écrit en phrase (pur) : « le mot de passe c'est Sportaza2024! » → « Sportaza2024! », « mdp :
 * x » → « x ». Null si aucune valeur ne suit le mot repère.
 */
export function hintedSecretValue(text: string): string | null {
  HINT_HEAD.lastIndex = 0;
  let m: RegExpExecArray | null;
  let found: string | null = null;
  while ((m = HINT_HEAD.exec(text))) {
    const rest = text.slice(m.index + m[0].length).trim().split(/\s+/).filter(Boolean);
    const word = rest.find((w) => !HINT_FILLERS.has(w.toLowerCase().replace(/[:,;]+$/u, "")) && !/^[:;,.!?…=\-–—>→]+$/u.test(w));
    if (word && !/^(suivi|telegram)$/i.test(word.replace(/[^\p{L}]/gu, ""))) found = word.replace(/^[:=]+/, "");
  }
  return found;
}

/**
 * Valeur d'un secret envoyé SANS « répondre » pendant une demande SECRET en cours (y compris un identifiant `.login`
 * ou un mot de passe court) : le message EST le secret s'il tient en un mot (sauf accusé court, emojis seuls,
 * « plus tard » ou commande d'un mot), ou s'il l'annonce (« c'est X », « le mot de passe c'est X »). Une phrase
 * ordinaire (« voici des emojis 🎉🎉 », « mets le casino en pause ») n'en est pas un. Null sinon.
 */
export function secretValueOf(text: string): string | null {
  const t = text.trim();
  if (!t || isSkipText(t) || isAckText(t)) return null;
  if (!/\s/.test(t)) {
    if (SINGLE_WORD_COMMANDS.has(normalizeText(t))) return null;
    return t;
  }
  const intro = INTRO_VALUE.exec(t);
  if (intro && !isAckText(intro[1]!)) return intro[1]!;
  const hinted = hintedSecretValue(t);
  if (hinted) return hinted;
  // « voici la clé fal sk-… » : le seul long mot qui ressemble à une clé.
  const keys = t.split(/\s+/).filter((w) => looksLikeSecretValue(w));
  return keys.length === 1 ? keys[0]! : null;
}

/**
 * Une demande SECRET accepte-t-elle ce texte envoyé SANS « répondre » au message de la question ? Oui quand
 * `secretValueOf` y trouve une valeur (identifiant `.login` compris).
 */
export function secretAcceptsUnreplied(_key: string, text: string): boolean {
  return secretValueOf(text) !== null;
}

/** 4 derniers caractères d'un secret, jamais plus. */
export function last4(value: string): string {
  return value.slice(-4);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/** Adresse web valide (http/https, nom de domaine avec un point). */
export function isValidUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return (u.protocol === "https:" || u.protocol === "http:") && /\.[a-z]{2,}$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/** Dernier segment d'une clé (`persona.<id>.loraUrl` → `loraurl`) : un identifiant ne doit rien faire deviner. */
function keyTail(key: string): string {
  return (key.split(".").pop() ?? key).toLowerCase();
}

/** La demande ou la réponse porte-t-elle sur une adresse (web ou e-mail) ? */
function looksLikeAddress(key: string, text: string): "url" | "email" | null {
  const k = keyTail(key);
  if (/email|mail/.test(k) || (/^[^\s@]+@[^\s@]+$/.test(text) && !k.includes("login"))) return "email";
  if (/url|adresse|link|lien/.test(k) || /^https?:\/\//i.test(text) || /^www\./i.test(text)) return "url";
  return null;
}

/** Hôtes connus pour héberger des fichiers LoRA (phase 20) ; une autre adresse https est gardée avec un avertissement. */
export const LORA_KNOWN_HOSTS = [
  "huggingface.co",
  "hf.co",
  "fal.media",
  "fal.ai",
  "fal.run",
  "civitai.com",
  "storage.googleapis.com",
  "amazonaws.com",
  "r2.dev",
  "r2.cloudflarestorage.com",
  "replicate.delivery",
];

/** Adresse d'un fichier LoRA : https obligatoire ; `.safetensors` ou hôte connu = sûre, sinon gardée avec un doute. */
export function checkLoraUrl(raw: string): { ok: true; url: string; doubtful: boolean } | { ok: false; message: string } {
  const text = raw.trim().replace(/^<|>$/g, "");
  const url = /^www\./i.test(text) ? `https://${text}` : text;
  if (!isValidUrl(url)) return { ok: false, message: "Adresse invalide : envoie l'adresse complète du fichier LoRA (https://…)." };
  const u = new URL(url);
  if (u.protocol !== "https:") return { ok: false, message: "L'adresse du fichier LoRA doit commencer par https://." };
  const host = u.hostname.toLowerCase();
  const knownHost = LORA_KNOWN_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  const safetensors = /\.safetensors$/i.test(u.pathname);
  return { ok: true, url, doubtful: !knownHost && !safetensors };
}

/** Choix dont toutes les options sont des montants (« 50 € ») : un autre chiffre est accepté comme montant libre. */
function amountOptions(options: string[]): boolean {
  return options.length > 0 && options.every((o) => /^\d+(?:[.,]\d+)?\s?€$/.test(o.trim()));
}

/** « 75 », « 75 € », « 75 euros », « 75,5 » → 75 (ou 75,5) ; null sinon. */
export function parseEuroAmount(text: string): { euros: number; explicit: boolean } | null {
  const m = /^(\d{1,6}(?:[.,]\d{1,2})?)\s*(€|eur|euro|euros)?$/i.exec(normalizeText(text));
  if (!m) return null;
  const euros = Number(m[1]!.replace(",", "."));
  return Number.isFinite(euros) ? { euros, explicit: !!m[2] } : null;
}

function short(s: string, max = 80): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function interpretAnswer(target: AnswerTarget, raw: string): InterpretedAnswer {
  const text = raw.trim();
  if (isSkipText(text)) return { type: "skip" };
  switch (target.kind) {
    case "CHOICE": {
      const options = target.options ?? [];
      const n = normalizeText(text);
      const amount = amountOptions(options) ? parseEuroAmount(text) : null;
      // Montant libre (« 75 », « 120 € ») ; « 2 » seul reste le numéro d'une option.
      if (amount && (amount.explicit || amount.euros > options.length)) {
        const value = `${String(amount.euros).replace(".", ",")} €`;
        return { type: "answer", value, summary: value };
      }
      const num = /^(\d{1,2})$/.exec(n.replace(/[).]$/, ""));
      if (num) {
        const i = Number(num[1]);
        if (i >= 1 && i <= options.length) return { type: "answer", value: options[i - 1]!, summary: `${i}. ${short(options[i - 1]!)}` };
      }
      const idx = options.findIndex((o) => normalizeText(o) === n);
      if (idx >= 0) return { type: "answer", value: options[idx]!, summary: `${idx + 1}. ${short(options[idx]!)}` };
      return { type: "invalid", message: `Réponds par un numéro de 1 à ${options.length} (ou « plus tard »).` };
    }
    case "CONFIRM": {
      const yn = parseYesNo(text);
      if (!yn) return { type: "invalid", message: "Réponds oui ou non (ou « plus tard »)." };
      return { type: "answer", value: yn, summary: yn };
    }
    case "SECRET": {
      // Un identifiant de compte peut être court (« jean75 ») ; une clé ou un mot de passe, non.
      if (text.length < (/\.login$/.test(target.key) ? 3 : 8) || /\s/.test(text))
        return { type: "invalid", message: "Ça ne ressemble pas à une clé : colle-la en un seul morceau, sans espace." };
      // Jamais un morceau du secret dans le résumé (`HumanRequest.answerSummary`, `AuditLog`).
      return { type: "answer", value: text, summary: "enregistrée" };
    }
    case "MEDIA": {
      // Paris par capture (28 octobre 2026) : la demande se ferme seulement par le code (capture ET cote reçues, voir
      // `sports/human-odds.ts`) ou par « pas dispo » ; une cote seule ou un autre texte n'y suffit pas.
      if (isHumanOddsKey(target.key)) {
        if (normalizeText(text) === normalizeText(HUMAN_ODDS_DONE)) return { type: "answer", value: HUMAN_ODDS_DONE, summary: HUMAN_ODDS_DONE };
        if (isUnavailableText(text)) return { type: "answer", value: HUMAN_ODDS_UNAVAILABLE, summary: HUMAN_ODDS_UNAVAILABLE };
        return { type: "invalid", message: "Envoie la capture du pari avec la cote en légende (ex. 1,85), ou réponds « pas dispo »." };
      }
      const need = target.expected?.count ?? 1;
      const got = target.expected?.received ?? 0;
      const tags = (target.expected?.tags ?? []).map((t) => `#${t.replace(/^#/, "")}`).join(" ");
      return {
        type: "invalid",
        message: `Envoie-moi les médias avec la légende ${tags || "demandée"} (${got}/${need} reçus), ou réponds « plus tard ».`,
      };
    }
    case "TEXT": {
      if (!text) return { type: "invalid", message: "Réponse vide : écris ta réponse en un message." };
      if (keyTail(target.key) === "loraurl") {
        const lora = checkLoraUrl(text);
        if (!lora.ok) return { type: "invalid", message: lora.message };
        return { type: "answer", value: lora.url, summary: short(lora.url) };
      }
      const addr = looksLikeAddress(target.key, text);
      if (addr === "email" && !EMAIL.test(text))
        return { type: "invalid", message: "Adresse e-mail invalide : vérifie-la et renvoie-la." };
      if (addr === "url") {
        const url = /^www\./i.test(text) ? `https://${text}` : text;
        if (!isValidUrl(url)) return { type: "invalid", message: "Adresse invalide : envoie une adresse complète (https://…)." };
        return { type: "answer", value: url, summary: short(url) };
      }
      return { type: "answer", value: text, summary: short(text) };
    }
  }
}

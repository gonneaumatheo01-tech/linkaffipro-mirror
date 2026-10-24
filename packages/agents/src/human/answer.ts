/**
 * Interprétation PURE d'une réponse du client à une demande (`HumanRequest`), selon son type. Aucun accès base :
 * testé seul, partagé par Telegram et le site.
 */

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

/**
 * Une demande SECRET accepte-t-elle ce texte envoyé SANS « répondre » au message de la question ? Identifiant de
 * compte (`.login`) : jamais (seulement en réponse au message). Autre clé : seulement s'il ressemble à une clé.
 */
export function secretAcceptsUnreplied(key: string, text: string): boolean {
  if (/\.login$/.test(key)) return false;
  return looksLikeSecretValue(text);
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

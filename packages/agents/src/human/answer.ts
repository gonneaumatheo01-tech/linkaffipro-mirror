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

/** La demande ou la réponse porte-t-elle sur une adresse (web ou e-mail) ? */
function looksLikeAddress(key: string, text: string): "url" | "email" | null {
  const k = key.toLowerCase();
  if (/email|mail/.test(k) || (/^[^\s@]+@[^\s@]+$/.test(text) && !k.includes("login"))) return "email";
  if (/url|adresse|link|lien/.test(k) || /^https?:\/\//i.test(text) || /^www\./i.test(text)) return "url";
  return null;
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
      if (text.length < 8 || /\s/.test(text))
        return { type: "invalid", message: "Ça ne ressemble pas à une clé : colle-la en un seul morceau, sans espace." };
      return { type: "answer", value: text, summary: `…${last4(text)}` };
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

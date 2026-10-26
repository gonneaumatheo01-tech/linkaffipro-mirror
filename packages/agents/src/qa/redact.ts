/**
 * Phase 30 — masquage du QA Global et empreinte du contenu. Fonctions pures.
 *
 * `redactForQa(value)` : copie du contenu (jamais l'original modifié) où jetons Telegram, clés (`sk-…`, GitHub, AWS,
 * Google, Slack), `Bearer …`, JWT, mots de passe, courriels, téléphones, IBAN, numéros de carte et identifiants internes
 * longs sont remplacés par « [masqué] ». C'est cette copie qui part au modèle et qui est gardée dans `QaCheck.content`.
 * `redactDetailed(value)` rend aussi ce qui a été trouvé DANS LE TEXTE (types seulement, jamais les valeurs) : le QA en
 * fait un refus `SENSITIVE_DATA` appliqué par le code. Les champs techniques (`…Id`, `…Ids`, `id`) et les champs dont le
 * nom désigne un secret sont masqués sans compter comme une fuite (ils ne sont pas montrés au public).
 *
 * `contentHash(content)` : JSON canonique (clés triées, `undefined` retiré, dates en ISO, entiers longs en texte) →
 * SHA-256 hexadécimal, sur le contenu RÉEL (non masqué) : la moindre modification annule l'approbation.
 */
import { createHash } from "node:crypto";

export const REDACTED = "[masqué]";

export type RedactionKind =
  | "telegram_token"
  | "api_key"
  | "bearer"
  | "jwt"
  | "password"
  | "email"
  | "phone"
  | "iban"
  | "card"
  | "url_secret"
  | "internal_id";

type Pattern = { kind: RedactionKind; re: RegExp; /** Garde le groupe 1 (libellé) et masque le reste. */ keepLabel?: boolean; test?: (m: string) => boolean };

const hasDigit = (s: string) => /\d/.test(s);
const hasLetter = (s: string) => /[A-Za-z]/.test(s);

/** Somme de Luhn (numéros de carte). */
function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** Ordre important : du plus précis au plus général. */
const PATTERNS: Pattern[] = [
  // Jeton de bot Telegram : « 123456789:AA…35 caractères ».
  { kind: "telegram_token", re: /(?<![A-Za-z0-9])\d{6,12}:[A-Za-z0-9_-]{30,}(?![A-Za-z0-9_-])/g },
  // JWT (trois parties base64url).
  { kind: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  // En-tête Authorization.
  { kind: "bearer", re: /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, keepLabel: true },
  // Clés d'API connues.
  { kind: "api_key", re: /(?<![A-Za-z0-9])(?:sk|pk|rk)[-_](?:ant-|live_|test_|proj-)?[A-Za-z0-9_-]{12,}/g },
  { kind: "api_key", re: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{16,}/g },
  { kind: "api_key", re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { kind: "api_key", re: /\bAIza[A-Za-z0-9_-]{30,}/g },
  { kind: "api_key", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  // Secret dans une adresse (`?token=…`, `&key=…`, `&password=…`, `&sig=…`).
  {
    kind: "url_secret",
    re: /([?&](?:token|access_token|refresh_token|api_?key|key|secret|password|passwd|pwd|sig|signature|auth|session)=)[^&#\s"'<>]+/gi,
    keepLabel: true,
  },
  // Mot de passe écrit en clair : « mot de passe : xxx », « password=xxx », « mdp → xxx » (séparateur obligatoire).
  {
    kind: "password",
    re: /((?:mots?\s+de\s+passe|password|passwd|passcode|pwd|mdp|code\s+secret)\s*(?::|=|->|→)\s*)["'«]?\s*[^\s"'»,;<]{3,}/gi,
    keepLabel: true,
  },
  // Courriel.
  { kind: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}/g },
  // IBAN (2 lettres, 2 chiffres, 11 à 30 caractères, espaces tolérés par groupes de 4).
  { kind: "iban", re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g, test: (m) => m.replace(/\s/g, "").length >= 15 && hasDigit(m.slice(4)) },
  // Carte bancaire (13 à 19 chiffres, Luhn).
  { kind: "card", re: /(?<![\d.,])(?:\d[ -]?){12,18}\d(?![\d.,])/g, test: (m) => luhn(m.replace(/\D/g, "")) && m.replace(/\D/g, "").length >= 13 },
  // Téléphone international (+33 6 12 34 56 78, +44 20 7946 0958) ou français (06 12 34 56 78, 0612345678).
  { kind: "phone", re: /(?<![\w+])\+\d{1,3}(?:[ .-]?\(?\d{1,4}\)?){2,5}(?![\d])/g, test: (m) => m.replace(/\D/g, "").length >= 9 },
  { kind: "phone", re: /(?<![\d.,])0[1-9](?:[ .-]?\d{2}){4}(?![\d.,])/g },
  // Identifiants internes longs : cuid, UUID, hexadécimal ≥ 32, suite de lettres et chiffres ≥ 32, identifiant
  // Telegram de groupe (-100…), nombre ≥ 10 chiffres d'un seul tenant (identifiant d'utilisateur Telegram).
  { kind: "internal_id", re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi },
  { kind: "internal_id", re: /(?<![A-Za-z0-9])c[a-z0-9]{24}(?![A-Za-z0-9])/g, test: hasDigit },
  { kind: "internal_id", re: /(?<![A-Za-z0-9])[A-Za-z0-9]{32,}(?![A-Za-z0-9])/g, test: (m) => hasDigit(m) && hasLetter(m) },
  { kind: "internal_id", re: /(?<![\d.,])-100\d{8,}(?![\d.,])/g },
  { kind: "internal_id", re: /(?<![\d.,-])\d{10,}(?![\d.,])/g },
];

/** Nom de champ qui désigne un secret : valeur masquée entière, et compte comme une fuite. */
const SECRET_KEY = /^(?:password|passwd|pwd|mdp|motdepasse|secret|clientsecret|token|accesstoken|refreshtoken|bottoken|apikey|apikeyencrypted|authorization|cookie|cookies|credentials?|session|sessionstring|privatekey|iban)$/;
/** Nom de champ technique (identifiant interne) : valeur masquée sans compter comme une fuite. */
const ID_KEY = /^(?:id|ids|.+Id|.+Ids|.+_id|.+_ids)$/;

const normKey = (k: string) => k.replace(/[-_\s]/g, "").toLowerCase();

export type RedactionResult<T> = { value: T; found: RedactionKind[] };

/** Masque un texte ; rend aussi les types trouvés (sans les valeurs). */
export function redactText(text: string): { text: string; found: RedactionKind[] } {
  const found = new Set<RedactionKind>();
  let out = text;
  for (const p of PATTERNS) {
    out = out.replace(p.re, (m: string, label?: unknown) => {
      if (p.test && !p.test(m)) return m;
      found.add(p.kind);
      return p.keepLabel && typeof label === "string" ? `${label}${REDACTED}` : REDACTED;
    });
  }
  return { text: out, found: [...found] };
}

/** Copie masquée d'une valeur JSON quelconque (l'original n'est jamais modifié) + types trouvés dans le texte. */
export function redactDetailed<T>(value: T): RedactionResult<T> {
  const found = new Set<RedactionKind>();
  const seen = new WeakSet<object>();
  const walk = (v: unknown, key: string | null): unknown => {
    if (key !== null) {
      const nk = normKey(key);
      if (SECRET_KEY.test(nk) && v !== null && v !== undefined && v !== "" && typeof v !== "boolean") {
        found.add(nk.includes("iban") ? "iban" : "password");
        return REDACTED;
      }
      if (ID_KEY.test(key) && (typeof v === "string" || typeof v === "number" || typeof v === "bigint")) return REDACTED;
      if (ID_KEY.test(key) && Array.isArray(v)) return v.map(() => REDACTED);
    }
    if (typeof v === "string") {
      const r = redactText(v);
      for (const k of r.found) found.add(k);
      return r.text;
    }
    if (typeof v === "bigint") return walk(v.toString(), null);
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
    if (Array.isArray(v)) {
      if (seen.has(v)) return null;
      seen.add(v);
      return v.map((x) => walk(x, null));
    }
    if (v && typeof v === "object") {
      if (seen.has(v)) return null;
      seen.add(v);
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (x === undefined || typeof x === "function") continue;
        out[k] = walk(x, k);
      }
      return out;
    }
    return v;
  };
  return { value: walk(value, null) as T, found: [...found] };
}

/** Copie masquée (voir `redactDetailed`). */
export function redactForQa<T>(value: T): T {
  return redactDetailed(value).value;
}

/** JSON canonique : clés triées, `undefined` et fonctions retirés, dates en ISO, entiers longs en texte. */
export function canonicalJson(value: unknown): string {
  const seen = new WeakSet<object>();
  const norm = (v: unknown): unknown => {
    if (v === undefined || typeof v === "function" || typeof v === "symbol") return undefined;
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
    if (ArrayBuffer.isView(v)) return Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");
    if (Array.isArray(v)) {
      if (seen.has(v)) throw new Error("Contenu circulaire.");
      seen.add(v);
      const arr = v.map((x) => {
        const n = norm(x);
        return n === undefined ? null : n;
      });
      seen.delete(v);
      return arr;
    }
    if (v && typeof v === "object") {
      if (seen.has(v)) throw new Error("Contenu circulaire.");
      seen.add(v);
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        const n = norm((v as Record<string, unknown>)[k]);
        if (n !== undefined) out[k] = n;
      }
      seen.delete(v);
      return out;
    }
    return v;
  };
  return JSON.stringify(norm(value) ?? null);
}

/** Empreinte SHA-256 (hexadécimal) du contenu exact. */
export function contentHash(content: unknown): string {
  return createHash("sha256").update(canonicalJson(content)).digest("hex");
}

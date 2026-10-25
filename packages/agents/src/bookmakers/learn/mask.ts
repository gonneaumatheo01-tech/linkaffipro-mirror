/**
 * Phase 35 (chantier B, règle 7) — MASQUAGE d'un enregistrement avant tout stockage ou envoi à l'IA. Remplace par
 * « [secret] », PARTOUT (adresses, paramètres, en-têtes, corps, HTML, texte, cotes lues) :
 * - les valeurs connues (identifiant, mot de passe, jetons et cookies de la session), aussi sous forme encodée ;
 * - les valeurs des en-têtes d'authentification et de session (le NOM de l'en-tête est gardé) ;
 * - les paramètres et champs JSON dont le nom parle de jeton, session, mot de passe, email, compte, solde ;
 * - les motifs : jetons JWT, « Bearer … », emails, longues suites hexadécimales ou base64, numéros de compte, IBAN ;
 * - les montants du solde du joueur (champ de solde, « Solde : 123,45 € »).
 * Les noms d'équipes, de marchés et les cotes restent intacts (ce ne sont pas des secrets). Pur.
 */
import type { RecordedPage, RecordedResponse, SiteRecording } from "../contract";

export const SECRET_MARK = "[secret]";

const SECRET_KEY = /(^|[_-])(token|access[_-]?token|refresh[_-]?token|id[_-]?token|jwt|auth|authorization|session|sess|sid|ssid|cookie|csrf|xsrf|password|passwd|pwd|pass|secret|api[_-]?key|apikey|signature|sig|otp|pin|email|e[_-]?mail|login|username|user[_-]?name|phone|iban|card)([_-]|$)|^(token|jwt|sessionid|session_id|accesstoken|refreshtoken|idtoken|authtoken|email|password|username|login|phone|iban)$/i;
const ACCOUNT_KEY = /^(account|account[_-]?(no|num|number|id)|accountnumber|accountid|player[_-]?id|playerid|user[_-]?id|userid|customer[_-]?(id|number)|customerid|client[_-]?id|wallet[_-]?id|iban)$/i;
const BALANCE_KEY = /^(balance|balances|solde|saldo|cash|funds|wallet|real[_-]?balance|bonus[_-]?balance|bonusbalance|available[_-]?balance|withdrawable|amount[_-]?available|main[_-]?balance)$/i;

const SECRET_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie)$|token|auth|session|csrf|xsrf|secret|api-?key|sign|jwt|sid/i;

// Motifs (sans valeur connue). Ordre : du plus précis au plus large.
const PATTERNS: RegExp[] = [
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g, // JWT
  /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/g,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, // email
  /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}\b/g, // IBAN
  /\b[0-9a-f]{32,}\b/gi, // longue suite hexadécimale
  /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[A-Z])[A-Za-z0-9_-]{40,}\b/g, // longue suite base64
];

// Solde affiché (« Solde : 123,45 € », « Balance: €12.00 ») et numéro de compte affiché (« Compte CEL-00012345 »).
const SHOWN_BALANCE = /\b(solde|balance|saldo|guthaben|bonus)(\s*(?:disponible|available|réel|reel|bonus)?\s*[:：]?\s*)([€$£]\s?)?\d[\d\s.,]*(\s?(?:€|eur|usd|\$|£|gbp))?/gi;
const SHOWN_ACCOUNT = /\b(compte|account|n°\s*client|client|player id|id joueur|customer)(\s*(?:n°|no\.?|number|#|id)?\s*[:：]?\s*)([A-Z]{0,4}-?\d{5,})/gi;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Formes d'une valeur connue (telle quelle, encodée pour une adresse, échappée pour du JSON). */
function forms(v: string): string[] {
  const out = new Set<string>([v]);
  try {
    out.add(encodeURIComponent(v));
    out.add(encodeURIComponent(v).replace(/%20/g, "+"));
  } catch {
    /* valeur non encodable */
  }
  out.add(JSON.stringify(v).slice(1, -1));
  return [...out].filter((x) => x.length >= 3);
}

export type MaskOptions = {
  /** Valeurs connues à retirer partout (identifiant, mot de passe, jetons, cookies). */
  secrets?: readonly string[];
};

type Masker = { text(s: string): string; known: Set<string> };

function createMasker(secrets: readonly string[]): Masker {
  const known = new Set<string>();
  for (const s of secrets) if (typeof s === "string" && s.trim().length >= 3) for (const f of forms(s.trim())) known.add(f);
  const text = (s: string): string => {
    if (!s) return s;
    let out = s;
    // Les plus longues d'abord (un jeton qui contient l'identifiant reste masqué d'un bloc).
    for (const k of [...known].sort((a, b) => b.length - a.length)) if (out.includes(k)) out = out.split(k).join(SECRET_MARK);
    for (const re of PATTERNS) out = out.replace(re, SECRET_MARK);
    out = out.replace(SHOWN_BALANCE, (_m, label: string, sep: string) => `${label}${sep}${SECRET_MARK}`);
    out = out.replace(SHOWN_ACCOUNT, (_m, label: string, sep: string) => `${label}${sep}${SECRET_MARK}`);
    return out;
  };
  return { text, known };
}

/** Objet JSON : champs secrets, de compte et de solde remplacés ; chaînes passées au masque. */
function maskJsonValue(v: unknown, m: Masker, key: string | null): unknown {
  if (key && (SECRET_KEY.test(key) || ACCOUNT_KEY.test(key) || BALANCE_KEY.test(key))) {
    if (v === null || v === undefined || typeof v === "boolean") return v;
    if (typeof v === "string" || typeof v === "number") {
      if (typeof v === "number" || typeof v === "string") rememberAmount(m, v);
      return SECRET_MARK;
    }
    return SECRET_MARK;
  }
  if (typeof v === "string") return m.text(v);
  if (Array.isArray(v)) return v.map((x) => maskJsonValue(x, m, null));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, maskJsonValue(x, m, k)]));
  return v;
}

/** Un montant de solde vu dans une réponse est aussi retiré du texte affiché (« 123,45 € »). */
function rememberAmount(m: Masker, v: string | number): void {
  const s = String(v).trim();
  if (s.length < 3) return;
  m.known.add(s);
  if (typeof v === "number" || /^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n) && n >= 10) for (const f of [n.toFixed(2), n.toFixed(2).replace(".", ",")]) m.known.add(f);
  }
}

function maskBody(body: string, m: Masker): string {
  const t = body.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return JSON.stringify(maskJsonValue(JSON.parse(t) as unknown, m, null));
    } catch {
      /* JSON tronqué : masque par motifs de champ */
    }
  }
  // Champs « clé: valeur » d'un JSON tronqué ou d'un formulaire (`email=…&password=…`).
  let out = body.replace(/("([A-Za-z0-9_-]{2,40})"\s*:\s*)("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?)/g, (all, pre: string, k: string, val: string) => {
    if (SECRET_KEY.test(k) || ACCOUNT_KEY.test(k) || BALANCE_KEY.test(k)) {
      rememberAmount(m, val.replace(/^"|"$/g, ""));
      return `${pre}"${SECRET_MARK}"`;
    }
    return all;
  });
  out = out.replace(/(^|[&?])([A-Za-z0-9_.-]{2,40})=([^&]*)/g, (all, sep: string, k: string) => (SECRET_KEY.test(k) || ACCOUNT_KEY.test(k) ? `${sep}${k}=${SECRET_MARK}` : all));
  return m.text(out);
}

function maskUrl(url: string, m: Masker): string {
  let out = url;
  try {
    const u = new URL(url);
    let touched = false;
    for (const [k] of [...u.searchParams]) {
      if (SECRET_KEY.test(k) || ACCOUNT_KEY.test(k)) {
        u.searchParams.set(k, SECRET_MARK);
        touched = true;
      }
    }
    if (touched) out = u.toString().replace(/%5Bsecret%5D/g, SECRET_MARK);
  } catch {
    /* adresse illisible : masque texte seulement */
  }
  return m.text(out);
}

function maskResponse(r: RecordedResponse, m: Masker): RecordedResponse {
  const query = r.query ? Object.fromEntries(Object.entries(r.query).map(([k, v]) => [k, SECRET_KEY.test(k) || ACCOUNT_KEY.test(k) ? SECRET_MARK : m.text(v)])) : undefined;
  const headers = r.requestHeaders ? Object.fromEntries(Object.entries(r.requestHeaders).map(([k, v]) => [k, SECRET_HEADER.test(k) ? SECRET_MARK : m.text(v)])) : undefined;
  return {
    ...r,
    url: maskUrl(r.url, m),
    ...(query ? { query } : {}),
    ...(headers ? { requestHeaders: headers } : {}),
    requestBody: r.requestBody ? maskBody(r.requestBody, m) : (r.requestBody ?? null),
    body: maskBody(r.body, m),
  };
}

function maskHtml(html: string, m: Masker): string {
  // Valeurs d'attributs de champs (au cas où) et attributs de données sensibles.
  const cleaned = html
    .replace(/(<(?:input|textarea|select)\b[^>]*?\s)value\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, `$1value="${SECRET_MARK}"`)
    .replace(/(\sdata-[a-z0-9-]*(?:token|session|email|balance|account|user)[a-z0-9-]*\s*=\s*)("[^"]*"|'[^']*')/gi, `$1"${SECRET_MARK}"`);
  return m.text(cleaned);
}

function maskPage(p: RecordedPage, m: Masker): RecordedPage {
  return { ...p, url: maskUrl(p.url, m), html: maskHtml(p.html, m), text: m.text(p.text) };
}

/**
 * Enregistrement sans aucun secret. Les réponses d'abord (elles révèlent les jetons et le solde, retirés ensuite aussi
 * des pages et du texte), puis les pages, les cotes lues et l'adresse de départ.
 */
export function maskRecording(rec: SiteRecording, secrets: readonly string[] | MaskOptions = []): SiteRecording {
  const list = Array.isArray(secrets) ? secrets : ((secrets as MaskOptions).secrets ?? []);
  const m = createMasker(list);
  // Jetons et cookies vus dans les en-têtes de requête : valeurs connues pour la suite.
  for (const r of rec.responses)
    for (const [k, v] of Object.entries(r.requestHeaders ?? {})) {
      if (!SECRET_HEADER.test(k) || !v || v === SECRET_MARK) continue;
      for (const part of v.split(/;\s*|\s+/)) {
        const val = part.includes("=") ? part.slice(part.indexOf("=") + 1) : part;
        if (val.length >= 8 && !/^(bearer|basic|token)$/i.test(val)) m.known.add(val);
      }
    }
  const responses = rec.responses.map((r) => maskResponse(r, m));
  const pages = rec.pages.map((p) => maskPage(p, m));
  return {
    ...rec,
    baseUrl: maskUrl(rec.baseUrl, m),
    responses,
    pages,
    pageOdds: rec.pageOdds.map((o) => ({ ...o, eventLabel: m.text(o.eventLabel), market: m.text(o.market), selection: m.text(o.selection) })),
  };
}

/** Contrôle : un des secrets connus ou un motif de jeton survit-il dans ce texte ? (tests, relecture). Pur. */
export function leakedSecrets(serialized: string, secrets: readonly string[]): string[] {
  const out: string[] = [];
  for (const s of secrets) if (s && s.length >= 3 && forms(s).some((f) => serialized.includes(f))) out.push(`valeur connue (${s.length} caractères)`);
  for (const re of PATTERNS.slice(0, 3)) {
    const hit = serialized.match(new RegExp(re.source, re.flags));
    if (hit?.length) out.push(`motif ${re.source.slice(0, 20)}…`);
  }
  return out;
}

export const _maskInternals = { escapeRe };

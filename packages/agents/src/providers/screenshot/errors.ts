/**
 * Classement des erreurs de capture (phase 23) et parade à suivre. Règles pures : le texte et l'adresse de la page
 * suffisent à reconnaître un captcha, une double authentification ou un blocage géographique, en plusieurs langues.
 */
import type { CaptureErrorKind, CaptureResult } from "../screenshot";

export class CaptureError extends Error {
  readonly kind: CaptureErrorKind;
  constructor(kind: CaptureErrorKind, message: string) {
    super(message);
    this.name = "CaptureError";
    this.kind = kind;
  }
}

export const CAPTURE_ERROR_LABELS: Record<CaptureErrorKind, string> = {
  login_failed: "connexion refusée",
  captcha: "le site demande de prouver qu'on n'est pas un robot",
  two_factor: "le site demande un code de vérification",
  geo_blocked: "site bloqué depuis le pays du serveur",
  not_found: "match introuvable sur le site",
  market_missing: "marché ou sélection absents",
  timeout: "le site met trop de temps à répondre",
  forbidden_action: "action interdite refusée (jamais de mise)",
  unknown: "erreur inconnue",
};

// Marqueurs de page (texte visible, titre, adresse, cadres). Minuscules, sans accents (voir `fold`).
const CAPTCHA_PATTERNS = [
  /\bcaptcha\b/,
  /recaptcha|hcaptcha|turnstile|challenges\.cloudflare\.com|cf-chl|cf_chl/,
  /verify (that )?you are (a )?human|are you a robot|i'?m not a robot|je ne suis pas un robot/,
  /verifiez que vous etes (un )?humain|verification de securite|security check|checking your browser/,
  /just a moment|un instant\.\.\.|attention required|access denied.*bot|ddos protection/,
];
const GEO_PATTERNS = [
  /not available in your (country|region|location|jurisdiction)/,
  /(pas|non) disponible dans votre (pays|region)/,
  /restricted (country|territory|jurisdiction|region)|territoire (non autorise|restreint)/,
  /access from your (country|location|region) is (not allowed|restricted|blocked)/,
  /we (do not|don'?t) accept (players|customers) from your (country|location)/,
  /no (esta )?disponible en (tu|su) pais|nicht in (ihrem|deinem) land verfugbar/,
  /your (ip|location) (address )?(is )?(blocked|restricted)|votre (pays|adresse ip) (est )?(bloque|restreint)/,
  /geo-?block|geo-?restrict/,
];
const TWO_FACTOR_PATTERNS = [
  /two[- ]factor|2fa\b|authenticator|double authentification|authentification a deux facteurs/,
  /(verification|security|confirmation|one[- ]time) code|code de (verification|securite|confirmation)/,
  /(enter|saisissez|entrez) (the )?(le )?code (sent|envoye|recu)|code (envoye|sent) (par|by|to) (sms|e-?mail)/,
  /one-time-code/,
];
const LOGIN_FAILED_PATTERNS = [
  /(incorrect|invalid|wrong) (password|username|email|credentials|login)/,
  /(mot de passe|identifiant|e-?mail|identifiants) (incorrect|invalide|errone)s?/,
  /login failed|echec de (la )?connexion|connexion (impossible|refusee)/,
  /account (is )?(locked|blocked|suspended)|compte (bloque|suspendu|verrouille)/,
];

/** Minuscules sans accents, espaces réduits : les motifs s'écrivent une seule fois. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export type PageSignals = {
  /** Texte visible (tronqué par l'appelant). */
  text: string;
  title?: string;
  url?: string;
  /** Adresses des cadres (`iframe src`) et attributs utiles (`autocomplete`). */
  frames?: string[];
  attributes?: string[];
  /** Statut HTTP de la dernière navigation. */
  status?: number | null;
};

/**
 * Pur : la page affichée est-elle un obstacle (captcha, blocage géographique, et, seulement juste après l'envoi du
 * formulaire de connexion, double authentification : un lien « recevoir un code » existe sur bien des pages normales) ?
 */
export function detectPageObstacle(p: PageSignals, opts: { afterLogin?: boolean } = {}): CaptureErrorKind | null {
  const hay = fold([p.title ?? "", p.text, p.url ?? "", ...(p.frames ?? []), ...(p.attributes ?? [])].join(" \n "));
  if (p.status === 451) return "geo_blocked";
  if (GEO_PATTERNS.some((r) => r.test(hay))) return "geo_blocked";
  if (CAPTCHA_PATTERNS.some((r) => r.test(hay))) return "captcha";
  if (opts.afterLogin && TWO_FACTOR_PATTERNS.some((r) => r.test(hay))) return "two_factor";
  return null;
}

/** Pur : le texte affiché après l'envoi du formulaire dit-il que la connexion est refusée ? */
export function looksLikeLoginFailure(text: string): boolean {
  const hay = fold(text);
  return LOGIN_FAILED_PATTERNS.some((r) => r.test(hay));
}

/** Toute erreur levée pendant une capture → résultat classé (jamais de secret dans le message). */
export function classifyCaptureError(err: unknown): CaptureResult & { ok: false } {
  if (err instanceof CaptureError) return { ok: false, kind: err.kind, message: err.message.slice(0, 300) };
  const e = err as { name?: string; message?: string } | null;
  const msg = String(e?.message ?? err ?? "").slice(0, 300);
  if (e?.name === "TimeoutError" || /timeout|timed out|delai depasse/i.test(msg)) return { ok: false, kind: "timeout", message: "délai dépassé sur le site du bookmaker" };
  if (/net::ERR_(NAME_NOT_RESOLVED|CONNECTION_REFUSED|CONNECTION_RESET|TUNNEL|PROXY)/.test(msg))
    return { ok: false, kind: "timeout", message: `site injoignable (${/net::ERR_[A-Z_]+/.exec(msg)?.[0] ?? "réseau"})` };
  return { ok: false, kind: "unknown", message: msg || "erreur inconnue" };
}

/**
 * Parade à suivre après un échec (ordre du plan, section « Risques ») :
 * - `proxy_or_mac` : le site refuse le serveur (robot ou pays) → demander au client « adresse IP résidentielle ou Mac » ;
 * - `fix_credentials` : identifiants refusés ou code de vérification → demander de les corriger / désactiver le code ;
 * - `retry` : passage suivant (délai, verrou pris) ;
 * - `fallback` : rien à corriger chez nous (match ou marché absents) → image de repli si le pari est gardé ;
 * - `refuse` : action interdite → bug d'adaptateur, jamais réessayé tel quel.
 */
export type CaptureParade = "proxy_or_mac" | "fix_credentials" | "retry" | "fallback" | "refuse";

export function captureParade(result: CaptureResult): CaptureParade | null {
  if (result.ok) return null;
  switch (result.kind) {
    case "captcha":
    case "geo_blocked":
      return "proxy_or_mac";
    case "login_failed":
    case "two_factor":
      return "fix_credentials";
    case "timeout":
      return "retry";
    case "forbidden_action":
      return "refuse";
    default:
      return "fallback";
  }
}

/** Le site bloque-t-il le serveur (question « adresse IP résidentielle ou capture depuis le Mac ») ? */
export function captureBlocked(result: CaptureResult): boolean {
  return captureParade(result) === "proxy_or_mac";
}

/** Phrase courte pour le client (Telegram, site). */
export function captureResultText(result: CaptureResult): string {
  if (result.ok) return `capture réussie (cote lue ${result.readOdds.toLocaleString("fr-FR")})`;
  return `${CAPTURE_ERROR_LABELS[result.kind]}${result.message && result.message !== CAPTURE_ERROR_LABELS[result.kind] ? ` : ${result.message}` : ""}`;
}

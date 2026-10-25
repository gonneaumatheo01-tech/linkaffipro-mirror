/**
 * Phase 35 : obstacles d'une page ou d'une réponse lue (règles du code, avant toute IA). Réutilise `detectPageObstacle`
 * de la phase 23 (géo-blocage, captcha, code à deux facteurs) et ajoute : maintenance, refus du serveur (pare-feu,
 * « access denied »), déconnecté (renvoi vers la connexion, 401), page vide.
 * Les noms rendus sont ceux de `PageDiagnosis` (contrat), plus `server_refused`.
 */
import { detectPageObstacle, fold, type PageSignals } from "../../providers/screenshot/errors";

export type ReadObstacle = "geo_blocked" | "captcha" | "two_factor" | "maintenance" | "server_refused" | "logged_out" | "empty";

const MAINTENANCE = [
  /\b(en|under|scheduled|temporary) maintenance\b|\bmaintenance (en cours|in progress|programmee|planifiee)\b/,
  /site (est )?(temporairement )?(indisponible|ferme)|temporarily (unavailable|down)|we'?ll be back( soon)?|nous revenons (tres )?(vite|bientot)/,
  /\b(503|502) (service unavailable|bad gateway)\b/,
];
const REFUSED = [
  /\baccess denied\b|\bacces (refuse|interdit)\b|\berror (code )?10(0[5-9]|1\d|20)\b|you have been blocked|request (was )?blocked|vous avez ete bloque/,
  /\b403 forbidden\b|\bforbidden\b.*\b(nginx|cloudflare|akamai|incapsula|imperva)\b|\bsorry, you have been blocked\b/,
];
const LOGGED_OUT = [/\b(votre )?session (a )?expire|session (has )?expired|veuillez vous (re)?connecter|please (log|sign) in again\b/];

/** Le serveur nous a-t-il renvoyés vers une page de connexion alors qu'on demandait autre chose ? */
function redirectedToLogin(requested: string | undefined, landed: string | undefined): boolean {
  if (!requested || !landed) return false;
  const isLogin = (u: string) => /\/(login|signin|sign-in|connexion|auth)(\/|\?|#|$)|[?&#](modal|popup|dialog)=(login|signin)/i.test(u);
  return isLogin(landed) && !isLogin(requested);
}

/** Pur : obstacle sur une page affichée (ou réponse HTML) ; null si la page semble normale. */
export function detectReadObstacle(
  p: PageSignals & { requestedUrl?: string; htmlLength?: number },
  opts: { afterLogin?: boolean } = {},
): ReadObstacle | null {
  const base = detectPageObstacle(p, opts);
  if (base === "geo_blocked" || base === "captcha" || base === "two_factor") return base;
  const hay = fold([p.title ?? "", p.text].join(" \n "));
  if (p.status === 503 || MAINTENANCE.some((r) => r.test(hay))) return "maintenance";
  if (p.status === 403 || REFUSED.some((r) => r.test(hay))) return "server_refused";
  if (p.status === 401 || redirectedToLogin(p.requestedUrl, p.url) || LOGGED_OUT.some((r) => r.test(hay))) return "logged_out";
  if (hay.replace(/\s+/g, "").length < 20 && (p.htmlLength ?? 0) < 2_000) return "empty";
  return null;
}

/** Obstacles qui demandent la main d'un humain (navigateur visible sur le Mac). */
export const HUMAN_OBSTACLES: ReadonlySet<string> = new Set(["captcha", "two_factor", "password_refused"]);
/** Obstacles qui, vus depuis le serveur, font basculer la lecture sur le Mac (mode `auto`). */
export const SWITCH_TO_MAC_OBSTACLES: ReadonlySet<string> = new Set(["geo_blocked", "server_refused", "captcha"]);

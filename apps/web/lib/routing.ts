import { isTrackingHost } from "@linkaffipro/core";

/**
 * Chemins accessibles sans session (volontairement publics) :
 * - `/login` : page de connexion ;
 * - `/invite/<token>` : acceptation d'une invitation (jeton unique, expire après 7 jours) ;
 * - `/api/health` : contrôle de santé Railway ;
 * - `/api/telegram/<botId>` : webhooks Telegram (secret par bot vérifié dans la route) ;
 * - `/api/auth/*` : Auth.js (connexion, déconnexion, session) ;
 * - `/api/postback/<token>` : postbacks directs (jeton par point d'entrée) ;
 * - `/r` et `/r/<slug>` : redirections goolink (aussi atteintes par réécriture depuis go.goolink.eu) ;
 * - `/privacy` et `/terms` : politique de confidentialité et conditions d'utilisation (exigées par Meta / TikTok
 *   pour les apps développeur ; pages en lecture seule, aucune donnée).
 * Tout le reste (pages du site, `/api/media`, exports CSV…) exige une session : le proxy redirige vers /login,
 * et les routes API renvoient 401 par elles-mêmes (double barrière).
 */
const PUBLIC_PREFIXES = [
  "/login",
  "/invite/",
  "/api/health",
  "/api/telegram/",
  "/api/auth/",
  "/api/postback/",
  "/r/",
  "/r",
  "/privacy",
  "/terms",
  // Icônes du site (onglet de la page de connexion, écran d'accueil iPhone) : lisibles sans session.
  "/icon.png",
  "/apple-icon.png",
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) =>
    p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`),
  );
}

export type RouteDecision =
  { kind: "tracking"; rewriteTo: string } | { kind: "public" } | { kind: "protected" };

/**
 * Décide comment traiter une requête selon l'hôte et le chemin (fonction pure, testée).
 * - hôte de tracking → réécriture vers /r/<chemin> (aucune authentification) ;
 * - chemin public → laissé passer ;
 * - sinon → session requise.
 */
export function decideRoute(
  hostHeader: string | null,
  pathname: string,
  trackingHost: string | undefined,
): RouteDecision {
  if (isTrackingHost(hostHeader, trackingHost)) {
    const clean = pathname.replace(/^\/+/, "");
    if (clean === "r" || clean.startsWith("r/"))
      return { kind: "tracking", rewriteTo: `/${clean}` };
    return { kind: "tracking", rewriteTo: `/r/${clean}` };
  }
  if (isPublicPath(pathname)) return { kind: "public" };
  return { kind: "protected" };
}

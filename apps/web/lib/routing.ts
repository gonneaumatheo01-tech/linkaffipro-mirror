import { isTrackingHost } from "@linkaffipro/core";

/**
 * Chemins accessibles sans session (volontairement publics) :
 * - `/login` : page de connexion ;
 * - `/invite/<token>` : acceptation d'une invitation (jeton unique, expire après 7 jours) ;
 * - `/api/health` : contrôle de santé Railway ;
 * - `/api/telegram/<botId>` : webhooks Telegram (secret par bot vérifié dans la route) ;
 * - `/api/auth/*` : Auth.js (connexion, déconnexion, session) ;
 * - `/api/postback/<token>` : postbacks directs (jeton par point d'entrée) ;
 * - `/api/integrations/` : API d'intégration appelée par Link Affi (clé `Authorization: Bearer` vérifiée par son
 *   empreinte dans chaque route, limite de débit, journal ; phase 13) ;
 * - `/r` et `/r/<slug>` : redirections goolink (aussi atteintes par réécriture depuis go.goolink.eu) ;
 * - `/j/<slug>` : pages d'atterrissage (phase 15), avec `/j/_e` (envoi des visites et clics) et `/j/_p/…` (photo du
 *   canal) ; servies sur go.goolink.eu ; sur l'hôte du site seulement en développement et en local (en production,
 *   jamais : les scripts des pixels s'exécuteraient sur l'adresse de l'administration, avec la session de l'équipe —
 *   voir `landingAllowedOnHost`) ;
 * - `/api/internal/site-ops` : opérations du site demandées à Kevin par le worker (phase 34), protégées par une
 *   signature HMAC dérivée de `APP_ENCRYPTION_KEY` (fenêtre d'une minute, anti-rejeu) et par la relecture du rôle en
 *   base, jamais par la session ;
 * - `/k/<jeton>` : liens d'autorisation envoyés par Kevin (phase 34 : jeton aléatoire à usage unique, 15 minutes,
 *   seule son empreinte est gardée ; aucune session créée, il redirige vers la connexion, une invitation, une page
 *   interne ou le démarrage OAuth qui exigent eux-mêmes ce qu'il faut) ;
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
  "/api/integrations/",
  "/api/internal/site-ops",
  "/r/",
  "/r",
  "/j/",
  "/k/",
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
  | { kind: "tracking"; rewriteTo: string }
  | { kind: "public" }
  | { kind: "protected" }
  /** Page d'atterrissage demandée sur l'hôte du site en production : jamais servie (404). */
  | { kind: "landing-elsewhere" };

/** Hôte de la machine elle-même (`localhost`, `127.0.0.1`, `[::1]`, avec ou sans port) : essais et mesures. */
export function isLoopbackHost(hostHeader: string | null | undefined): boolean {
  const host = (hostHeader ?? "").trim().toLowerCase();
  return /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/.test(host);
}

/**
 * Une page d'atterrissage (`/j/…`) peut-elle être servie pour cet hôte ? Toujours sur l'hôte de tracking ; ailleurs
 * seulement hors production, sans hôte de tracking configuré, ou sur la machine elle-même. En production, l'adresse
 * du site d'administration (app.linkaffipro.com, adresse Railway de secours) ne sert jamais une page : ses pixels
 * (TikTok, Meta et ce qu'ils chargent) tourneraient avec la session de l'équipe, et ses envois seraient comptés.
 */
export function landingAllowedOnHost(
  hostHeader: string | null | undefined,
  trackingHost: string | undefined,
  production: boolean,
): boolean {
  if (!production || !trackingHost) return true;
  return isTrackingHost(hostHeader, trackingHost) || isLoopbackHost(hostHeader);
}

/** Même règle pour une requête reçue par une route (`x-forwarded-host`, sinon `host`) et l'environnement du site. */
export function landingAllowedForRequest(
  headers: Headers,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0]!.trim();
  return landingAllowedOnHost(host, env.TRACKING_HOST, env.NODE_ENV === "production");
}

/**
 * Décide comment traiter une requête selon l'hôte et le chemin (fonction pure, testée).
 * - hôte de tracking → `/j/…` (pages d'atterrissage) servi tel quel, sans redirection ; le reste réécrit vers
 *   /r/<chemin> (aucune authentification) ;
 * - page d'atterrissage `/j/…` sur un autre hôte quand `landingOnSiteHost` est faux (production) → refusée (404) ;
 * - chemin public → laissé passer ;
 * - sinon → session requise.
 */
export function decideRoute(
  hostHeader: string | null,
  pathname: string,
  trackingHost: string | undefined,
  opts: { landingOnSiteHost?: boolean } = {},
): RouteDecision {
  if (isTrackingHost(hostHeader, trackingHost)) {
    const clean = pathname.replace(/^\/+/, "");
    // Pages d'atterrissage : même chemin (une barre oblique finale est retirée par réécriture, jamais par redirection).
    if (clean.startsWith("j/")) {
      const landing = `/${clean}`.replace(/(.)\/+$/, "$1");
      return { kind: "tracking", rewriteTo: landing };
    }
    if (clean === "r" || clean.startsWith("r/"))
      return { kind: "tracking", rewriteTo: `/${clean}` };
    return { kind: "tracking", rewriteTo: `/r/${clean}` };
  }
  if (
    pathname.startsWith("/j/") &&
    opts.landingOnSiteHost === false &&
    trackingHost &&
    !isLoopbackHost(hostHeader)
  ) {
    return { kind: "landing-elsewhere" };
  }
  if (isPublicPath(pathname)) return { kind: "public" };
  return { kind: "protected" };
}

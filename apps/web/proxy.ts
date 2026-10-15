import NextAuth from "next-auth";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "./auth.config";
import { decideRoute } from "./lib/routing";
import { legacyRedirect } from "./lib/legacy-routes";

/** En-têtes de sécurité communs (voir docs/SECURITE.md). */
const BASE_HEADERS: Array<[string, string]> = [
  ["Strict-Transport-Security", "max-age=31536000; includeSubDomains"],
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "DENY"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["Permissions-Policy", "camera=(), microphone=(), geolocation=()"],
];

/** CSP des pages du site (Next 16 injecte des scripts inline : 'unsafe-inline' sans nonce). */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // eval() seulement en développement (outils de React/Next) ; jamais en production.
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/**
 * Ajoute l'identifiant de requête (diagnostic) et les en-têtes de sécurité.
 * Pas de CSP sur les redirections de tracking ni sur les API (inutile, et risqué pour les intégrations), ni sur les
 * pages d'atterrissage `/j/…` : leur route pose sa propre CSP (empreintes du CSS et du script de la page, pixels).
 */
function finalize(res: NextResponse, request: NextRequest, opts: { csp: boolean }): NextResponse {
  res.headers.set("x-request-id", request.headers.get("x-request-id") ?? crypto.randomUUID());
  for (const [k, v] of BASE_HEADERS) res.headers.set(k, v);
  if (opts.csp) res.headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  return res;
}

const { auth } = NextAuth(authConfig);

/**
 * Proxy (ex-middleware) :
 * 1. le trafic du domaine de tracking (go.goolink.eu) est réécrit vers /r/… sans authentification, sauf les pages
 *    d'atterrissage `/j/…`, servies telles quelles (aucune redirection avant la page) ;
 * 2. en production, une page d'atterrissage demandée sur l'adresse du site (et non sur go.goolink.eu) répond 404 :
 *    ses pixels ne doivent jamais tourner avec la session de l'équipe (lib/routing.ts, `landingAllowedOnHost`) ;
 * 3. une ancienne adresse du site (/broadcasts, /bots, /?tab=ads…) renvoie (308) vers sa nouvelle place
 *    (lib/legacy-routes.ts) ;
 * 4. les chemins publics passent ;
 * 5. tout le reste exige une session, sinon redirection vers /login.
 */
export default async function proxy(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const trackingHost = process.env.TRACKING_HOST;
  const decision = decideRoute(host, request.nextUrl.pathname, trackingHost, {
    landingOnSiteHost: process.env.NODE_ENV !== "production",
  });

  const path = request.nextUrl.pathname;
  const csp =
    !path.startsWith("/api/") &&
    !path.startsWith("/r/") &&
    path !== "/r" &&
    !path.startsWith("/j/");

  if (decision.kind === "tracking") {
    // Page d'atterrissage déjà à sa place : laissée passer telle quelle (pas de réécriture inutile).
    if (decision.rewriteTo === path) return finalize(NextResponse.next(), request, { csp: false });
    const url = request.nextUrl.clone();
    url.pathname = decision.rewriteTo;
    return finalize(NextResponse.rewrite(url), request, { csp: false });
  }
  if (decision.kind === "landing-elsewhere") {
    // Texte simple (aucun lien, aucun script) : l'équipe voit où la page s'ouvre.
    const where = `https://${trackingHost ?? ""}${path}`;
    const res = new NextResponse(`Cette page s'ouvre à l'adresse ${where}\n`, {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
    return finalize(res, request, { csp: false });
  }
  // Anciennes adresses (refonte de la phase 9) : 308 vers la nouvelle place, paramètres gardés, avant la connexion.
  const moved = legacyRedirect(path, request.nextUrl.searchParams);
  if (moved) {
    return finalize(NextResponse.redirect(new URL(moved, request.nextUrl.origin), 308), request, {
      csp: true,
    });
  }
  if (decision.kind === "public") return finalize(NextResponse.next(), request, { csp });

  const session = await auth();
  if (!session?.user) {
    const login = new URL("/login", request.nextUrl.origin);
    const back = request.nextUrl.pathname + request.nextUrl.search;
    if (back !== "/") login.searchParams.set("callbackUrl", back);
    return finalize(NextResponse.redirect(login), request, { csp: true });
  }
  return finalize(NextResponse.next(), request, { csp });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};

import NextAuth from "next-auth";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "./auth.config";
import { decideRoute } from "./lib/routing";

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
 * Pas de CSP sur les redirections de tracking ni sur les API (inutile, et risqué pour les intégrations).
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
 * 1. le trafic du domaine de tracking (go.goolink.eu) est réécrit vers /r/… sans authentification ;
 * 2. les chemins publics passent ;
 * 3. tout le reste exige une session, sinon redirection vers /login.
 */
export default async function proxy(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const decision = decideRoute(host, request.nextUrl.pathname, process.env.TRACKING_HOST);

  const path = request.nextUrl.pathname;
  const csp = !path.startsWith("/api/") && !path.startsWith("/r/") && path !== "/r";

  if (decision.kind === "tracking") {
    const url = request.nextUrl.clone();
    url.pathname = decision.rewriteTo;
    return finalize(NextResponse.rewrite(url), request, { csp: false });
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

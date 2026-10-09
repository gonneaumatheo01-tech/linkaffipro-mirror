import { isTrackingHost } from "@linkaffipro/core";

/** Chemins accessibles sans session. */
const PUBLIC_PREFIXES = ["/login", "/invite/", "/api/health", "/api/telegram/", "/api/auth/", "/r/", "/r"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)));
}

export type RouteDecision =
  | { kind: "tracking"; rewriteTo: string }
  | { kind: "public" }
  | { kind: "protected" };

/**
 * Décide comment traiter une requête selon l'hôte et le chemin (fonction pure, testée).
 * - hôte de tracking → réécriture vers /r/<chemin> (aucune authentification) ;
 * - chemin public → laissé passer ;
 * - sinon → session requise.
 */
export function decideRoute(hostHeader: string | null, pathname: string, trackingHost: string | undefined): RouteDecision {
  if (isTrackingHost(hostHeader, trackingHost)) {
    const clean = pathname.replace(/^\/+/, "");
    if (clean === "r" || clean.startsWith("r/")) return { kind: "tracking", rewriteTo: `/${clean}` };
    return { kind: "tracking", rewriteTo: `/r/${clean}` };
  }
  if (isPublicPath(pathname)) return { kind: "public" };
  return { kind: "protected" };
}

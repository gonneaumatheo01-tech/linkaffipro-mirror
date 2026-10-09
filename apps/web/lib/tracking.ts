import { extractTrackingParams, hashIp, isBotUserAgent } from "@linkaffipro/core";
import { env } from "./env";

/** Cible d'une redirection pour un slug donné. Phase 0 : `test` seulement ; le reste va vers le site. */
export function resolveTarget(slugParts: string[]): { slug: string; target: string; known: boolean } {
  const slug = slugParts.filter(Boolean).join("/");
  if (slug === "test") return { slug, target: "https://t.me/telegram", known: true };
  return { slug, target: env.appBaseUrl, known: false };
}

/** Réponse 302 sans corps, jamais mise en cache. */
export function redirectResponse(target: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: target,
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export type RedirectEventPayload = {
  slug: string;
  target: string;
  known: boolean;
  host: string | null;
  userAgent: string | null;
  isBot: boolean;
  ipHash: string | null;
  referer: string | null;
  clickIds: Record<string, string>;
  utm: Record<string, string>;
};

/** Construit le contenu de l'événement `tracking.redirect` à partir de la requête. */
export function buildRedirectEvent(req: Request, resolved: ReturnType<typeof resolveTarget>): RedirectEventPayload {
  const url = new URL(req.url);
  const userAgent = req.headers.get("user-agent");
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
  const { clickIds, utm } = extractTrackingParams(url.searchParams);
  let ipHash: string | null = null;
  if (ip && process.env.IP_HASH_SALT) ipHash = hashIp(ip);
  return {
    slug: resolved.slug,
    target: resolved.target,
    known: resolved.known,
    host: req.headers.get("x-forwarded-host") ?? req.headers.get("host"),
    userAgent,
    isBot: isBotUserAgent(userAgent),
    ipHash,
    referer: req.headers.get("referer"),
    clickIds: clickIds as Record<string, string>,
    utm,
  };
}

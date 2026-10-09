import { extractTrackingParams, fillUrlTemplate, hashIp, isBotUserAgent, isShortId } from "@linkaffipro/core";
import { prisma, recordEvent } from "@linkaffipro/db";
import { env } from "./env";

export type ResolvedLink = {
  slug: string;
  target: string;
  known: boolean;
  trackingLink: { id: string; kind: string } | null;
};

/** Cible d'une redirection pour un slug : `test` → t.me/telegram ; lien traqué actif → sa destination ; sinon le site. */
export async function resolveTarget(slugParts: string[]): Promise<ResolvedLink> {
  const slug = slugParts.filter(Boolean).join("/");
  if (slug === "test") return { slug, target: "https://t.me/telegram", known: true, trackingLink: null };
  if (/^[0-9A-Za-z]{6,10}$/.test(slug)) {
    const link = await prisma.trackingLink.findUnique({
      where: { slug },
      select: { id: true, kind: true, isActive: true, destinationTemplate: true },
    });
    if (link && link.isActive && link.destinationTemplate) {
      return {
        slug,
        target: fillUrlTemplate(link.destinationTemplate, {}),
        known: true,
        trackingLink: { id: link.id, kind: link.kind },
      };
    }
  }
  return { slug, target: env.appBaseUrl, known: false, trackingLink: null };
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
  trackingLinkId: string | null;
  host: string | null;
  userAgent: string | null;
  isBot: boolean;
  ipHash: string | null;
  referer: string | null;
  clickIds: Record<string, string>;
  utm: Record<string, string>;
};

/** Construit le contenu de l'événement `tracking.redirect` à partir de la requête. */
export function buildRedirectEvent(req: Request, resolved: ResolvedLink): RedirectEventPayload {
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
    trackingLinkId: resolved.trackingLink?.id ?? null,
    host: req.headers.get("x-forwarded-host") ?? req.headers.get("host"),
    userAgent,
    isBot: isBotUserAgent(userAgent),
    ipHash,
    referer: req.headers.get("referer"),
    clickIds: clickIds as Record<string, string>,
    utm,
  };
}

export const DEDUPE_WINDOW_MS = 10_000;

/**
 * Enregistre le clic anonyme d'un lien traqué (après la réponse) :
 * - dédoublonnage 10 s par (ipHash, userAgent, lien) ;
 * - robots marqués `isBot` et non comptés dans les compteurs ;
 * - `uniqueClicks` = première fois que cette empreinte (ipHash) clique sur ce lien.
 * Retourne ce qui a été fait (pour les tests).
 */
export async function recordAnonymousClick(payload: RedirectEventPayload, now = new Date()): Promise<"skipped" | "bot" | "counted"> {
  if (!payload.trackingLinkId) return "skipped";
  const dupe = await prisma.click.findFirst({
    where: {
      trackingLinkId: payload.trackingLinkId,
      ipHash: payload.ipHash,
      userAgent: payload.userAgent,
      createdAt: { gte: new Date(now.getTime() - DEDUPE_WINDOW_MS) },
    },
    select: { id: true },
  });
  if (dupe) return "skipped";
  const data = {
    trackingLinkId: payload.trackingLinkId,
    ipHash: payload.ipHash,
    userAgent: payload.userAgent ? payload.userAgent.slice(0, 512) : null,
    isBot: payload.isBot,
    referer: payload.referer ? payload.referer.slice(0, 1024) : null,
    ttclid: payload.clickIds.ttclid ?? null,
    fbclid: payload.clickIds.fbclid ?? null,
    gclid: payload.clickIds.gclid ?? null,
    utm: Object.keys(payload.utm).length > 0 ? payload.utm : undefined,
    createdAt: now,
  };
  if (payload.isBot) {
    await prisma.click.create({ data });
    return "bot";
  }
  const seenBefore = payload.ipHash
    ? await prisma.click.findFirst({ where: { trackingLinkId: payload.trackingLinkId, ipHash: payload.ipHash, isBot: false }, select: { id: true } })
    : null;
  await prisma.click.create({ data });
  await prisma.trackingLink.update({
    where: { id: payload.trackingLinkId },
    data: { clicks: { increment: 1 }, uniqueClicks: seenBefore ? undefined : { increment: 1 } },
  });
  return "counted";
}

/** Journalisation complète après la réponse : événement + clic. Ne lève jamais. */
export async function logRedirect(payload: RedirectEventPayload): Promise<void> {
  await recordEvent({ type: "tracking.redirect", payload });
  try {
    await recordAnonymousClick(payload);
  } catch (err) {
    console.error("[tracking] clic non enregistré", err);
  }
}

export { isShortId };
